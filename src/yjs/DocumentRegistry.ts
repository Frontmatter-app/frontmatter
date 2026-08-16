import * as Y from "yjs";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../filesystem/tauriCommands";
import { diff_match_patch } from "diff-match-patch";
import { create } from "zustand";
import { getSettings } from "../settings/settingsStore";
import { usePlanStore } from "../billing/PlanProvider";
import { getCurrentUser } from "../auth/session";
import { useSyncStatusStore } from "../cloud/syncStatusStore";
import { CollabProvider } from "../cloud/collabProvider";
import { generateDraftFromMarkdown } from "./draftUtils";
import { saveToLocalDb, syncDraftNodesToDb, syncToCloud, loadDocData, applyDocData, buildDocSavePayload } from "./documentSync";
import { sweepLocalAssets } from "../images/assetGc";

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

/** How often the autosave loop runs, and so how often anything is written. */
const AUTOSAVE_INTERVAL_MS = 5000;

/**
 * Floor between automatic snapshots. History is capped per document
 * (`MAX_SNAPSHOTS` in `commands/snapshots.rs`), so cadence buys depth: at one
 * per autosave the cap held minutes, at one per two minutes it holds hours.
 */
const AUTO_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;

export class DocumentRegistry {
  private acquiring = new Map<string, Promise<Y.Doc>>();
  private docs = new Map<string, { doc: Y.Doc; refs: number; interval?: any; isCloud: boolean }>();
  private unlistenFileChanged: (() => void) | null = null;
  private providers = new Map<string, CollabProvider>();
  private lastSavedContent = new Map<string, string>();
  /** Releases that arrived while an acquire was still in flight. */
  private pendingReleases = new Map<string, number>();

  constructor() {
    this.initWatcher();
    this.initPlanSubscription();
  }

  /**
   * Whether a document's content is owned by the sync server.
   *
   * This is a property of the *document*, not of the workspace you happen to be
   * in. A file on disk is a local document even when a team workspace is open:
   * a team workspace still lists every markdown file in the folder you opened,
   * and those files have no `cloud_documents` record for a server to sync from.
   *
   * Getting this wrong destroys files. Cloud documents deliberately skip local
   * seeding — the server supplies their content — so treating a local file as a
   * cloud document opens it blank, and the next autosave writes that blank back
   * over the file on disk.
   */
  private isCloudDocument(documentId: string, data?: { file_path?: string | null }): boolean {
    if (useSyncStatusStore.getState().cloudDocumentIds.has(documentId)) return true;
    // Backed by a real file: local, whatever context is active.
    if (data && data.file_path) return false;
    // No file on disk. In a team workspace a new document is cloud-backed;
    // in a personal one it is only cloud-backed if it was listed as such above.
    if (data) return usePlanStore.getState().activeContext.type === 'team';
    return false;
  }

  private attachProvider(documentId: string, doc: Y.Doc) {
    if (this.providers.has(documentId)) return;
    if (!getCurrentUser()) return;
    // Uses the value resolved at acquire time, which saw the document's record.
    if (!this.docs.get(documentId)?.isCloud) return;
    try {
      this.providers.set(documentId, new CollabProvider(documentId, doc));
    } catch (e) {
      console.error('[registry] Could not attach the collaboration provider:', e);
    }
  }

  /**
   * Attaches or detaches providers when the signed-in context changes.
   *
   * The gate used to be `state.isTeam`, so personal cloud documents got no CRDT
   * at all and two devices editing one clobbered each other through the
   * whole-document push. Any cloud document now gets the same transport.
   */
  private initPlanSubscription() {
    usePlanStore.subscribe(() => {
      if (getCurrentUser()) {
        for (const [docId, entry] of this.docs.entries()) {
          this.attachProvider(docId, entry.doc);
        }
        return;
      }
      for (const [docId, provider] of this.providers.entries()) {
        provider.destroy();
        this.providers.delete(docId);
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

    // A release that arrives before the acquire resolves is recorded here.
    // `docs.set` happens at the end of the async body, so such a release used to
    // find no entry, no-op, and leave the document, its autosave interval, and
    // its provider alive for the rest of the session.
    const pendingReleases = this.pendingReleases.get(documentId) ?? 0;
    this.pendingReleases.set(documentId, pendingReleases);

    const alreadyAcquiring = this.acquiring.get(documentId);
    if (alreadyAcquiring) {
      const doc = await alreadyAcquiring;
      const entry = this.docs.get(documentId);
      if (entry) entry.refs++;
      return doc;
    }

    const acquirePromise = (async () => {
      const doc = new Y.Doc();
      // Resolved after the record is loaded, so `file_path` can be consulted —
      // deciding from workspace context alone misclassifies local files.
      let isCloud = false;
      try {
        const { data, parsed } = await loadDocData(documentId);
        isCloud = this.isCloudDocument(documentId, data);
        applyDocData(doc, data, parsed, { isCloud });

        const ytext = doc.getText("markdown");
        const draftText = doc.getText("draft");

        // Local documents only. The outline is deterministic content with
        // non-deterministic authorship, so two peers generating it each
        // inserted their own copy into the shared draft. Cloud documents get
        // theirs from the sync server's one-time bootstrap.
        if (!isCloud && !parsed.draft && !parsed.yjs_state && parsed.markdown) {
          const generatedDraft = generateDraftFromMarkdown(parsed.markdown, false);
          if (generatedDraft) draftText.insert(0, generatedDraft);
        }

        const handleUpdate = () => useDirtyDocsStore.getState().setDirty(documentId, true);
        ytext.observe(handleUpdate);
        draftText.observe(handleUpdate);

        // Text is not the only thing worth saving. Replies, resolutions,
        // suggestion records and hidden lint rules all live in these maps, and
        // the autosave interval below returns early unless the document is
        // dirty — so without these, resolving a note and closing the document
        // threw the resolution away unless you happened to type afterwards.
        doc.getMap("annotations").observeDeep(handleUpdate);
        doc.getMap("suggestions").observeDeep(handleUpdate);
        doc.getMap("meta").observeDeep(handleUpdate);
      } catch (e) {
        console.error("Failed to acquire document:", e);
      }

      let lastSnapshotText = doc.getText("markdown").toString();
      let lastSnapshotAt = 0;
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
        // Only for documents with no CRDT channel. Pushing the whole `content`
        // blob alongside the sync server would be two writers with no version
        // check racing the same field — the blob would clobber merged text.
        if (autoSync && !this.providers.has(documentId)) {
          await syncToCloud(doc, documentId);
        }
        useDirtyDocsStore.getState().setDirty(documentId, false);

        // Autosave runs on this interval, but history does not need to. At one
        // snapshot per save the fifty-entry cap held only a few minutes of
        // work, so the oldest — and most useful — versions were always the
        // first to go. The floor buys hours of depth from the same cap.
        const now = Date.now();
        const changed = text !== lastSnapshotText && text.trim().length > 0;
        if (changed && now - lastSnapshotAt >= AUTO_SNAPSHOT_INTERVAL_MS) {
          lastSnapshotText = text;
          lastSnapshotAt = now;
          const wordCount = text.trim().split(/\s+/).length;
          try {
            await invoke("save_snapshot", {
              documentId,
              snapshot: Array.from(Y.encodeStateAsUpdate(doc)),
              // The IPC contract is camelCase. Sent as `word_count` this was
              // silently dropped, and every version showed a blank word count.
              wordCount,
            });
          } catch (e) {
            // No workspace open, most often. Unhandled, this rejected the
            // interval callback with nothing to catch it.
            console.error("Auto-snapshot failed:", e);
          }
        }
      }, AUTOSAVE_INTERVAL_MS);

      // Settle any releases that landed while this was in flight.
      const deferred = this.pendingReleases.get(documentId) ?? 0;
      this.pendingReleases.delete(documentId);
      const refs = 1 - deferred;

      this.docs.set(documentId, { doc, refs, interval, isCloud });
      if (refs <= 0) {
        this.teardown(documentId);
        return doc;
      }

      this.attachProvider(documentId, doc);
      return doc;
    })();

    this.acquiring.set(documentId, acquirePromise);
    try { return await acquirePromise; }
    finally { this.acquiring.delete(documentId); }
  }

  private teardown(documentId: string): void {
    const entry = this.docs.get(documentId);
    if (!entry) return;
    clearInterval(entry.interval);
    const provider = this.providers.get(documentId);
    if (provider) { provider.destroy(); this.providers.delete(documentId); }
    entry.doc.destroy();
    this.docs.delete(documentId);
  }

  release(documentId: string): void {
    const existing = this.docs.get(documentId);
    if (!existing) {
      // Still acquiring: record it so the acquire can settle the balance.
      if (this.acquiring.has(documentId)) {
        this.pendingReleases.set(documentId, (this.pendingReleases.get(documentId) ?? 0) + 1);
      }
      return;
    }
    existing.refs--;
    if (existing.refs > 0) return;
    this.teardown(documentId);
  }

  getProvider(documentId: string): CollabProvider | undefined {
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

    // On explicit save only, never on autosave: a sweep right after every
    // keystroke pause would keep racing edits in progress. Unreferenced files
    // are moved to `.assets/trash`, and only once they are a day old.
    const filePath = doc.getMap("meta").get("file_path") as string | undefined;
    if (filePath) {
      const docDir = filePath.substring(0, filePath.lastIndexOf("/"));
      sweepLocalAssets(doc, docDir)
        .then(({ trashed }) => {
          if (trashed.length > 0) {
            console.info(`[assets] Moved ${trashed.length} unreferenced image(s) to .assets/trash`);
          }
        })
        .catch((e) => console.warn("[assets] Sweep failed:", e));
    }
  }

  getActive(): string[] {
    return Array.from(this.docs.keys());
  }
}

export const registry = new DocumentRegistry();
