/**
 * A document whose system of record is a git repository.
 *
 * Binds one Yjs text to one path on one branch, and commits it. The invariant
 * that makes this work is `baseCommit` / `baseText`: the exact revision this
 * document was last known equal to on the branch. Without a genuine common
 * ancestor a three-way merge has nothing to merge against, and reconciliation
 * degrades into overwriting one side with the other.
 *
 * Durability is deliberately *not* this class's job. The room's snapshot store
 * is what makes losing the process safe; committing on every keystroke would
 * fill the history with noise, and committing rarely would risk work only if
 * git were the sole copy. It is not. That separation is what allows commits to
 * stay meaningful.
 */
import type * as Y from 'yjs';
import type { ForgePort } from '../forge/ports';
import { ForgeConflictError, type CommitResult } from '../forge/types';
import { reconcileIntoDocument } from './gitReconcile';

export interface GitDocumentTarget {
  repo: string;
  branch: string;
  path: string;
}

export interface CommitOptions {
  message: string;
  /** Rendered as `Co-authored-by:` trailers. */
  coAuthors?: Array<{ name: string; email: string }>;
}

export type CommitOutcome =
  | { status: 'committed'; commit: CommitResult; text: string }
  | { status: 'unchanged' }
  | { status: 'reconciled'; commit: CommitResult; text: string; rejected: string[] }
  | { status: 'failed'; error: Error };

/** How many times to re-merge when the branch keeps moving underneath us. */
const MAX_ATTEMPTS = 3;

export class GitBackedDocument {
  private baseCommit: string | null = null;
  private baseText = '';

  constructor(
    private readonly forge: ForgePort,
    readonly target: GitDocumentTarget,
    private readonly text: Y.Text,
  ) {}

  /** What the branch held when this document was last in step with it. */
  get base(): { commit: string | null; text: string } {
    return { commit: this.baseCommit, text: this.baseText };
  }

  /**
   * Loads the file from the branch into the document.
   *
   * A file that does not exist yet is not an error — it is a document about to
   * be created, with an empty base.
   */
  async load(): Promise<void> {
    const { repo, branch, path } = this.target;
    const file = await this.forge.getFile(repo, path, branch);

    if (!file) {
      this.baseCommit = await this.forge.getRef(repo, branch);
      this.baseText = '';
      return;
    }

    this.baseCommit = file.commitSha;
    this.baseText = file.text;

    // Seeding an empty document is the only case where the file's contents can
    // be written in wholesale. Anything else must go through reconciliation, or
    // a peer's unsaved work would be replaced by what the branch happens to
    // hold.
    if (this.text.toString() === '') {
      this.text.insert(0, file.text);
    } else {
      reconcileIntoDocument(this.text, '', file.text);
    }
  }

  /**
   * Adopts the branch as this document's base without touching its text.
   *
   * The counterpart to `load`, and the difference between them matters enough
   * to state plainly. `load` is for a document whose *only* home is the
   * repository: it has nothing until the branch supplies it. A document already
   * open in a workspace is the other case — the text on screen came from the
   * file on disk and is the working copy, quite legitimately ahead of what has
   * been committed. Calling `load` on one of those would merge the branch into
   * text that already contains it, against an empty base, and the document
   * would end up holding two interleaved copies of itself.
   *
   * So this reads the branch for one purpose only: to record the revision the
   * next commit is authored against. That is what turns the commit into a
   * conflict-detecting write rather than a blind overwrite of whatever anyone
   * else has pushed.
   */
  async attach(): Promise<void> {
    const { repo, branch, path } = this.target;
    const file = await this.forge.getFile(repo, path, branch);

    if (!file) {
      // Not yet in the repository — an unversioned file about to become its
      // first commit. The empty base makes every line of it an addition.
      this.baseCommit = await this.forge.getRef(repo, branch);
      this.baseText = '';
      return;
    }

    this.baseCommit = file.commitSha;
    this.baseText = file.text;
  }

  /**
   * Commits the document's current text.
   *
   * When the branch has not moved this is a single write. When it has, the
   * remote revision is merged into the live document first — as CRDT
   * operations, so collaborators converge on the merged text and their cursors
   * and comment anchors survive — and the merged result is what gets committed.
   *
   * The loop exists because the branch can move again while we are merging.
   * Retrying re-reads the branch and merges from the newer base rather than
   * forcing a write over whatever arrived in between.
   */
  async commit(options: CommitOptions): Promise<CommitOutcome> {
    let reconciled = false;
    let rejected: string[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = this.text.toString();

      if (current === this.baseText) {
        return reconciled
          ? // The merge left the document identical to the branch: somebody
            // else committed exactly our change. Nothing to write, but the
            // document did move, so the caller is told.
            { status: 'unchanged' }
          : { status: 'unchanged' };
      }

      try {
        const commit = await this.forge.commit(this.target.repo, {
          branch: this.target.branch,
          message: options.message,
          changes: [{ path: this.target.path, content: current }],
          expectedHeadSha: this.baseCommit ?? undefined,
          coAuthors: options.coAuthors,
        });

        this.baseCommit = commit.sha;
        this.baseText = current;

        return reconciled
          ? { status: 'reconciled', commit, text: current, rejected }
          : { status: 'committed', commit, text: current };
      } catch (error) {
        if (!(error instanceof ForgeConflictError)) {
          return { status: 'failed', error: error as Error };
        }

        const merged = await this.mergeRemote();
        if (!merged) {
          return {
            status: 'failed',
            error: new Error('The branch moved and its new state could not be read.'),
          };
        }
        reconciled = true;
        rejected = merged.rejected;
      }
    }

    return {
      status: 'failed',
      error: new Error(
        'The branch kept changing while saving. Try again, or commit from the git panel.',
      ),
    };
  }

  /** Pulls the branch's current revision and merges it into the document. */
  private async mergeRemote(): Promise<{ rejected: string[] } | null> {
    const { repo, branch, path } = this.target;

    const head = await this.forge.getRef(repo, branch);
    if (!head) return null;

    const file = await this.forge.getFile(repo, path, branch);
    // A file deleted on the branch. Treated as an empty remote rather than as
    // an instruction to delete: the merge then keeps whatever is being written
    // locally, which is the safer default when the two disagree about whether
    // the document should exist.
    const remoteText = file?.text ?? '';

    const result = reconcileIntoDocument(this.text, this.baseText, remoteText);

    this.baseCommit = head;
    this.baseText = remoteText;

    return { rejected: result.rejected };
  }
}
