/**
 * Git DTOs are defined in Rust and generated into `src/ipc/generated.ts`.
 * Re-exported here so there is exactly one definition and the two sides cannot
 * drift — a mismatch is what hid `shortHash` never being sent to the UI.
 */
export type {
  GitStatusEntry,
  GitStatus,
  GitCommit,
  GitBranch,
} from '../ipc/generated';

/** UI-only state; has no Rust counterpart. */
export type RepoStatus = 'unknown' | 'checking' | 'repo' | 'not-repo' | 'git-not-found';
