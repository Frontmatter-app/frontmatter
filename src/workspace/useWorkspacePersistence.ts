import { useEffect, useRef } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import type { ActiveContextType } from '../billing/PlanProvider';
import { DocumentMeta } from '../types';

interface UseWorkspacePersistenceOptions {
  workspacePath: string | null;
  openTabs: string[];
  currentDocumentId: string | null;
  activeContext: ActiveContextType;
  cloudDocuments: DocumentMeta[];
  setWorkspacePath: (path: string | null) => void;
  fetchDocs: () => Promise<unknown>;
  refreshDirectoryTree: () => Promise<void>;
}

export function useWorkspacePersistence(opts: UseWorkspacePersistenceOptions) {
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (opts.workspacePath) {
      localStorage.setItem(`marktype_tabs_${opts.workspacePath}`, JSON.stringify(opts.openTabs));
    }
  }, [opts.openTabs, opts.workspacePath]);

  useEffect(() => {
    if (opts.currentDocumentId) {
      localStorage.setItem(`marktype_active_${opts.workspacePath}`, opts.currentDocumentId);
    } else {
      localStorage.removeItem(`marktype_active_${opts.workspacePath}`);
    }
  }, [opts.currentDocumentId, opts.workspacePath]);

  useEffect(() => {
    if (opts.workspacePath) {
      invoke('save_last_workspace', {
        workspaceContextJson: JSON.stringify(opts.activeContext),
        path: opts.workspacePath,
      }).catch(console.error);
    }
  }, [opts.workspacePath, opts.activeContext]);

  return { prevUserIdRef };
}
