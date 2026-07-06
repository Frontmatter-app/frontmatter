import { useEffect } from 'react';

interface UseWorkspaceTabRestoreOptions {
  workspacePath: string | null;
  setOpenTabs: (tabs: string[]) => void;
  setCurrentDocumentId: (id: string | null) => void;
  fetchDocs: () => Promise<{ id: string }[] | undefined>;
  refreshDirectoryTree: () => Promise<void>;
}

export function useWorkspaceTabRestore(opts: UseWorkspaceTabRestoreOptions) {
  useEffect(() => {
    if (!opts.workspacePath) return;

    opts.fetchDocs().then((liveDocs) => {
      const liveIds = new Set((liveDocs || []).map(d => d.id));
      const savedTabs = localStorage.getItem(`marktype_tabs_${opts.workspacePath}`);
      const savedActive = localStorage.getItem(`marktype_active_${opts.workspacePath}`);

      if (savedTabs) {
        try {
          const parsed = (JSON.parse(savedTabs) as string[]).filter(id => liveIds.has(id));
          if (parsed.length > 0) {
            opts.setOpenTabs(parsed);
            const active = savedActive && liveIds.has(savedActive) ? savedActive : parsed[0];
            opts.setCurrentDocumentId(active);
          } else {
            localStorage.removeItem(`marktype_tabs_${opts.workspacePath}`);
            localStorage.removeItem(`marktype_active_${opts.workspacePath}`);
          }
        } catch {
          localStorage.removeItem(`marktype_tabs_${opts.workspacePath}`);
          localStorage.removeItem(`marktype_active_${opts.workspacePath}`);
        }
      }
    });

    opts.refreshDirectoryTree();

    const intervalDocs = setInterval(opts.fetchDocs, 10000);
    const intervalTree = setInterval(opts.refreshDirectoryTree, 10000);

    return () => {
      clearInterval(intervalDocs);
      clearInterval(intervalTree);
    };
  }, [opts.workspacePath]);
}
