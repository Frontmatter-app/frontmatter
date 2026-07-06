import { create } from 'zustand';
import { GitCommit, GitStatus, RepoStatus } from './types';

interface GitStore {
  repoStatus: RepoStatus;
  workspacePath: string | null;
  setRepoStatus: (status: RepoStatus) => void;
  setWorkspacePath: (path: string | null) => void;
  
  status: GitStatus | null;
  setStatus: (status: GitStatus | null) => void;
  
  commits: GitCommit[];
  setCommits: (commits: GitCommit[]) => void;
  
  isCommitting: boolean;
  setIsCommitting: (v: boolean) => void;
  isPushing: boolean;
  setIsPushing: (v: boolean) => void;
  isPulling: boolean;
  setIsPulling: (v: boolean) => void;
  
  error: string | null;
  setError: (e: string | null) => void;
  
  branchMenuOpen: boolean;
  setBranchMenuOpen: (v: boolean) => void;
  newBranchName: string;
  setNewBranchName: (v: string) => void;
}

export const useGitStore = create<GitStore>((set) => ({
  repoStatus: 'unknown',
  workspacePath: null,
  setRepoStatus: (repoStatus) => set({ repoStatus }),
  setWorkspacePath: (workspacePath) => set({ workspacePath }),
  
  status: null,
  setStatus: (status) => set({ status }),
  
  commits: [],
  setCommits: (commits) => set({ commits }),
  
  isCommitting: false,
  setIsCommitting: (isCommitting) => set({ isCommitting }),
  isPushing: false,
  setIsPushing: (isPushing) => set({ isPushing }),
  isPulling: false,
  setIsPulling: (isPulling) => set({ isPulling }),
  
  error: null,
  setError: (error) => set({ error }),
  
  branchMenuOpen: false,
  setBranchMenuOpen: (branchMenuOpen) => set({ branchMenuOpen }),
  newBranchName: '',
  setNewBranchName: (newBranchName) => set({ newBranchName }),
}));
