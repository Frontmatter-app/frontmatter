/**
 * The open document's relationship with its repository.
 *
 * Answers the four questions the commit UI has to render, in the order they
 * stop mattering: is a provider connected, does this document belong to a
 * repository, is it different from what was committed, and what happened to the
 * last commit.
 *
 * The binding itself is held by `DocumentRegistry`, not by this hook. A hook's
 * state dies with the component, and the sidebar section it feeds unmounts
 * whenever the panel is collapsed — the base revision has to outlive that, or
 * every collapse would silently turn the next commit into a blind overwrite.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveRepositoryContext } from './workspaceRepository';
import { registry } from '../yjs/DocumentRegistry';
import type { CommitOutcome } from '../yjs/gitBackedDocument';
import { resolveDocumentBinding, type DocumentBinding } from './documentBinding';
import { isConnected } from './tokenStore';
import { forgeFor } from './useForgeConnection';
import type * as Y from 'yjs';

/** How often the panel re-checks whether the text has moved past the commit. */
const CHANGE_POLL_MS = 1500;

export type CommitReadiness =
  | 'resolving'
  | 'disconnected'
  | 'unsupported-provider'
  | 'unbound'
  | 'binding-failed'
  | 'ready';

export interface DocumentCommitState {
  readiness: CommitReadiness;
  binding: DocumentBinding | null;
  /** Whether the document differs from the revision it was last committed at. */
  hasChanges: boolean;
  isCommitting: boolean;
  lastOutcome: CommitOutcome | null;
  commit: (message: string) => Promise<void>;
  dismissOutcome: () => void;
  refresh: () => void;
  /** Re-checks for changes now, so the button is right the moment it is used. */
  refreshChanges: () => void;
}

export function useDocumentCommit(options: {
  workspacePath: string | null;
  documentId: string | null;
  filePath: string | null | undefined;
  ydoc: Y.Doc | null;
  /** Skipped entirely while the section is collapsed — it polls. */
  active: boolean;
}): DocumentCommitState {
  const { workspacePath, documentId, filePath, ydoc, active } = options;

  const [readiness, setReadiness] = useState<CommitReadiness>('resolving');
  const [binding, setBinding] = useState<DocumentBinding | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<CommitOutcome | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  // Guards every `setState` after an await: the open document changes while
  // these are in flight — that is the ordinary case, not the rare one.
  const generation = useRef(0);

  useEffect(() => {
    if (!active || !documentId) return;

    const mine = ++generation.current;
    const stale = () => generation.current !== mine;

    void (async () => {
      setReadiness('resolving');

      if (!(await isConnected('github'))) {
        if (stale()) return;
        setBinding(null);
        setReadiness('disconnected');
        return;
      }

      // Shared with the room, and cached: several callers want this one
      // unchanging fact, and each running its own three subprocesses to learn
      // it made opening a document needlessly expensive.
      const repository = await resolveRepositoryContext(workspacePath);
      if (stale()) return;

      const resolved = resolveDocumentBinding(repository, filePath);
      setBinding(resolved);

      if (resolved.status === 'unbound') {
        setReadiness('unbound');
        return;
      }

      // GitHub is the only adapter so far. A GitLab remote parses perfectly
      // well and then has nothing to commit through.
      let forge;
      try {
        forge = forgeFor(resolved.forge.kind);
      } catch {
        setReadiness('unsupported-provider');
        return;
      }

      const attached = await registry.attachGitDocument(documentId, forge, resolved.target);
      if (stale()) return;
      setReadiness(attached ? 'ready' : 'binding-failed');
    })();

    return () => { generation.current++; };
  }, [active, workspacePath, documentId, filePath, reloadToken]);

  // Polled rather than observed. The comparison is against the committed text,
  // which only the commit path moves, so there is nothing to subscribe to on
  // that side — and running a full-document comparison on every keystroke would
  // put the panel's bookkeeping on the typing path.
  const refreshChanges = useCallback(() => {
    if (!documentId || !ydoc) return;
    const git = registry.getGitDocument(documentId);
    if (!git) return;
    setHasChanges(ydoc.getText('markdown').toString() !== git.base.text);
  }, [documentId, ydoc]);

  useEffect(() => {
    if (!active || readiness !== 'ready' || !documentId || !ydoc) {
      setHasChanges(false);
      return;
    }

    refreshChanges();
    const timer = setInterval(refreshChanges, CHANGE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, readiness, documentId, ydoc, lastOutcome, refreshChanges]);

  const commit = useCallback(
    async (message: string) => {
      if (!documentId) return;
      setIsCommitting(true);
      try {
        const outcome = await registry.commitDocument(documentId, message);
        setLastOutcome(outcome);
      } finally {
        setIsCommitting(false);
      }
    },
    [documentId],
  );

  const dismissOutcome = useCallback(() => setLastOutcome(null), []);

  return {
    readiness, binding, hasChanges, isCommitting, lastOutcome,
    commit, dismissOutcome, refresh, refreshChanges,
  };
}
