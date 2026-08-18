/**
 * Committing the open document to its repository.
 *
 * Sits alongside the staging controls, which are a different thing wearing
 * similar words: those run the `git` binary over the folder on disk, this
 * writes the live document through the provider's API against the revision it
 * was last known equal to. The two can disagree — a collaborator's edit reaches
 * this document without ever touching the working tree — so this section says
 * which file, on which branch, of which repository it is about to write, rather
 * than leaving the user to infer it from the panel above.
 *
 * Every reason a document cannot be committed gets its own sentence. "Commit"
 * quietly missing, or present and inert, is the outcome worth avoiding.
 */
import React, { useState } from 'react';
import type * as Y from 'yjs';
import { DsButton, DsTextarea } from '../design/components';
import { automaticCommitMessage } from './commitPolicy';
import { UNBOUND_MESSAGES } from './documentBinding';
import { useDocumentCommit } from './useDocumentCommit';
import { useRoomStore } from '../collab/roomStore';
import './commitDocument.css';

interface Props {
  workspacePath: string | null;
  documentId: string | null;
  filePath: string | null | undefined;
  ydoc: Y.Doc | null;
  /** False while the panel is collapsed, so nothing is polled unseen. */
  active: boolean;
}

export function CommitDocumentSection({ workspacePath, documentId, filePath, ydoc, active }: Props) {
  const {
    readiness, binding, hasChanges, isCommitting, lastOutcome,
    commit, dismissOutcome, refresh, refreshChanges,
  } = useDocumentCommit({ workspacePath, documentId, filePath, ydoc, active });
  const [message, setMessage] = useState('');

  // A commit goes through the forge under this person's own token, so read
  // access means the write would be refused. Better to say so than to offer a
  // button whose only outcome is a 403.
  const isReadOnly = useRoomStore(
    (state) => (documentId ? state.rooms[documentId]?.access === 'read' : false),
  );

  const target = binding?.status === 'bound' ? binding.target : null;
  // An empty box commits under the same name an automatic flush would use, so
  // the button never refuses to work over a message nobody wanted to write.
  const fallbackMessage = target ? automaticCommitMessage(target.path, 'empty') : '';

  // Nothing to say: a document with no file of its own, or a folder that is not
  // a repository, is already explained by the rest of the panel.
  if (
    binding?.status === 'unbound' &&
    (binding.reason === 'no-file' || binding.reason === 'no-repository')
  ) {
    return null;
  }

  const submit = async () => {
    await commit(message.trim() || fallbackMessage);
    setMessage('');
  };

  return (
    <section className="commit-doc">
      <h4 className="commit-doc__title">Commit this document</h4>

      {readiness === 'resolving' && <p className="commit-doc__hint">Checking the repository…</p>}

      {readiness === 'disconnected' && (
        <p className="commit-doc__hint">
          Connect a git provider under Settings → Version Control to commit this document.
        </p>
      )}

      {readiness === 'unsupported-provider' && (
        <p className="commit-doc__hint">
          {binding?.status === 'bound' ? binding.forge.kind : 'This provider'} cannot be committed to
          yet. GitHub is the only provider with an adapter so far.
        </p>
      )}

      {readiness === 'unbound' && binding?.status === 'unbound' && (
        <p className="commit-doc__hint">{UNBOUND_MESSAGES[binding.reason]}</p>
      )}

      {readiness === 'binding-failed' && (
        <div className="commit-doc__row">
          <p className="commit-doc__hint">
            Could not read this file from the repository — check the connection and try again.
          </p>
          <DsButton size="sm" variant="ghost" onClick={refresh}>
            Retry
          </DsButton>
        </div>
      )}

      {readiness === 'ready' && target && isReadOnly && (
        <p className="commit-doc__hint">
          You have read access to {target.repo}, so this document cannot be committed to it. Ask an
          administrator for write access.
        </p>
      )}

      {readiness === 'ready' && target && !isReadOnly && (
        <>
          <p className="commit-doc__target">
            <span className="commit-doc__repo">{target.repo}</span>
            <span className="commit-doc__separator">on</span>
            <span className="commit-doc__branch">{target.branch}</span>
          </p>
          <p className="commit-doc__path" title={target.path}>
            {target.path}
          </p>

          <p className="commit-doc__hint">
            {hasChanges
              ? 'This document differs from the committed version.'
              : 'Up to date with the branch.'}
          </p>

          <DsTextarea
            className="commit-doc__message"
            rows={2}
            value={message}
            placeholder={fallbackMessage}
            disabled={isCommitting}
            onChange={(event) => setMessage(event.target.value)}
            // The change check is polled, so someone who types and reaches
            // straight for Commit would otherwise find it disabled for another
            // second. Touching the message box is the moment to be certain.
            onFocus={refreshChanges}
            aria-label="Commit message"
          />

          <DsButton
            size="sm"
            variant="primary"
            disabled={isCommitting || !hasChanges}
            onClick={submit}
          >
            {isCommitting ? 'Committing…' : 'Commit'}
          </DsButton>
        </>
      )}

      {lastOutcome && <CommitOutcomeNotice outcome={lastOutcome} onDismiss={dismissOutcome} />}
    </section>
  );
}

/**
 * What the last commit did.
 *
 * A reconciled commit is reported as its own outcome rather than folded into
 * success: the document on screen changed as part of committing it, because the
 * branch had moved, and someone who is not told that will wonder who edited
 * their text. A rejected hunk is stronger still — a commit that exists on the
 * branch could not be placed, and only a person can decide what to do about it.
 */
function CommitOutcomeNotice({
  outcome,
  onDismiss,
}: {
  outcome: NonNullable<ReturnType<typeof useDocumentCommit>['lastOutcome']>;
  onDismiss: () => void;
}) {
  if (outcome.status === 'unchanged') {
    return (
      <p className="commit-doc__notice" onClick={onDismiss}>
        Nothing to commit — the branch already has this version.
      </p>
    );
  }

  if (outcome.status === 'failed') {
    return (
      <p className="commit-doc__notice commit-doc__notice--error" onClick={onDismiss}>
        {outcome.error.message}
      </p>
    );
  }

  const shortSha = outcome.commit.sha.slice(0, 7);

  return (
    <div className="commit-doc__notice commit-doc__notice--success">
      <p>
        Committed as{' '}
        <a href={outcome.commit.url} target="_blank" rel="noreferrer">
          {shortSha}
        </a>
        {outcome.status === 'reconciled' && ' after merging changes from the branch'}.
      </p>
      {outcome.status === 'reconciled' && outcome.rejected.length > 0 && (
        <p className="commit-doc__notice--warning">
          {outcome.rejected.length === 1 ? 'One change' : `${outcome.rejected.length} changes`} from
          the branch could not be placed in this document and were left out. Review the branch
          before continuing.
        </p>
      )}
    </div>
  );
}
