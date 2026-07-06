import * as Y from "yjs";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../filesystem/tauriCommands";
import { diff_match_patch } from "diff-match-patch";
import { create } from "zustand";
import { getSettings } from "../settings/settingsStore";
import { usePlanStore } from "../billing/PlanProvider";
import { auth } from "../auth/firebase";
import { useSyncStatusStore } from "../cloud/syncStatusStore";
import { FirestoreYjsProvider } from "../cloud/firestoreYjsProvider";
import { generateDraftFromMarkdown } from "./draftUtils";
import { saveToLocalDb, syncDraftNodesToDb, syncToCloud, loadDocData, applyDocData, buildDocSavePayload } from "./documentSync";

interface DirtyDocsStore {
  dirtyDocs: Set<string>;
  setDirty: (documentId: string, isDirty: boolean) => void;
}

export const useDirtyDocsStore = create<DirtyDocsStore>((set) => ({
  dirtyDocs: new Set<string>(),
  setDirty: (documentId, isDirty) =>
    set((state) => {
      const next = new Set(state.dirtyDocs);
      if (isDirty) next.add(documentId);
      else next.delete(documentId);
      return { dirtyDocs: next };
    }),
}));

const dmp = new diff_match_patch();

export class DocumentRegistry {
  private acquiring = new Map<string, Promise<Y.Doc>>();
  private docs = new Map<string, { doc: Y.Doc; refs: number; interval?: any }>();
  private unlistenFileChanged: (() => void) | null = null;
  private providers = new Map<string, FirestoreYjsProvider>();
  private lastSavedContent = new Map<string, string>();

  constructor() {
    this.initWatcher();
    this.initPlanSubscription();
  }

  private initPlanSubscription() {
    usePlanStore.subscribe((state) => {
      if (state.isTeam && auth.currentUser) {
        for (const [docId, entry] of this.docs.entries()) {
          if (!this.providers.has(docId)) {
            const provider = new FirestoreYjsProvider(docId, entry.doc, state.teamId);
            this.providers.set(docId, provider);
          }
        }
      } else {
        for (const [docId, provider] of this.providers.entries()) {
          provider.destroy();
          this.providers.delete(docId);
        }
      }
    });
  }

  private async initWatcher() {
    try {
      this.unlistenFileChanged = await listen("file-changed", (event: any) => {
        const { document_id, content } = event.payload;
        const entry = this.docs.get(document_id);
        if (!entry) return;

        const lastSaved = this.lastSavedContent.get(document_id);
        if (lastSaved === content) return;

        const ytext = entry.doc.getText("markdown");
        const currentText = ytext.toString();
        if (currentText === content) return;

        const diffs = dmp.diff_main(currentText, content);
        dmp.diff_cleanupSemantic(diffs);
        entry.doc.transact(() => {
          let cursor = 0;
          for (const [op, text] of diffs) {
            if (op === 1) { ytext.insert(cursor, text); cursor += text.length; }
            else if (op === -1) { ytext.delete(cursor, text.length); }
            else if (op === 0) { cursor += text.length; }
          }
        }, "external-watcher");
      });
    } catch (e) {
      console.error("Failed to initialize file watcher listener", e);
    }
  }

  async acquire(documentId: string): Promise<Y.Doc> {
    const existing = this.docs.get(documentId);
    if (existing) { existing.refs++; return existing.doc; }

    const alreadyAcquiring = this.acquiring.get(documentId);
    if (alreadyAcquiring) {
      const doc = await alreadyAcquiring;
      const entry = this.docs.get(documentId);
      if (entry) entry.refs++;
      return doc;
    }

    const acquirePromise = (async () => {
      const doc = new Y.Doc();
      try {
        const { data, parsed } = await loadDocData(documentId);
        applyDocData(doc, data, parsed);

        const ytext = doc.getText("markdown");
        const draftText = doc.getText("draft");

        if (!parsed.draft && !parsed.yjs_state && parsed.markdown) {
          const generatedDraft = generateDraftFromMarkdown(parsed.markdown, false);
          if (generatedDraft) draftText.insert(0, generatedDraft);
        }

        const handleUpdate = () => useDirtyDocsStore.getState().setDirty(documentId, true);
        ytext.observe(handleUpdate);
        draftText.observe(handleUpdate);
      } catch (e) {
        console.error("Failed to acquire document:", e);
      }

      let lastSnapshotText = doc.getText("markdown").toString();
      const interval = setInterval(async () => {
        const text = doc.getText("markdown").toString();
        const isDirty = useDirtyDocsStore.getState().dirtyDocs.has(documentId);
        if (!isDirty) return;

        const { autoSave, autoSync } = getSettings();
        if (autoSave) {
          this.lastSavedContent.set(documentId, text);
          try {
            await saveToLocalDb(doc, documentId);
            await syncDraftNodesToDb(doc, documentId);
          } catch (e) { console.error("Autosave failed:", e); }
        }
        if (autoSync) {
          await syncToCloud(doc, documentId);
        }
        useDirtyDocsStore.getState().setDirty(documentId, false);

        if (text !== lastSnapshotText && text.trim().length > 0) {
          lastSnapshotText = text;
          const wordCount = text.trim().split(/\s+/).length;
          await invoke("save_snapshot", {
            documentId,
            snapshot: Array.from(Y.encodeStateAsUpdate(doc)),
            word_count: wordCount,
          });
        }
      }, 5000);

      if (usePlanStore.getState().isTeam && auth.currentUser) {
        const provider = new FirestoreYjsProvider(documentId, doc, usePlanStore.getState().teamId);
        this.providers.set(documentId, provider);
      }

      this.docs.set(documentId, { doc, refs: 1, interval });
      return doc;
    })();

    this.acquiring.set(documentId, acquirePromise);
    try { return await acquirePromise; }
    finally { this.acquiring.delete(documentId); }
  }

  release(documentId: string): void {
    const existing = this.docs.get(documentId);
    if (!existing) return;
    existing.refs--;
    if (existing.refs > 0) return;

    clearInterval(existing.interval);
    const provider = this.providers.get(documentId);
    if (provider) { provider.destroy(); this.providers.delete(documentId); }
    existing.doc.destroy();
    this.docs.delete(documentId);
  }

  getProvider(documentId: string): FirestoreYjsProvider | undefined {
    return this.providers.get(documentId);
  }

  async saveDocument(documentId: string): Promise<void> {
    const entry = this.docs.get(documentId);
    if (!entry) return;

    const { doc } = entry;
    const text = doc.getText("markdown").toString();
    try {
      this.lastSavedContent.set(documentId, text);
      await saveToLocalDb(doc, documentId);
      await syncDraftNodesToDb(doc, documentId);
      await syncToCloud(doc, documentId);
      useDirtyDocsStore.getState().setDirty(documentId, false);
    } catch (e) {
      console.error("Failed to manually save document:", e);
    }
  }

  getActive(): string[] {
    return Array.from(this.docs.keys());
  }
}

export const registry = new DocumentRegistry();
