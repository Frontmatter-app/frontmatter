import * as Y from 'yjs';

/**
 * Restores a document to the text captured in a snapshot.
 *
 * Both callers used to do `Y.applyUpdate(ydoc, snapshotBytes)`, which is a
 * *merge*, not a restore. A CRDT update only ever adds information: applying an
 * old full-state update re-inserts everything deleted since the snapshot and
 * removes nothing added since. Restoring a version could only ever grow the
 * document, which is close to the opposite of what the button promises.
 *
 * Materialising the snapshot in a scratch document and splicing its text in is
 * what actually restores — and it stays a normal CRDT edit, so it merges
 * sensibly for anyone else in the document rather than resurrecting their
 * deletions too.
 *
 * @param origin Transaction origin, so callers can exclude the restore from
 *   undo or from their own change handlers.
 */
export function restoreSnapshot(ydoc: Y.Doc, snapshot: Uint8Array, origin: unknown = 'snapshot-restore'): void {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, snapshot);

    const restoredMarkdown = scratch.getText('markdown').toString();
    const restoredDraft = scratch.getText('draft').toString();

    ydoc.transact(() => {
      const markdown = ydoc.getText('markdown');
      if (markdown.toString() !== restoredMarkdown) {
        markdown.delete(0, markdown.length);
        markdown.insert(0, restoredMarkdown);
      }

      // Only touched when the snapshot actually carried a draft, so restoring a
      // version of the prose does not silently wipe the outline.
      if (restoredDraft) {
        const draft = ydoc.getText('draft');
        if (draft.toString() !== restoredDraft) {
          draft.delete(0, draft.length);
          draft.insert(0, restoredDraft);
        }
      }
    }, origin);
  } finally {
    scratch.destroy();
  }
}
