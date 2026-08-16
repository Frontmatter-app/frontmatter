import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../filesystem/tauriCommands';
import { showPromptDialog, showConfirmDialog, showAlertDialog } from '../lib/tauriDialog';
import { registry, useDirtyDocsStore } from '../yjs/DocumentRegistry';
import { PublishWizard } from '../publish/PublishWizard';
import { RepoPickerModal } from '../forge/RepoPickerModal';
import { isPublishType, type PublishType } from '../publish/publishTypes';

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
  // `null` means the dialog is closed. Publishing itself is reported inside
  // the dialog, so there is no separate loading overlay.
  const [publishType, setPublishType] = useState<PublishType | null>(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [lastPublishType, setLastPublishType] = useState<PublishType>('docs');

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
    // Opens the picker rather than prompting for a URL. The URL is something
    // the user can only obtain by visiting the provider, and a private
    // repository failed opaquely because the shelled-out git had no
    // credentials.
    listen('menu-clone-repository', () => {
      setRepoPickerOpen(true);
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

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-export-file-markdown', async () => {
      if (!currentDocumentId) return;
      const doc = await registry.acquire(currentDocumentId);
      await navigator.clipboard.writeText(doc.getText('markdown').toString());
      registry.release(currentDocumentId);
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [currentDocumentId]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-export-file-pdf', async () => {
      if (!currentDocumentId) return;
      const doc = await registry.acquire(currentDocumentId);
      const md = doc.getText('markdown').toString();
      registry.release(currentDocumentId);
      try {
        const res = await invoke<{ path: string; success: boolean; error?: string }>('export_file_pdf', { markdown: md });
        if (res.success) {
          await showAlertDialog('Export PDF', 'A preview window has opened. Use File > Print (⌘P) then select "Save as PDF".');
        } else if (res.error) {
          await showAlertDialog('Export Failed', res.error);
        }
      } catch (e) { console.error('PDF export failed:', e); }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [currentDocumentId]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen('menu-export-file-html', async () => {
      if (!currentDocumentId) return;
      const doc = await registry.acquire(currentDocumentId);
      const md = doc.getText('markdown').toString();
      registry.release(currentDocumentId);
      try {
        const res = await invoke<{ path: string; success: boolean; error?: string }>('export_file_html', { markdown: md });
        if (res.success) {
          await showAlertDialog('Export Complete', `HTML saved to:\n${res.path}`);
        }
      } catch (e) { console.error('HTML export failed:', e); }
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [currentDocumentId]);

  useEffect(() => {
    let un: (() => void) | undefined;
    // "Publish..." sends an empty payload; the four "As ..." entries name a
    // type. Both open the same dialog — an empty payload just reopens it on
    // whatever was published last.
    listen<string>('menu-export-project', (event) => {
      const requested = event.payload;
      setPublishType(isPublishType(requested) ? requested : lastPublishType);
    }).then(fn => { un = fn; });
    return () => { un?.(); };
  }, [lastPublishType]);

  return (
    <>
      <RepoPickerModal isOpen={repoPickerOpen} onClose={() => setRepoPickerOpen(false)} />

      {publishType && (
        <PublishWizard
          initialType={publishType}
          onClose={(lastType) => {
            setLastPublishType(lastType);
            setPublishType(null);
          }}
        />
      )}
    </>
  );
}
