export interface GitStatusEntry {
  path: string;
  staged: boolean;
  status: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  entries: GitStatusEntry[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export type RepoStatus = 'unknown' | 'checking' | 'repo' | 'not-repo' | 'git-not-found';
