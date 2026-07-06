import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../filesystem/tauriCommands';
import { showPromptDialog, showConfirmDialog } from '../lib/tauriDialog';
import { registry, useDirtyDocsStore } from '../yjs/DocumentRegistry';

interface UseMenuEventsProps {
  workspacePath: string | null;
  currentDocumentId: string | null;
  openExternalDocument: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  openFileFromPath: (path: string) => Promise<void>;
  createDocument: (title?: string) => Promise<void>;
  refreshDirectoryTree: () => Promise<void>;
}

export function useMenuEvents({
  workspacePath,
  currentDocumentId,
  openExternalDocument,
  openWorkspace,
  openFileFromPath,
  createDocument,
  refreshDirectoryTree,
}: UseMenuEventsProps) {
  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-new-folder', async () => {
      const name = await showPromptDialog('New Folder', 'Enter folder name:');
      if (name && workspacePath) {
        try {
          await invoke('create_directory_on_disk', { parentDir: workspacePath, name });
          await refreshDirectoryTree();
        } catch (e: any) {
          console.error('Failed to create folder:', e);
        }
      }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [workspacePath, refreshDirectoryTree]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-save-as', async () => {
      if (!currentDocumentId) return;
      try {
        const result = await invoke<{ path: string; success: boolean } | null>('save_as_document', { id: currentDocumentId });
        if (result?.success) {
          await refreshDirectoryTree();
        }
      } catch (e) {
        console.error('Save As failed:', e);
      }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [currentDocumentId, refreshDirectoryTree]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-toggle-auto-save', async () => {
      try {
        const current = await invoke<boolean>('get_auto_save');
        await invoke('set_auto_save', { enabled: !current });
      } catch (e) {
        console.error('Toggle auto-save failed:', e);
      }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-clone-repository', async () => {
      const repoUrl = await showPromptDialog(
        'Clone Repository',
        'Enter Git repository URL:',
        'https://'
      );
      if (!repoUrl || !repoUrl.trim()) return;

      const trimmedUrl = repoUrl.trim();
      const folderName = trimmedUrl.split('/').pop()?.replace('.git', '') || 'project';

      const parentFolder = await invoke<string | null>('pick_folder', {
        title: `Choose parent folder for "${folderName}"`,
      });
      if (!parentFolder) return;

      const destination = `${parentFolder}/${folderName}`;
      try {
        const result = await invoke<{ path: string; success: boolean; error?: string }>('git_clone', {
          url: trimmedUrl,
          destination,
        });

        if (!result.success) {
          await showConfirmDialog('Clone Failed', result.error || 'Unknown error');
          return;
        }

        const openIt = await showConfirmDialog(
          'Clone Complete',
          `Repository cloned to:\n${result.path}\n\nOpen it now?`
        );

        if (openIt) {
          await invoke('add_recent_project', { path: result.path });
          await invoke('open_folder_in_new_window_from_path', { path: result.path });
        }
      } catch (e: any) {
        console.error('Clone repository failed:', e);
        await showConfirmDialog('Clone Error', e?.toString() || 'Failed to clone repository');
      }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, []);

  useEffect(() => {
    if (!currentDocumentId) return;
    const checkAndSave = async () => {
      try {
        const enabled = await invoke<boolean>('get_auto_save');
        if (enabled) {
          const dirtyDocs = useDirtyDocsStore.getState().dirtyDocs;
          for (const docId of dirtyDocs) {
            await registry.saveDocument(docId).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    };
    const interval = setInterval(checkAndSave, 30000);
    return () => clearInterval(interval);
  }, [currentDocumentId]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-new-file', async () => { await createDocument(); }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [createDocument]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-open-file', async () => { await openExternalDocument(); }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [openExternalDocument]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-open-folder', async () => { await openWorkspace(); }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [openWorkspace]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-save', () => {
      if (currentDocumentId) {
        registry.saveDocument(currentDocumentId).catch(console.error);
      }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [currentDocumentId]);
}
