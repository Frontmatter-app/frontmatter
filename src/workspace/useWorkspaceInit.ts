import { useEffect } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import type { ActiveContextType } from '../billing/PlanProvider';

interface UseWorkspaceInitOptions {
  activeContext: ActiveContextType;
  setWorkspacePath: (path: string | null) => void;
  setIsInitializing: (v: boolean) => void;
  fetchDocs: () => Promise<unknown>;
  openDocument: (id: string) => void;
}

export function useWorkspaceInit({
  activeContext, setWorkspacePath, setIsInitializing,
  fetchDocs, openDocument,
}: UseWorkspaceInitOptions) {
  useEffect(() => {
    const init = async () => {
      try {
        const existingPath = await invoke<string | null>('get_window_workspace');
        if (existingPath) {
          setWorkspacePath(existingPath);
          setIsInitializing(false);

          const pending = await invoke<{ path: string; name: string; content: string } | null>('get_pending_import');
          if (pending) {
            const { v4: uuidv4 } = await import('uuid');
            const newId = uuidv4();
            await invoke('create_document', {
              id: newId,
              title: pending.name.replace(/\.md$/i, ''),
              content: JSON.stringify({ markdown: pending.content, draft: '' }),
              filePath: pending.path,
            });
            await fetchDocs();
            openDocument(newId);
          }
          return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const isAccountWindow = urlParams.has('account_uid');

        let workspaceToOpen: string;
        if (isAccountWindow) {
          workspaceToOpen = await invoke<string>('get_default_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
        } else {
          const lastWorkspace = await invoke<string | null>('get_last_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
          workspaceToOpen = lastWorkspace || await invoke<string>('get_default_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
        }

        const result = await invoke<{ path: string; is_valid: boolean } | null>('open_workspace', { path: workspaceToOpen });
        if (result && result.is_valid) {
          setWorkspacePath(result.path);
        }
      } catch (e) {
        console.error('Failed to initialize workspace:', e);
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, [activeContext]);
}
