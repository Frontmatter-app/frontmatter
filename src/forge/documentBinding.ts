/**
 * Which repository, branch and path an open document belongs to.
 *
 * `remoteUrl.ts` answers "what repository is this workspace"; this answers the
 * narrower question the commit path actually asks: **can this particular open
 * document be committed, and as which file?** Most documents cannot, and for
 * several different reasons — no workspace, a cloud document with no file, a
 * repository with no remote, a detached HEAD. Each of those wants a different
 * sentence in the panel, so the failure is returned as a reason rather than as
 * a bare null.
 *
 * The one thing this must never get wrong is the path. A forge commit addresses
 * a file by its path *within the repository*, and there is no working tree to
 * catch a mistake: committing `chapter.md` when the repository holds
 * `book/chapter.md` does not fail, it silently creates a second file and leaves
 * the real one untouched. So the path is measured from the repository root —
 * which is not always the folder the user opened — and a document that does not
 * sit under that root is refused outright rather than guessed at.
 */
import { parseRemoteUrl, type ForgeTarget } from './remoteUrl';
import type { GitDocumentTarget } from '../yjs/gitBackedDocument';

/** What git says about the folder the workspace is open on. */
export interface RepositoryContext {
  /** Absolute path of the repository root, from `rev-parse --show-toplevel`. */
  root: string | null;
  /** The `origin` URL, or null/empty when the repository has no remote. */
  remoteUrl: string | null;
  /** The checked-out branch. `HEAD` means detached. */
  branch: string | null;
}

export type UnboundReason =
  | 'no-repository'
  | 'no-file'
  | 'outside-repository'
  | 'no-remote'
  | 'unsupported-remote'
  | 'detached-head';

export type DocumentBinding =
  | { status: 'bound'; target: GitDocumentTarget; forge: ForgeTarget }
  | { status: 'unbound'; reason: UnboundReason };

/** Why a document cannot be committed, in words a panel can show as-is. */
export const UNBOUND_MESSAGES: Record<UnboundReason, string> = {
  'no-repository': 'This folder is not a git repository.',
  'no-file': 'This document has no file, so there is nothing to commit.',
  'outside-repository': 'This document lives outside the repository folder.',
  'no-remote': 'This repository has no remote, so there is nowhere to commit to.',
  'unsupported-remote': 'The remote is not a git host Frontmatter can commit to.',
  'detached-head': 'The repository is on a detached HEAD. Check out a branch to commit.',
};

/**
 * Works out where a document would be committed.
 *
 * Pure: every fact it needs is passed in, so the decision can be tested without
 * a repository, a network, or a signed-in account.
 */
export function resolveDocumentBinding(
  repository: RepositoryContext,
  filePath: string | null | undefined,
): DocumentBinding {
  if (!repository.root) return { status: 'unbound', reason: 'no-repository' };

  // Cloud documents are a Yjs history on the sync server with no file anywhere.
  // They are not a failure to report loudly — they simply are not git's.
  if (!filePath) return { status: 'unbound', reason: 'no-file' };

  const path = repositoryRelativePath(repository.root, filePath);
  if (!path) return { status: 'unbound', reason: 'outside-repository' };

  if (!repository.remoteUrl?.trim()) return { status: 'unbound', reason: 'no-remote' };

  const forge = parseRemoteUrl(repository.remoteUrl);
  if (!forge) return { status: 'unbound', reason: 'unsupported-remote' };

  // `rev-parse --abbrev-ref HEAD` reports the literal string `HEAD` when no
  // branch is checked out. Committing to a branch named "HEAD" would either
  // fail or, worse, create one.
  const branch = repository.branch?.trim();
  if (!branch || branch === 'HEAD') return { status: 'unbound', reason: 'detached-head' };

  return { status: 'bound', target: { repo: forge.fullName, branch, path }, forge };
}

/**
 * A file's path relative to the repository root, or null if it is not inside it.
 *
 * Returning null for an outside path is the point. The obvious implementation —
 * strip the prefix if present, otherwise pass the path through — is what
 * `toRepoRelativePath` does for `git show`, where a wrong path merely fails. On
 * a commit it would send an absolute path as the file name.
 */
export function repositoryRelativePath(root: string, filePath: string): string | null {
  const normalisedRoot = normalise(root).replace(/\/+$/, '');
  const normalisedFile = normalise(filePath);
  if (!normalisedRoot || !normalisedFile) return null;

  const prefix = `${normalisedRoot}/`;
  if (normalisedFile.startsWith(prefix)) {
    return normalisedFile.slice(prefix.length) || null;
  }

  // macOS and Windows resolve paths case-insensitively, and the two sides come
  // from different places — the root from git, the file from the workspace
  // scan — so their casing can differ for the same directory. The exact match
  // is tried first so a genuinely case-sensitive filesystem keeps its meaning.
  if (normalisedFile.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalisedFile.slice(prefix.length) || null;
  }

  return null;
}

/** Git speaks in forward slashes whatever the platform writes paths with. */
function normalise(path: string): string {
  return path.trim().replace(/\\/g, '/');
}
