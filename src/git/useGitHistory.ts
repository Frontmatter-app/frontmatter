import { useEffect, useState } from 'react';
import { GitCommit } from './types';
import { getGitLog, showFileAtCommit } from './gitCommands';
import { useGitStore } from './gitStore';

export function useGitHistory(workspacePath: string | null, filePath: string | null) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const status = useGitStore(s => s.status);

  useEffect(() => {
    if (!workspacePath || !filePath) { setCommits([]); return; }
    setLoading(true);
    getGitLog(workspacePath, filePath)
      .then(c => setCommits(c))
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, [workspacePath, filePath, status]);

  const restoreFromCommit = async (commitHash: string) => {
    if (!workspacePath || !filePath) return null;
    try {
      const content = await showFileAtCommit(workspacePath, commitHash, filePath);
      return content;
    } catch {
      return null;
    }
  };

  return { commits, loading, restoreFromCommit };
}
