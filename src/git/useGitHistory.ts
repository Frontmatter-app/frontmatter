import { useEffect, useState } from 'react';
import { GitCommit } from './types';
import { getGitLog, showFileAtCommit } from './gitCommands';
import { useGitStore } from './gitStore';
import { showAlertDialog } from '../lib/tauriDialog';

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
      return await showFileAtCommit(workspacePath, commitHash, filePath);
    } catch (e) {
      // Swallowing this meant the caller skipped the restore and the document
      // simply did not change, which reads as "that version was identical".
      console.error('Failed to read file at commit', commitHash, e);
      await showAlertDialog(
        'Restore Failed',
        'This version could not be read from the repository. Your document has not been changed.',
      );
      return null;
    }
  };

  return { commits, loading, restoreFromCommit };
}
