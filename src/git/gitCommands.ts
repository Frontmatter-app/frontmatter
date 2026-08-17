import { GitBranch, GitCommit, GitStatus, RepoStatus } from './types';
import { invoke } from '../filesystem/tauriCommands';

export async function checkGitAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('git_is_available', {});
  } catch {
    return false;
  }
}

export async function checkIsRepo(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>('git_is_repo', { path });
  } catch {
    return false;
  }
}

export async function initRepo(path: string): Promise<void> {
  await invoke('git_init', { path });
}

/** Makes sure the workspace's own storage is ignored by an existing repository. */
export async function ensureGitIgnores(path: string): Promise<void> {
  await invoke('git_ensure_ignores', { path });
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  return invoke('git_status', { path });
}

export async function stageFiles(path: string, files: string[]): Promise<void> {
  await invoke('git_add', { path, files });
}

export async function unstageFiles(path: string, files: string[]): Promise<void> {
  await invoke('git_unstage', { path, files });
}

export async function commitChanges(path: string, message: string): Promise<string> {
  return invoke('git_commit', { path, message });
}

/**
 * The token for the connected provider, or null.
 *
 * Read per operation rather than held: it is needed only for the lifetime of
 * one subprocess, and the Rust side passes it through the child's environment
 * so it reaches neither `.git/config` nor `ps`.
 *
 * A failure here is not propagated. Someone whose own credential helper already
 * works has never needed an account connected in the app, and breaking their
 * push because a keychain read failed would be a regression for them.
 */
async function forgeToken(): Promise<string | null> {
  try {
    const { readToken } = await import('../forge/tokenStore');
    return await readToken('github');
  } catch {
    return null;
  }
}

export async function pushChanges(
  path: string,
  options: { remote?: string; branch?: string } = {},
): Promise<void> {
  await invoke('git_push', {
    path,
    remote: options.remote ?? null,
    branch: options.branch ?? null,
    token: await forgeToken(),
  });
}

export async function pullChanges(
  path: string,
  options: { remote?: string; branch?: string } = {},
): Promise<void> {
  await invoke('git_pull', {
    path,
    remote: options.remote ?? null,
    branch: options.branch ?? null,
    token: await forgeToken(),
  });
}

export async function getGitLog(path: string, filePath?: string): Promise<GitCommit[]> {
  return invoke('git_log', { path, filePath });
}

export async function getGitBranches(path: string): Promise<GitBranch[]> {
  return invoke('git_branches', { path });
}

export async function getCurrentBranch(path: string): Promise<string> {
  return invoke('git_current_branch', { path });
}

export async function checkoutBranch(path: string, branch: string): Promise<void> {
  await invoke('git_checkout', { path, branch });
}

export async function createBranch(path: string, name: string): Promise<void> {
  await invoke('git_create_branch', { path, name });
}

export async function hasRemoteChanges(path: string): Promise<boolean> {
  return invoke('git_has_remote_changes', { path });
}

export async function hasRemote(path: string): Promise<boolean> {
  return invoke('git_has_remote', { path });
}

export async function readGitignore(path: string): Promise<string[]> {
  return invoke('git_read_gitignore', { path });
}

export async function writeGitignore(path: string, patterns: string[]): Promise<void> {
  await invoke('git_write_gitignore', { path, patterns });
}

/**
 * Makes a workspace path repository-relative, which is the only form
 * `git show <commit>:<path>` accepts. Already-relative paths pass through.
 */
export function toRepoRelativePath(workspacePath: string, filePath: string): string {
  if (!workspacePath || !filePath.startsWith(workspacePath)) return filePath;
  return filePath.slice(workspacePath.length).replace(/^\/+/, '');
}

/**
 * Reads a file as it stood at a commit.
 *
 * The path is relativised here rather than at the call site. `git show` fails
 * on an absolute path, and of the two callers only one remembered to convert —
 * so restoring a version worked from the diff view and silently did nothing
 * from the history dropdown.
 */
export async function showFileAtCommit(path: string, commit: string, filePath: string): Promise<string> {
  return invoke('git_show_file', { path, commit, filePath: toRepoRelativePath(path, filePath) });
}

export async function addRemote(path: string, name: string, url: string): Promise<void> {
  await invoke('git_add_remote', { path, name, url });
}

export async function getRemoteUrl(path: string): Promise<string> {
  return invoke('git_get_remote_url', { path });
}

export interface CloneResult {
  path: string;
  success: boolean;
  error?: string;
}

export async function cloneRepository(url: string, destination: string): Promise<CloneResult> {
  return invoke('git_clone', { url, destination });
}
