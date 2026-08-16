/**
 * Git hosting provider types.
 *
 * "Forge" rather than "GitHub" throughout, deliberately. GitHub is one
 * instance, and naming the abstraction after it is how a codebase ends up with
 * GitHub assumptions in places that never meant to have them. GitLab, Gitea and
 * a plain remote are all first-class.
 */

export type ForgeKind = 'github' | 'gitlab' | 'gitea';

export interface ForgeAccount {
  kind: ForgeKind;
  /** The provider's own id, stable across renames. */
  id: string;
  /** Handle as the provider displays it. */
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** May be null: providers let users hide their address. */
  email: string | null;
}

export interface Repo {
  id: string;
  /** `owner/name`, as a user would type it. */
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  cloneUrl: string;
  /** What the signed-in account may do. Drives read-only UI. */
  permission: RepoPermission;
  updatedAt: string;
}

export type RepoPermission = 'read' | 'write' | 'admin';

export interface Branch {
  name: string;
  /** Commit sha at the tip. */
  sha: string;
  protected: boolean;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'directory';
  sha: string;
  /** Bytes. Absent for directories, and for providers that omit it. */
  size?: number;
}

export interface FileContent {
  path: string;
  text: string;
  /** Blob sha — the file's identity, not the commit's. */
  sha: string;
  /** Commit the content was read at, so a writer can detect a moved ref. */
  commitSha: string;
}

export interface Collaborator {
  login: string;
  id: string;
  permission: RepoPermission;
  avatarUrl: string | null;
}

/** One file's desired state in a commit. `null` content deletes it. */
export interface FileChange {
  path: string;
  content: string | null;
}

export interface CommitRequest {
  branch: string;
  message: string;
  changes: FileChange[];
  /**
   * The commit this change was authored against.
   *
   * The forge rejects the write if the branch has moved past it, which is what
   * turns a blind overwrite into a detectable conflict the caller can
   * reconcile. Omitting it means "whatever the tip is", which is only safe when
   * nothing else could be writing.
   */
  expectedHeadSha?: string;
  /**
   * Additional authors, rendered as `Co-authored-by:` trailers.
   *
   * A collaborative editing session produces one commit containing several
   * people's writing. Attributing it solely to whoever happened to flush the
   * room would be a quiet lie about who wrote what.
   */
  coAuthors?: Array<{ name: string; email: string }>;
}

export interface CommitResult {
  sha: string;
  url: string;
}

/** Raised when the branch moved between read and write. */
export class ForgeConflictError extends Error {
  constructor(
    readonly branch: string,
    readonly expectedSha: string,
    readonly actualSha: string | null,
  ) {
    super(
      `The branch "${branch}" has moved since this change was based on ${expectedSha.slice(0, 7)}.`,
    );
    this.name = 'ForgeConflictError';
  }
}

export class ForgeAuthError extends Error {
  constructor(message = 'The connection to your git provider is no longer valid.') {
    super(message);
    this.name = 'ForgeAuthError';
  }
}

export class ForgeRateLimitError extends Error {
  constructor(readonly resetAt: Date | null) {
    super(
      resetAt
        ? `Rate limited by the provider until ${resetAt.toLocaleTimeString()}.`
        : 'Rate limited by the provider.',
    );
    this.name = 'ForgeRateLimitError';
  }
}
