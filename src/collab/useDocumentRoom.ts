/**
 * Putting the open document in its room.
 *
 * Mounted once, high up, and always — not from the version-control panel. A
 * document that only joined its room while a sidebar section happened to be
 * expanded would mean two people could have the same file open, both signed in,
 * and still not see each other because one of them had the sidebar collapsed.
 *
 * Everything here fails softly. No repository, no remote, no provider
 * connected, no sync server, no signed-in account: each leaves the document
 * exactly as usable as it was, and alone. Collaboration is the addition, never
 * the precondition.
 */
import { useEffect, useRef, useState } from 'react';
import { resolveDocumentBinding } from '../forge/documentBinding';
import { resolveRepositoryContext } from '../forge/workspaceRepository';
import { forgeFor } from '../forge/useForgeConnection';
import { isConnected } from '../forge/tokenStore';
import { registry } from '../yjs/DocumentRegistry';
import type { RoomAccess } from './roomGrant';

export interface DocumentRoomState {
  /** Whether this document is in a live room. */
  connected: boolean;
  /** What this peer may do, once a room exists. */
  access: RoomAccess | null;
  /** Whether the server confirmed our repository access or took it on trust. */
  verification: 'verified' | 'unverified' | null;
}

const IDLE: DocumentRoomState = { connected: false, access: null, verification: null };

export function useDocumentRoom(options: {
  workspacePath: string | null;
  currentDocumentId: string | null;
  filePath: string | null | undefined;
}): DocumentRoomState {
  const { workspacePath, currentDocumentId: documentId, filePath } = options;
  const [state, setState] = useState<DocumentRoomState>(IDLE);

  // The open document changes while these awaits are in flight — that is the
  // ordinary case, not the rare one.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const stale = () => generation.current !== mine;

    setState(IDLE);
    if (!documentId || !filePath || !workspacePath) return;

    void (async () => {
      if (!(await isConnected('github'))) return;
      if (stale()) return;

      const repository = await resolveRepositoryContext(workspacePath);
      if (stale()) return;

      const binding = resolveDocumentBinding(repository, filePath);
      if (binding.status !== 'bound') return;

      let forge;
      try {
        forge = forgeFor(binding.forge.kind);
      } catch {
        // A provider with no adapter yet. The document is still a file, and
        // still perfectly editable on its own.
        return;
      }

      // The binding must exist before the room does: joining needs the
      // committed text, which is what the binding establishes, and without it
      // the room would be seeded from whatever this machine happens to hold.
      const bound = await registry.attachGitDocument(documentId, forge, binding.target);
      if (!bound || stale()) return;

      const room = await registry.attachRoom(documentId, forge, {
        provider: binding.forge.kind,
        host: binding.forge.host,
        repo: binding.target.repo,
        branch: binding.target.branch,
        path: binding.target.path,
      });
      if (!room || stale()) return;

      setState({ connected: true, access: room.access, verification: null });
    })();

    return () => { generation.current++; };
  }, [workspacePath, documentId, filePath]);

  return state;
}
