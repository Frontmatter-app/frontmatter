import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../filesystem/tauriCommands';
import { registry, useDirtyDocsStore } from '../yjs/DocumentRegistry';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface UseWorkspaceEventListenersOptions {
  workspacePath: string | null;
  currentDocumentId: string | null;
  documents: { id: string; title?: string; file_path?: string }[];
}

export function useFileChangeListener(workspacePath: string | null) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('file-changed', async (event: any) => {
      const filePath = event.payload?.file_path;
      if (filePath) {
        try {
          await invoke('index_file', { filePath });
        } catch (e) {
          console.error('Failed to re-index changed file:', e);
        }
      }
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [workspacePath]);
}

export function useManualSave(currentDocumentId: string | null) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isSaveKey = isMac ? (e.metaKey && e.key === 's') : (e.ctrlKey && e.key === 's');
      if (isSaveKey) {
        e.preventDefault();
        if (currentDocumentId) {
          registry.saveDocument(currentDocumentId).catch(console.error);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDocumentId]);
}

export function useCloseHandler({ currentDocumentId, documents }: UseWorkspaceEventListenersOptions) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupCloseListener = async () => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        const dirtyDocs = useDirtyDocsStore.getState().dirtyDocs;
        if (dirtyDocs.size === 0) return;

        event.preventDefault();
        const dirtyArray = Array.from(dirtyDocs);
        const docToSaveId = currentDocumentId && dirtyDocs.has(currentDocumentId)
          ? currentDocumentId
          : dirtyArray[0];

        const docMeta = documents.find(d => d.id === docToSaveId);
        const docTitle = docMeta?.title || 'Untitled Document';

        try {
          const action = await invoke<string>('show_unsaved_dialog', { title: docTitle });
          if (action === 'save') {
            for (const docId of dirtyArray) await registry.saveDocument(docId);
            if (unlisten) unlisten();
            await appWindow.close();
          } else if (action === 'discard') {
            for (const docId of dirtyArray) useDirtyDocsStore.getState().setDirty(docId, false);
            if (unlisten) unlisten();
            await appWindow.close();
          }
        } catch (e) {
          console.error('Failed to show unsaved changes dialog:', e);
        }
      });
    };
    setupCloseListener();
    return () => { if (unlisten) unlisten(); };
  }, [currentDocumentId, documents]);
}
