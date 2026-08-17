import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMIT_POLICY,
  automaticCommitMessage,
  isCommitPolicy,
  shouldCommit,
  type CommitTrigger,
} from './commitPolicy';

const base: CommitTrigger = {
  requestedByUser: false,
  peersRemaining: 1,
  idleMs: 0,
  dirty: true,
};

describe('shouldCommit', () => {
  it('never commits a document that has not changed', () => {
    for (const policy of ['explicit', 'on-empty', 'on-idle', 'off'] as const) {
      expect(shouldCommit(policy, { ...base, dirty: false, requestedByUser: true })).toBe(false);
    }
  });

  it('honours an explicit request under every policy', () => {
    for (const policy of ['explicit', 'on-empty', 'on-idle', 'off'] as const) {
      expect(shouldCommit(policy, { ...base, requestedByUser: true })).toBe(true);
    }
  });

  it('honours an explicit request even when automatic commits are off', () => {
    // `off` governs automatic behaviour. Someone pressing Commit has plainly
    // overridden it, and a button that silently does nothing is worse than no
    // button.
    expect(shouldCommit('off', { ...base, requestedByUser: true })).toBe(true);
  });

  it('does not commit while people are still editing', () => {
    // The point of the default: an active document produces no commits until
    // somebody decides it should.
    expect(shouldCommit('on-empty', { ...base, peersRemaining: 2 })).toBe(false);
  });

  it('commits when the last peer leaves', () => {
    expect(shouldCommit('on-empty', { ...base, peersRemaining: 0 })).toBe(true);
  });

  it('does not commit on idle under the default policy', () => {
    expect(shouldCommit('on-empty', { ...base, idleMs: 60 * 60 * 1000 })).toBe(false);
  });

  it('commits after a pause under on-idle', () => {
    expect(shouldCommit('on-idle', { ...base, idleMs: 5 * 60 * 1000 })).toBe(true);
  });

  it('does not commit before the pause has elapsed', () => {
    expect(shouldCommit('on-idle', { ...base, idleMs: 1000 })).toBe(false);
  });

  it('respects a custom idle threshold', () => {
    expect(shouldCommit('on-idle', { ...base, idleMs: 2000 }, { idleThresholdMs: 1000 })).toBe(
      true,
    );
  });

  it('never commits automatically under explicit', () => {
    expect(shouldCommit('explicit', { ...base, peersRemaining: 0 })).toBe(false);
    expect(shouldCommit('explicit', { ...base, idleMs: 60 * 60 * 1000 })).toBe(false);
  });

  it('never commits automatically under off', () => {
    expect(shouldCommit('off', { ...base, peersRemaining: 0 })).toBe(false);
  });

  it('defaults to committing when the room empties, not while it is busy', () => {
    expect(DEFAULT_COMMIT_POLICY).toBe('on-empty');
    expect(shouldCommit(DEFAULT_COMMIT_POLICY, { ...base, peersRemaining: 0 })).toBe(true);
    expect(shouldCommit(DEFAULT_COMMIT_POLICY, { ...base, peersRemaining: 1 })).toBe(false);
  });
});

describe('isCommitPolicy', () => {
  it('accepts the four policies', () => {
    expect(['explicit', 'on-empty', 'on-idle', 'off'].every(isCommitPolicy)).toBe(true);
  });

  it('rejects anything else, so a bad config value cannot slip through', () => {
    expect(isCommitPolicy('always')).toBe(false);
    expect(isCommitPolicy(undefined)).toBe(false);
    expect(isCommitPolicy(null)).toBe(false);
  });
});

describe('automaticCommitMessage', () => {
  it('names the file, so an automatic history still says what changed', () => {
    expect(automaticCommitMessage('docs/guide/intro.md', 'empty')).toBe('Update intro.md');
  });

  it('marks an idle flush as an autosave', () => {
    expect(automaticCommitMessage('intro.md', 'idle')).toBe('Update intro.md (autosave)');
  });

  it('handles a path with no directory', () => {
    expect(automaticCommitMessage('README.md', 'empty')).toBe('Update README.md');
  });
});
