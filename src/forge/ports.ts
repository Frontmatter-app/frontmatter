/**
 * The git hosting boundary.
 *
 * Follows the convention in `src/data/ports.ts`: an interface with at least two
 * implementations — a real provider adapter and an in-memory fake — so callers
 * are testable without a network or a live account.
 *
 * Two design decisions worth stating, because they are easy to reverse by
 * accident:
 *
 * **Commits go through the provider's API, not a working tree.** GitHub's Git
 * Data API and GitLab's Commits API both create multi-file commits in one call,
 * so nothing here needs a clone, a checkout, or the `git` binary. That keeps
 * committing available to a client that has only a token.
 *
 * **Tokens never leave the client.** The collaboration server is not given
 * repository credentials; the desktop app commits using a token held in the
 * operating system keychain. A compromised sync server therefore cannot write
 * to anybody's repository.
 */
import type {
  Branch,
  Collaborator,
  CommitRequest,
  CommitResult,
  FileContent,
  ForgeAccount,
  ForgeKind,
  Repo,
  TreeEntry,
} from './types';

export interface ForgePort {
  readonly kind: ForgeKind;

  /** The signed-in account, or null when the token is missing or rejected. */
  getAccount(): Promise<ForgeAccount | null>;

  /** Repositories the account can reach, most recently updated first. */
  listRepos(options?: { search?: string; limit?: number }): Promise<Repo[]>;

  getRepo(fullName: string): Promise<Repo | null>;

  listBranches(fullName: string): Promise<Branch[]>;

  /** The tip commit of a branch. The basis for detecting a moved ref. */
  getRef(fullName: string, branch: string): Promise<string | null>;

  /**
   * Directory listing at a path.
   *
   * `recursive` fetches the whole subtree in one call, which providers cap —
   * callers must tolerate a truncated result rather than assume completeness.
   */
  listTree(
    fullName: string,
    options?: { branch?: string; path?: string; recursive?: boolean },
  ): Promise<TreeEntry[]>;

  /** Reads a file. Resolves null when it does not exist on that branch. */
  getFile(fullName: string, path: string, branch?: string): Promise<FileContent | null>;

  /**
   * Creates a commit containing every change, atomically.
   *
   * Throws `ForgeConflictError` when `expectedHeadSha` no longer matches the
   * branch tip — the signal to reconcile rather than overwrite.
   */
  commit(fullName: string, request: CommitRequest): Promise<CommitResult>;

  /**
   * Who may touch this repository, and how.
   *
   * The basis for team membership: the roster is the repository's, not a
   * separate table that has to be kept in step with it.
   */
  listCollaborators(fullName: string): Promise<Collaborator[]>;
}

/** Supplies the token for a forge adapter, so storage stays out of the adapter. */
export interface TokenProvider {
  getToken(): Promise<string | null>;
}
