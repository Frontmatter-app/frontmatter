import * as Y from "yjs";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../filesystem/tauriCommands";
import { diff_match_patch } from "diff-match-patch";
import { create } from "zustand";
import { getSettings } from "../settings/settingsStore";
import { usePlanStore } from "../billing/PlanProvider";
import { auth } from "../auth/AuthProvider";
import { pushCloudDocument, fetchCloudDocument } from "../cloud/firestoreSync";
import { useSyncStatusStore } from "../cloud/syncStatusStore";
import { FirestoreYjsProvider } from "../cloud/firestoreYjsProvider";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 2) normalized += '==';
  else if (padding === 3) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface DirtyDocsStore {
  dirtyDocs: Set<string>;
  setDirty: (documentId: string, isDirty: boolean) => void;
}

export const useDirtyDocsStore = create<DirtyDocsStore>((set) => ({
  dirtyDocs: new Set<string>(),
  setDirty: (documentId, isDirty) =>
    set((state) => {
      const next = new Set(state.dirtyDocs);
      if (isDirty) {
        next.add(documentId);
      } else {
        next.delete(documentId);
      }
      return { dirtyDocs: next };
    }),
}));

const dmp = new diff_match_patch();

/**
 * Extracts headings from markdown and produces a draft skeleton.
 * Each heading becomes a section header; body content is intentionally
 * left empty so external docs only populate the outline, not the content.
 *
 * Set `includeBody` to true (default) to copy body text along with headings,
 * or false to produce an outline-only draft (used when importing external files).
 */
export function generateDraftFromMarkdown(
  markdown: string,
  includeBody = true
): string {
  const lines = markdown.split("\n");

  if (!includeBody) {
    const outlineLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        const indent = "  ".repeat(level - 1);
        outlineLines.push(`${indent}- ${title}`);
      }
    }
    return `# Outline\n${outlineLines.join("\n")}`;
  }

  const sections: { title: string; body: string[] }[] = [];
  let currentSection: { title: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: match[2].trim(),
        body: [],
      };
    } else if (currentSection && includeBody) {
      currentSection.body.push(line);
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  if (sections.length === 0) return "";

  return sections
    .map((sec) => `# ${sec.title}\n${sec.body.join("\n").trim()}`)
    .join("\n\n");
}

export class DocumentRegistry {
  private acquiring = new Map<string, Promise<Y.Doc>>();
  private docs = new Map<
    string,
    { doc: Y.Doc; refs: number; interval?: any }
  >();
  private unlistenFileChanged: (() => void) | null = null;
  private providers = new Map<string, FirestoreYjsProvider>();
  private lastSavedContent = new Map<string, string>();

  constructor() {
    this.initWatcher();
    this.initPlanSubscription();
  }

private initPlanSubscription() {
     usePlanStore.subscribe((state) => {
       const currentUser = auth.currentUser;
       if (state.isTeam && currentUser) {
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

        if (entry) {
          const lastSaved = this.lastSavedContent.get(document_id);
          if (lastSaved === content) {
            return;
          }

          const ytext = entry.doc.getText("markdown");
          const currentText = ytext.toString();

          if (currentText !== content) {
            const diffs = dmp.diff_main(currentText, content);
            dmp.diff_cleanupSemantic(diffs);

            entry.doc.transact(() => {
              let cursor = 0;
              for (const [op, text] of diffs) {
                if (op === 1) {
                  // Insert
                  ytext.insert(cursor, text);
                  cursor += text.length;
                } else if (op === -1) {
                  // Delete
                  ytext.delete(cursor, text.length);
                } else if (op === 0) {
                  // Equal
                  cursor += text.length;
                }
              }
            }, "external-watcher");
          }
        }
      });
    } catch (e) {
      console.error("Failed to initialize file watcher listener", e);
    }
  }

  async acquire(documentId: string): Promise<Y.Doc> {
    const existing = this.docs.get(documentId);
    if (existing) {
      existing.refs++;
      return existing.doc;
    }

    const alreadyAcquiring = this.acquiring.get(documentId);
    if (alreadyAcquiring) {
      const doc = await alreadyAcquiring;
      const entry = this.docs.get(documentId);
      if (entry) {
        entry.refs++;
      }
      return doc;
    }

    const acquirePromise = (async () => {
      const doc = new Y.Doc();

      try {
        let data: any;
        try {
          data = await invoke("get_document", { id: documentId });
        } catch (dbErr) {
          const planState = usePlanStore.getState();
          if (planState.isAuthor && auth.currentUser) {
            const cloudDoc = await fetchCloudDocument(documentId);
            if (cloudDoc) {
              await invoke("create_document", {
                id: documentId,
                title: cloudDoc.title,
                content: cloudDoc.content,
                filePath: undefined
              });
              data = await invoke("get_document", { id: documentId });
            } else {
              throw new Error("Document not found in local DB nor Cloud Firestore");
            }
          } else {
            throw dbErr;
          }
        }

        let parsed = { markdown: data.content, draft: "", yjs_state: "" };
        if (data.content && data.content.startsWith("{")) {
          try {
            parsed = JSON.parse(data.content);
          } catch (e) {}
        }

        const ytext = doc.getText("markdown");
        const draftText = doc.getText("draft");

        if (parsed.yjs_state) {
          try {
            const bytes = base64ToUint8(parsed.yjs_state);
            Y.applyUpdate(doc, bytes);
          } catch (e) {
            console.error("Failed to apply yjs_state update, falling back to plaintext", e);
            ytext.insert(0, parsed.markdown || "");
            draftText.insert(0, parsed.draft || "");
          }
        } else {
          ytext.insert(0, parsed.markdown || "");
          draftText.insert(0, parsed.draft || "");

          if (!parsed.draft && parsed.markdown) {
            const generatedDraft = generateDraftFromMarkdown(parsed.markdown, false);
            if (generatedDraft) {
              draftText.insert(0, generatedDraft);
            }
          }
        }

        doc.getMap("meta").set("focus_mode", data.focus_mode || false);
        doc.getMap("meta").set("stage", data.stage || "write");
        doc.getMap("meta").set("title", data.title || "Untitled Document");
        if (data.file_path) {
          doc.getMap("meta").set("file_path", data.file_path);
        }

        // Set up dirty listeners after initial loading
        const handleUpdate = () => {
          useDirtyDocsStore.getState().setDirty(documentId, true);
        };
        ytext.observe(handleUpdate);
        draftText.observe(handleUpdate);
      } catch (e) {
        console.error("Failed to acquire document:", e);
      }

      // Auto-save every 5 seconds (if autoSave is enabled)
      let autosaveTicks = 0;
      let lastSnapshotText = doc.getText("markdown").toString(); // track what we last snapshotted
      const interval = setInterval(async () => {
        const text = doc.getText("markdown").toString();
        const draftMsg = doc.getText("draft").toString();
        const title =
          (doc.getMap("meta").get("title") as string) || "Untitled Document";

        const { autoSave, autoSync } = getSettings();
        const isDirty = useDirtyDocsStore.getState().dirtyDocs.has(documentId);

        if (isDirty && (autoSave || autoSync)) {
          if (autoSave) {
            this.lastSavedContent.set(documentId, text);
            await invoke("update_document", {
              id: documentId,
              title: title,
              content: JSON.stringify({
                markdown: text,
                draft: draftMsg,
                yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(doc))
              }),
              stage: doc.getMap("meta").get("stage") || "write",
              focusMode: doc.getMap("meta").get("focus_mode") || false,
            });

            // Draft outline extraction
            const lines = draftMsg.split("\n");
            let currentSection: any = null;
            let nodes: any[] = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const match = line.match(/^(#{1,6})\s+(.*)/);
              if (match) {
                if (currentSection) nodes.push(currentSection);
                currentSection = {
                  id: `${documentId}:sec-${i}`,
                  document_id: documentId,
                  level: match[1].length,
                  title: match[2],
                  notes: "",
                };
              } else if (currentSection && line.trim()) {
                currentSection.notes += line + "\n";
              }
            }
            if (currentSection) nodes.push(currentSection);

            if (nodes.length > 0) {
              invoke("sync_draft_nodes", { documentId: documentId, nodes }).catch(
                console.error
              );
            }
          }

          // PUSH TO CLOUD IF AUTHOR OR ABOVE, IS CLOUD DOCUMENT, AND AUTO-SYNC IS ENABLED
          const planState = usePlanStore.getState();
          const currentUser = auth.currentUser;
          const isCloudDoc = useSyncStatusStore.getState().cloudDocumentIds.has(documentId) ||
                             planState.activeContext.type === 'team';
if (planState.isAuthor && currentUser && isCloudDoc && autoSync) {
             useSyncStatusStore.getState().setSyncing();
             pushCloudDocument(
               {
                 id: documentId,
                 title: title,
                 content: JSON.stringify({ markdown: text, draft: draftMsg }),
                 stage: (doc.getMap("meta").get("stage") as any) || "write",
                 focus_mode: (doc.getMap("meta").get("focus_mode") as boolean) || false,
                 created_at: new Date().toISOString(),
                 updated_at: new Date().toISOString(),
               },
               currentUser.uid,
               planState.teamId
             )
               .then(() => useSyncStatusStore.getState().setSynced())
               .catch((err) => {
                 if (err?.code !== 'permission-denied') {
                   console.error("Cloud sync failed during autosave:", err);
                   useSyncStatusStore.getState().setError("Sync failed");
                 }
               });
           }

          // Clear dirty state on successful auto-save/sync check
          useDirtyDocsStore.getState().setDirty(documentId, false);
        }

        autosaveTicks++;
        if (autosaveTicks % 12 === 0) {
          // Every 1 minute (12 × 5 s), only snapshot if content has actually changed
          if (text !== lastSnapshotText && text.trim().length > 0) {
            lastSnapshotText = text;
            const stateVector = Y.encodeStateAsUpdate(doc);
            const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
            await invoke("save_snapshot", {
              documentId: documentId,
              snapshot: Array.from(stateVector),
              word_count: wordCount,
            });
          }
        }
      }, 5000);

const planState = usePlanStore.getState();
       if (planState.isTeam && auth.currentUser) {
         const provider = new FirestoreYjsProvider(documentId, doc, planState.teamId);
         this.providers.set(documentId, provider);
       }

      this.docs.set(documentId, { doc, refs: 1, interval });
      return doc;
    })();

    this.acquiring.set(documentId, acquirePromise);

    try {
      return await acquirePromise;
    } finally {
      this.acquiring.delete(documentId);
    }
  }

  release(documentId: string): void {
    const existing = this.docs.get(documentId);
    if (existing) {
      existing.refs--;
      if (existing.refs <= 0) {
        clearInterval(existing.interval);

        const provider = this.providers.get(documentId);
        if (provider) {
          provider.destroy();
          this.providers.delete(documentId);
        }

        existing.doc.destroy();
        this.docs.delete(documentId);
      }
    }
  }

  getProvider(documentId: string): FirestoreYjsProvider | undefined {
    return this.providers.get(documentId);
  }

  async saveDocument(documentId: string): Promise<void> {
    const entry = this.docs.get(documentId);
    if (!entry) return;

    const { doc } = entry;
    const text = doc.getText("markdown").toString();
    const draftMsg = doc.getText("draft").toString();
    const title =
      (doc.getMap("meta").get("title") as string) || "Untitled Document";

    try {
      this.lastSavedContent.set(documentId, text);
      await invoke("update_document", {
        id: documentId,
        title: title,
        content: JSON.stringify({
          markdown: text,
          draft: draftMsg,
          yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(doc))
        }),
        stage: doc.getMap("meta").get("stage") || "write",
        focusMode: doc.getMap("meta").get("focus_mode") || false,
      });

      // Draft outline extraction
      const lines = draftMsg.split("\n");
      let currentSection: any = null;
      let nodes: any[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.*)/);
        if (match) {
          if (currentSection) nodes.push(currentSection);
          currentSection = {
            id: `${documentId}:sec-${i}`,
            document_id: documentId,
            level: match[1].length,
            title: match[2],
            notes: "",
          };
        } else if (currentSection && line.trim()) {
          currentSection.notes += line + "\n";
        }
      }
      if (currentSection) nodes.push(currentSection);

      if (nodes.length > 0) {
        await invoke("sync_draft_nodes", { documentId: documentId, nodes });
      }

      // Sync to cloud if owner/author and cloud document
      const planState = usePlanStore.getState();
      const currentUser = auth.currentUser;
      const isCloudDoc = useSyncStatusStore.getState().cloudDocumentIds.has(documentId) ||
                         planState.activeContext.type === 'team';
      if (planState.isAuthor && currentUser && isCloudDoc) {
        useSyncStatusStore.getState().setSyncing();
        try {
          await pushCloudDocument(
            {
              id: documentId,
              title: title,
              content: JSON.stringify({ markdown: text, draft: draftMsg }),
              stage: (doc.getMap("meta").get("stage") as any) || "write",
              focus_mode: (doc.getMap("meta").get("focus_mode") as boolean) || false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            currentUser.uid,
            planState.teamId
          );
useSyncStatusStore.getState().setSynced();
         } catch (err: any) {
           if (err?.code !== 'permission-denied') {
             console.error("Cloud sync failed during manual save:", err);
             useSyncStatusStore.getState().setError("Sync failed");
           }
         }
      }

      // Mark as clean on manual save success
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
