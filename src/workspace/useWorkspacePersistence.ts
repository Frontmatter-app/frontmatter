import { useEffect, useRef } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import type { ActiveContextType } from '../billing/PlanProvider';
import { activeStorageKey, tabsStorageKey } from './useWorkspaceTabRestore';

interface UseWorkspacePersistenceOptions {
  workspacePath: string | null;
  openTabs: string[];
  currentDocumentId: string | null;
  activeContext: ActiveContextType;
}

export function useWorkspacePersistence(opts: UseWorkspacePersistenceOptions) {
  const { workspacePath, openTabs, currentDocumentId, activeContext } = opts;

  /**
   * The render on which `workspacePath` changes still carries the previous
   * workspace's tabs — the reset in `useWorkspaceTabRestore` has not been
   * committed yet. Writing then would stamp the old tab list onto the new
   * workspace's key, so the first pass after a switch only records the path.
   */
  const persistedPathRef = useRef<string | null>(null);
  const isFreshWorkspace = persistedPathRef.current !== workspacePath;

  useEffect(() => {
    if (!workspacePath) return;
    if (persistedPathRef.current !== workspacePath) {
      persistedPathRef.current = workspacePath;
      return;
    }
    localStorage.setItem(tabsStorageKey(workspacePath), JSON.stringify(openTabs));
  }, [openTabs, workspacePath]);

  useEffect(() => {
    if (!workspacePath || isFreshWorkspace) return;
    if (currentDocumentId) {
      localStorage.setItem(activeStorageKey(workspacePath), currentDocumentId);
    } else {
      localStorage.removeItem(activeStorageKey(workspacePath));
    }
  }, [currentDocumentId, workspacePath, isFreshWorkspace]);

  useEffect(() => {
    if (!workspacePath) return;
    invoke('save_last_workspace', {
      workspaceContextJson: JSON.stringify(activeContext),
      path: workspacePath,
    }).catch(console.error);

    // The Open Recent menu was only ever written to after a clone, so for most
    // users it read "No Recent Projects" permanently.
    invoke('add_recent_project', { path: workspacePath }).catch(console.error);
  }, [workspacePath, activeContext]);
}
