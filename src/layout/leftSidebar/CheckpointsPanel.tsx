import React from 'react';
import * as Y from 'yjs';
import { ChevronDown, ChevronRight, History, RotateCcw } from 'lucide-react';
import { invoke } from '../../filesystem/tauriCommands';
import { restoreSnapshot } from '../../yjs/restoreSnapshot';
import { showConfirmDialog, showPromptDialog } from '../../lib/tauriDialog';
import { useSidebarContext } from '../SidebarContext';
import type { SnapshotMeta } from '../../types';

interface CheckpointsPanelProps {
  ydoc: Y.Doc | null;
  documentId: string | null;
  title?: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Version history for cloud documents.
 *
 * A cloud document's state is a Yjs update log, so a "checkpoint" is an encoded
 * document state rather than a commit, and restoring one applies it back into
 * the live doc — which propagates to every collaborator through the same
 * provider that carries ordinary edits.
 */
export function CheckpointsPanel({ ydoc, documentId, title }: CheckpointsPanelProps) {
  const { currentUserName } = useSidebarContext();
  const [open, setOpen] = React.useState(false);
  const [checkpoints, setCheckpoints] = React.useState<SnapshotMeta[]>([]);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!documentId) return;
    try {
      const snaps = await invoke<SnapshotMeta[]>('get_snapshots', { documentId });
      setCheckpoints(snaps || []);
    } catch {
      setCheckpoints([]);
    }
  }, [documentId]);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, documentId]);

  if (!documentId) return null;

  const createCheckpoint = async () => {
    if (!ydoc) return;
    const label = await showPromptDialog(
      'New Checkpoint',
      `Name this checkpoint of "${title || 'this document'}" (optional):`,
    );
    // A dismissed prompt returns null; an empty string is a deliberate "no name".
    if (label === null) return;

    setBusy(true);
    try {
      const text = ydoc.getText('markdown').toString();
      await invoke('create_snapshot', {
        documentId,
        snapshot: Array.from(Y.encodeStateAsUpdate(ydoc)),
        // Always a string, even when unnamed. A present label is what marks a
        // version as deliberately created, and so exempt from the automatic
        // pruning in `commands/snapshots.rs`; every display site already falls
        // back to a timestamp when it is empty.
        label: label.trim(),
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        author: currentUserName,
      });
      await refresh();
    } catch (e) {
      console.error('Failed to create checkpoint:', e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    if (!ydoc) return;
    const confirmed = await showConfirmDialog(
      'Restore Checkpoint',
      'Apply this checkpoint to the document? Collaborators will see the change.',
    );
    if (!confirmed) return;
    try {
      const data = await invoke<number[]>('get_snapshot_data', { id });
      restoreSnapshot(ydoc, new Uint8Array(data));
    } catch (e) {
      console.error('Failed to restore checkpoint:', e);
    }
  };

  return (
    <div className="border-t border-gray-200/80 pt-4 mt-4 flex-shrink-0 flex flex-col">
      <button
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex items-center justify-between w-full px-2 py-1 rounded-md hover:bg-black/5 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
          <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">Checkpoints</span>
        </div>
        <History className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="flex flex-col pl-4 mt-2 gap-2 text-xs">
          <button
            onClick={createCheckpoint}
            disabled={busy || !ydoc}
            className="w-full px-2 py-1.5 rounded-md bg-black/[0.04] hover:bg-black/[0.07] text-gray-700 font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Create checkpoint'}
          </button>

          {checkpoints.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic px-1">
              No checkpoints yet. Team documents also keep a live edit history.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {checkpoints.slice(0, 5).map(checkpoint => (
                <li key={checkpoint.id} className="group flex items-center justify-between gap-2 px-1 py-1 rounded hover:bg-black/5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-gray-700">
                      {checkpoint.label || relativeTime(checkpoint.created_at)}
                    </p>
                    <p className="truncate text-[10px] text-gray-400">
                      {checkpoint.author ? `${checkpoint.author} · ` : ''}
                      {relativeTime(checkpoint.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => restore(checkpoint.id)}
                    title="Restore this checkpoint"
                    className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-gray-900 p-1 rounded cursor-pointer flex-shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
