import { useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useGitStore } from './gitStore';
import {
  checkGitAvailable, checkIsRepo, ensureGitIgnores, getGitLog, getGitStatus, hasRemoteChanges,
} from './gitCommands';

/** Coalesces the bursts of file events a single save produces. */
const STATUS_DEBOUNCE_MS = 500;

/**
 * How often to ask the remote whether it has moved on. This runs `git fetch`,
 * so it is deliberately rare and deliberately separate from reading status —
 * the two used to be one call, which put a network round trip on the path of
 * every workspace change and every commit.
 */
const REMOTE_POLL_MS = 5 * 60 * 1000;

export function useGitStatus(workspacePath: string | null, currentDocumentPath: string | null) {
  const workspacePathRef = useRef(workspacePath);
  const currentDocumentPathRef = useRef(currentDocumentPath);

  useEffect(() => { workspacePathRef.current = workspacePath; }, [workspacePath]);
  useEffect(() => { currentDocumentPathRef.current = currentDocumentPath; }, [currentDocumentPath]);

  // Reading through `getState` keeps these callbacks stable without capturing
  // a render's snapshot of the store.
  const refresh = useCallback(async () => {
    const path = workspacePathRef.current;
    const documentPath = currentDocumentPathRef.current;
    const store = useGitStore.getState();
    if (!path) return;

    store.setRepoStatus('checking');
    try {
      if (!(await checkGitAvailable())) {
        store.setRepoStatus('git-not-found');
        store.setStatus(null);
        return;
      }
      if (!(await checkIsRepo(path))) {
        store.setRepoStatus('not-repo');
        store.setStatus(null);
        return;
      }

      store.setStatus(await getGitStatus(path));
      store.setRepoStatus('repo');
      store.setError(null);

      // The workspace database lives inside the workspace folder, so a
      // repository that predates the app would otherwise commit it.
      ensureGitIgnores(path).catch(() => {});

      try { store.setCommits(await getGitLog(path, documentPath || undefined)); } catch { /* history is optional */ }
    } catch (e) {
      store.setRepoStatus('repo');
      store.setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, []);

  const refreshStatusOnly = useCallback(async () => {
    const path = workspacePathRef.current;
    const store = useGitStore.getState();
    if (!path || store.repoStatus !== 'repo') return;
    try {
      store.setStatus(await getGitStatus(path));
    } catch { /* transient; the next event refreshes again */ }
  }, []);

  const checkRemote = useCallback(async () => {
    const path = workspacePathRef.current;
    const store = useGitStore.getState();
    if (!path || store.repoStatus !== 'repo') return;
    try {
      store.setBehindRemote(await hasRemoteChanges(path));
    } catch { /* offline, or no upstream */ }
  }, []);

  useEffect(() => {
    if (!workspacePath) return;
    useGitStore.getState().setWorkspacePath(workspacePath);
    void refresh();

    const debounce = { timer: null as ReturnType<typeof setTimeout> | null };
    const scheduleStatus = () => {
      if (debounce.timer) clearTimeout(debounce.timer);
      debounce.timer = setTimeout(refreshStatusOnly, STATUS_DEBOUNCE_MS);
    };

    const unlisteners: Array<() => void> = [];
    // `file-changed` only fires for files the workspace database already knows
    // about, so new, untracked, and non-markdown files never moved the status.
    // `workspace-reconciled` covers everything structural.
    listen('file-changed', scheduleStatus).then(fn => unlisteners.push(fn));
    listen('workspace-reconciled', scheduleStatus).then(fn => unlisteners.push(fn));

    const remoteTimer = setInterval(checkRemote, REMOTE_POLL_MS);

    return () => {
      unlisteners.forEach(fn => fn());
      if (debounce.timer) clearTimeout(debounce.timer);
      clearInterval(remoteTimer);
    };
  }, [workspacePath, refresh, refreshStatusOnly, checkRemote]);

  return { refresh, checkRemote };
}
