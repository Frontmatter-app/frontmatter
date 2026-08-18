/**
 * What repository the open workspace is, asked once.
 *
 * Three shell-outs to `git` answer this — root, remote, branch — and several
 * callers want the answer: the commit panel, the room, and anything else that
 * needs to know where a document lives. Left to themselves they each ran their
 * own three, on every render that mattered, so opening a document could cost a
 * dozen subprocesses to learn one unchanging fact.
 *
 * Cached briefly rather than indefinitely. The answer does change — checking
 * out a branch is the ordinary case — and a stale branch would commit to, and
 * open a room for, the wrong one.
 */
import { getCurrentBranch, getRemoteUrl, getRepoRoot } from '../git/gitCommands';
import type { RepositoryContext } from './documentBinding';

const TTL_MS = 5000;

interface CachedContext {
  context: RepositoryContext;
  expiresAt: number;
}

const cache = new Map<string, CachedContext>();
const inFlight = new Map<string, Promise<RepositoryContext>>();

const NO_REPOSITORY: RepositoryContext = { root: null, remoteUrl: null, branch: null };

export async function resolveRepositoryContext(
  workspacePath: string | null,
  options: { refresh?: boolean } = {},
): Promise<RepositoryContext> {
  if (!workspacePath) return NO_REPOSITORY;

  if (!options.refresh) {
    const cached = cache.get(workspacePath);
    if (cached && cached.expiresAt > Date.now()) return cached.context;

    // Two callers asking at once share one answer rather than racing three
    // subprocesses each.
    const pending = inFlight.get(workspacePath);
    if (pending) return pending;
  }

  const work = (async (): Promise<RepositoryContext> => {
    const root = await getRepoRoot(workspacePath);
    if (!root) return NO_REPOSITORY;

    // Read together: a remote from one moment and a branch from another
    // describes a repository state that never existed.
    const [remoteUrl, branch] = await Promise.all([
      getRemoteUrl(root).catch(() => ''),
      getCurrentBranch(root).catch(() => ''),
    ]);

    return { root, remoteUrl, branch };
  })();

  inFlight.set(workspacePath, work);
  try {
    const context = await work;
    cache.set(workspacePath, { context, expiresAt: Date.now() + TTL_MS });
    return context;
  } finally {
    inFlight.delete(workspacePath);
  }
}

/** Drops what is known, so the next ask goes back to git. */
export function forgetRepositoryContext(workspacePath?: string): void {
  if (workspacePath) {
    cache.delete(workspacePath);
    return;
  }
  cache.clear();
}
