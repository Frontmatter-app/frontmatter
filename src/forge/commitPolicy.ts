/**
 * When a collaborative document should become a commit.
 *
 * The tension this resolves: commit too often and the history becomes an
 * autosave log nobody can read; commit too rarely and work sits unsaved. The
 * resolution is that **git is not the durability mechanism** — the room's
 * snapshot store already makes losing the process safe. That frees commits to
 * be meaningful rather than frequent.
 *
 * Default is `on-empty`: explicit commits whenever someone asks, plus one flush
 * when the last peer leaves. A document being actively edited produces no
 * commits at all until somebody decides it should, and closing the room never
 * loses anything.
 */

export type CommitPolicy = 'explicit' | 'on-empty' | 'on-idle' | 'off';

export const DEFAULT_COMMIT_POLICY: CommitPolicy = 'on-empty';

export const COMMIT_POLICY_LABELS: Record<CommitPolicy, string> = {
  explicit: 'Only when I commit',
  'on-empty': 'When I commit, and when everyone closes the document',
  'on-idle': 'When I commit, when everyone closes, and after a pause',
  off: 'Never commit automatically',
};

export interface CommitTrigger {
  /** A person asked for it. Always honoured, whatever the policy. */
  requestedByUser: boolean;
  /** Peers still attached to the room, excluding the one deciding. */
  peersRemaining: number;
  /** Milliseconds since the document last changed. */
  idleMs: number;
  /** Whether the text differs from the last committed revision. */
  dirty: boolean;
}

export interface PolicyOptions {
  idleThresholdMs?: number;
}

const DEFAULT_IDLE_MS = 5 * 60 * 1000;

/**
 * Whether to commit now.
 *
 * An explicit request always wins, including under `off`: that setting governs
 * automatic behaviour, and a person clicking Commit has plainly overridden it.
 * Treating `off` as "refuse to commit" would leave someone with a button that
 * silently does nothing.
 */
export function shouldCommit(
  policy: CommitPolicy,
  trigger: CommitTrigger,
  options: PolicyOptions = {},
): boolean {
  if (!trigger.dirty) return false;
  if (trigger.requestedByUser) return true;
  if (policy === 'off' || policy === 'explicit') return false;

  const roomIsEmpty = trigger.peersRemaining === 0;
  if (roomIsEmpty) return true;

  if (policy === 'on-idle') {
    return trigger.idleMs >= (options.idleThresholdMs ?? DEFAULT_IDLE_MS);
  }

  return false;
}

export function isCommitPolicy(value: unknown): value is CommitPolicy {
  return value === 'explicit' || value === 'on-empty' || value === 'on-idle' || value === 'off';
}

/**
 * A commit message for a flush nobody typed one for.
 *
 * Named after the file rather than something generic, so a history of automatic
 * commits still says which document each one touched.
 */
export function automaticCommitMessage(path: string, reason: 'empty' | 'idle'): string {
  const name = path.split('/').pop() || path;
  return reason === 'empty'
    ? `Update ${name}`
    : `Update ${name} (autosave)`;
}
