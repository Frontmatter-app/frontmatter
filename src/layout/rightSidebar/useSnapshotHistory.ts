import { useState } from "react";
import { invoke } from "../../filesystem/tauriCommands";
import * as Y from "yjs";
import { SnapshotMeta } from "../../types";
import { showConfirmDialog } from "../../lib/tauriDialog";

interface UseSnapshotHistoryOpts {
  currentDocumentId: string | null;
  activeVersionId: string | null;
  setActiveVersionId: (id: string | null) => void;
  ydoc: Y.Doc | null;
  currentUserName?: string;
}

export function useSnapshotHistory({ currentDocumentId, activeVersionId, setActiveVersionId, ydoc, currentUserName }: UseSnapshotHistoryOpts) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);

  const fetchSnapshots = async () => {
    if (!currentDocumentId) return;
    try {
      const snaps: SnapshotMeta[] = await invoke("get_snapshots", { documentId: currentDocumentId });
      setSnapshots(snaps || []);
    } catch (e) { console.error(e); }
  };

  const createSnapshot = async (label?: string) => {
    if (!currentDocumentId || !ydoc) return;
    try {
      const text = ydoc.getText("markdown").toString();
      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      await invoke<SnapshotMeta>("create_snapshot", {
        documentId: currentDocumentId,
        snapshot: Array.from(Y.encodeStateAsUpdate(ydoc)),
        label,
        word_count: wordCount,
        author: currentUserName,
      });
      await fetchSnapshots();
    } catch (e) { console.error("Failed to create snapshot:", e); }
  };

  const handleRestoreSnap = async (snapId: string) => {
    if (!ydoc) return;
    if (await showConfirmDialog("Restore Version", "Are you sure you want to restore this version?")) {
      try {
        const data: number[] = await invoke("get_snapshot_data", { id: snapId });
        Y.applyUpdate(ydoc, new Uint8Array(data));
        setActiveVersionId(null);
      } catch (e) { console.error("Failed to restore snapshot:", e); }
    }
  };

  const handleDeleteSnap = async (snapId: string) => {
    if (await showConfirmDialog("Delete Version", "Are you sure you want to delete this version?")) {
      try {
        await invoke("delete_snapshot", { id: snapId });
        if (activeVersionId === snapId) setActiveVersionId(null);
        await fetchSnapshots();
      } catch (e) { console.error("Failed to delete snapshot:", e); }
    }
  };

  const handleClearHistory = async () => {
    if (await showConfirmDialog("Clear History", "Are you sure you want to clear the ENTIRE snapshot history?")) {
      try {
        await invoke("clear_document_history", { documentId: currentDocumentId! });
        setActiveVersionId(null);
        await fetchSnapshots();
      } catch (e) { console.error("Failed to clear history:", e); }
    }
  };

  return { snapshots, fetchSnapshots, createSnapshot, handleRestoreSnap, handleDeleteSnap, handleClearHistory };
}
