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

export async function pushChanges(path: string): Promise<void> {
  await invoke('git_push', { path });
}

export async function pullChanges(path: string): Promise<void> {
  await invoke('git_pull', { path });
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

export async function showFileAtCommit(path: string, commit: string, filePath: string): Promise<string> {
  return invoke('git_show_file', { path, commit, filePath });
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
