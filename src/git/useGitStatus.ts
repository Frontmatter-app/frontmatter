import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useGitStore } from './gitStore';
import { checkGitAvailable, checkIsRepo, getGitStatus, hasRemoteChanges, getCurrentBranch, getGitLog } from './gitCommands';

export function useGitStatus(workspacePath: string | null, currentDocumentPath: string | null) {
  const store = useGitStore();
  const workspacePathRef = useRef(workspacePath);
  const currentDocumentPathRef = useRef(currentDocumentPath);

  useEffect(() => { workspacePathRef.current = workspacePath; }, [workspacePath]);
  useEffect(() => { currentDocumentPathRef.current = currentDocumentPath; }, [currentDocumentPath]);

  const refresh = useCallback(async () => {
    const path = workspacePathRef.current;
    const docPath = currentDocumentPathRef.current;
    if (!path) return;

    store.setRepoStatus('checking');
    try {
      const available = await checkGitAvailable();
      if (!available) {
        store.setRepoStatus('git-not-found');
        return;
      }
      const isRepo = await checkIsRepo(path);
      if (!isRepo) {
        store.setRepoStatus('not-repo');
        store.setStatus(null);
        return;
      }
      const status = await getGitStatus(path);
      store.setStatus(status);
      store.setRepoStatus('repo');
      store.setError(null);

      try { store.setCommits(await getGitLog(path, docPath || undefined)); } catch {}
      try {
        const remoteChanges = await hasRemoteChanges(path);
        if (remoteChanges) store.setError('Remote has updates');
      } catch {}
    } catch (e) {
      store.setRepoStatus('repo');
      store.setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, []);

  const refreshStatusOnly = useCallback(async () => {
    const path = workspacePathRef.current;
    const currentStatus = useGitStore.getState().repoStatus;
    if (!path || currentStatus !== 'repo') return;
    try {
      const status = await getGitStatus(path);
      useGitStore.getState().setStatus(status);
      useGitStore.getState().setError(null);
    } catch {}
  }, []);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workspacePath) return;
    store.setWorkspacePath(workspacePath);
    refresh();
    let unlisten: (() => void) | undefined;
    listen('file-changed', () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(refreshStatusOnly, 500);
    }).then(fn => { unlisten = fn; });
    return () => {
      if (unlisten) unlisten();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [workspacePath, refresh, refreshStatusOnly]);

  return { refresh };
}
