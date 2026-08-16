import React, { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { invoke } from '../filesystem/tauriCommands';
import { pushCloudDocument, deleteCloudDocument, fetchCloudDocument } from '../cloud/cloudDocuments';
import { registry } from '../yjs/DocumentRegistry';
import { generateDraftFromMarkdown } from '../yjs/draftUtils';
import type { DocumentMeta } from '../types';
import type { EffectiveTeamPermissions } from '../auth/teamPermissions';
import { canCreateInCurrentContext, canOpenLocalInCurrentContext, canAddLocalToCurrentTeam } from './workspacePermissionGuards';
import { isPathInside } from './workspaceTypes';

interface OpsCtx {
  user: { id: string } | null;
  isAuthor: boolean;
  isTeamContext: boolean;
  teamPerms: EffectiveTeamPermissions;
  teamId: string | null;
  workspacePath: string | null;
  currentDocumentId: string | null;
  documents: DocumentMeta[];
  openTabs: string[];
}

export function useWorkspaceOperations(
  ctx: OpsCtx,
  setters: {
    setWorkspacePath: (p: string | null) => void;
    setLocalDocuments: React.Dispatch<React.SetStateAction<DocumentMeta[]>>;
    fetchDocs: () => Promise<unknown>;
    refreshDirectoryTree: () => Promise<void>;
    openDocument: (id: string) => void;
    closeDocument: (id: string) => void;
  },
) {
  const { user, isAuthor, isTeamContext, teamPerms, teamId, workspacePath, currentDocumentId, documents, openTabs } = ctx;

  const handleCreateDocument = useCallback(async (title?: string) => {
    if (!(await canCreateInCurrentContext(isTeamContext, user, teamPerms))) return;
    const newId = uuidv4();
    if (isTeamContext && user && teamId) {
      const rt = title || `Untitled ${newId.slice(0, 8)}`;
      try {
        const dm = await invoke<DocumentMeta>('create_document', { id: newId, title: rt, content: JSON.stringify({ markdown: '', draft: '' }), filePath: null });
        await pushCloudDocument({ ...dm, cloud_path: rt }, user.id, teamId, rt);
        await invoke('set_cloud_sync', { id: newId, cloudId: newId, cloudPath: rt });
        await setters.fetchDocs();
        setters.openDocument(newId);
      } catch (e) { console.error('Failed to create team doc:', e); }
      return;
    }
    let fp: string | null = null;
    try { fp = await invoke<string | null>('pick_save_path', { suggestedTitle: 'Untitled Document' }); } catch {}
    await invoke('create_document', { id: newId, title: 'Untitled Document', content: '', filePath: fp });
    if (fp && workspacePath && currentDocumentId) {
      await invoke('open_file_in_new_window_command', { workspacePath, filePath: fp });
    } else {
      await setters.fetchDocs();
      if (fp) await setters.refreshDirectoryTree();
      setters.openDocument(newId);
    }
  }, [isTeamContext, user, teamPerms, teamId, workspacePath, currentDocumentId, setters]);

  const handleOpenExternalDocument = useCallback(async () => {
    if (isTeamContext) {
      if (!(await canAddLocalToCurrentTeam(isTeamContext, user, teamPerms))) return;
    } else if (!(await canOpenLocalInCurrentContext(isTeamContext, user, teamPerms))) return;
    try {
      const file = await invoke<[string, string, string] | null>('open_external_file');
      if (file) {
        if (isTeamContext) {
          await handleSyncToCloud(file[0]);
        } else {
          await setters.openDocument(file[0]);
        }
      }
    } catch (e) { console.error(e); }
  }, [isTeamContext, user, teamPerms, setters]);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await invoke('delete_document', { id });
      setters.closeDocument(id);
      await setters.fetchDocs();
    } catch (e) { console.error('Delete doc failed:', e); }
  }, [setters]);

  const handleOpenFileFromPath = useCallback(async (filePath: string) => {
    if (!(await canOpenLocalInCurrentContext(isTeamContext, user, teamPerms))) return;
    try {
      if (workspacePath && isPathInside(workspacePath, filePath)) {
        if (currentDocumentId) await registry.saveDocument(currentDocumentId);
        const doc = await invoke<DocumentMeta>('open_or_import_file', { filePath });
        await setters.fetchDocs();
        setters.openDocument(doc.id);
      } else {
        if (currentDocumentId && workspacePath) {
          await invoke('open_file_in_new_window_command', { workspacePath, filePath });
        } else {
          const doc = await invoke<DocumentMeta>('open_or_import_file', { filePath });
          await setters.fetchDocs();
          setters.openDocument(doc.id);
          const ydoc = await registry.acquire(doc.id);
          const mk = ydoc.getText('markdown');
          const orig = mk.toString();
          const ol = generateDraftFromMarkdown(orig, false);
          ydoc.transact(() => {
            mk.delete(0, mk.length);
            if (ol) { ydoc.getText('draft').delete(0, ydoc.getText('draft').length); ydoc.getText('draft').insert(0, ol); }
            ydoc.getMap('meta').set('stage', 'draft');
          }, 'external-outline-only');
        }
      }
    } catch (e) { console.error('Open file failed:', e); }
  }, [isTeamContext, user, teamPerms, workspacePath, currentDocumentId, setters]);

  const handleCreateFileInWorkspace = useCallback(async (parentDir: string, name: string) => {
    try {
      const fp = await invoke<string>('create_file_on_disk', { parentDir, name });
      await setters.refreshDirectoryTree();
      await handleOpenFileFromPath(fp);
    } catch (e) { console.error('Create file failed:', e); throw e; }
  }, [setters, handleOpenFileFromPath]);

  const handleCreateFolderInWorkspace = useCallback(async (parentDir: string, name: string) => {
    try {
      await invoke('create_directory_on_disk', { parentDir, name });
      await setters.refreshDirectoryTree();
    } catch (e) { console.error('Create dir failed:', e); throw e; }
  }, [setters]);

  const handleDeleteFileOrFolder = useCallback(async (filePath: string) => {
    try {
      await invoke('delete_file_or_dir_on_disk', { path: filePath });
      for (const d of documents.filter(d => d.file_path && d.file_path.startsWith(filePath))) {
        setters.closeDocument(d.id);
        await invoke('delete_document', { id: d.id });
      }
      await setters.fetchDocs();
      await setters.refreshDirectoryTree();
    } catch (e) { console.error('Delete failed:', e); }
  }, [documents, setters]);

  const handleSyncToCloud = useCallback(async (filePath: string, cloudPath?: string) => {
    if (!user || !isAuthor) throw new Error('Sign in with an active author plan to sync.');
    const dm = await invoke<DocumentMeta>('open_or_import_file', { filePath });
    const rcp = cloudPath ?? (workspacePath && filePath.startsWith(workspacePath) ? filePath.slice(workspacePath.length + 1).replace(/\.md$/i, '') : dm.title);
    await pushCloudDocument({ ...dm, cloud_path: rcp }, user.id, teamId, rcp);
    await invoke('set_cloud_sync', { id: dm.id, cloudId: dm.id, cloudPath: rcp });
    await setters.fetchDocs();
  }, [user, isAuthor, workspacePath, teamId, setters]);

  const handleUnsyncFromCloud = useCallback(async (docId: string) => {
    await deleteCloudDocument(docId);
    await invoke('clear_cloud_sync', { id: docId });
    await setters.fetchDocs();
  }, [setters]);

  /**
   * Pins a cloud document for offline use, or releases it.
   *
   * The flag used to be stored and read back for the menu checkmark and
   * nothing else — "Make Available Offline" changed a boolean and no bytes.
   * Enabling now pulls the current content into the workspace database so the
   * document opens without a network; disabling evicts that cached copy, which
   * is the half that matters on a shared machine.
   */
  const handleSetOfflineEnabled = useCallback(async (docId: string, enabled: boolean) => {
    const document = documents.find(d => d.id === docId);

    if (enabled) {
      const cloudDocument = await fetchCloudDocument(docId);
      if (cloudDocument) {
        try {
          if (document && !document.is_cloud) {
            await invoke('update_document', {
              id: docId,
              title: cloudDocument.title,
              content: cloudDocument.content,
              stage: cloudDocument.stage,
              focusMode: cloudDocument.focus_mode,
            });
          } else {
            await invoke('create_document', {
              id: docId,
              title: cloudDocument.title,
              content: cloudDocument.content,
              filePath: null,
            });
          }
        } catch (e) {
          // A row may already exist from a previous open; the flag below is
          // still the meaningful part of the operation.
          console.warn('Offline cache write skipped:', e);
        }
      }
      await invoke('set_offline_enabled', { id: docId, enabled: true });
      await setters.fetchDocs();
      return;
    }

    await invoke('set_offline_enabled', { id: docId, enabled: false });

    // Only a cloud-only document has a cached copy to drop, and only when it
    // is not currently open in a tab.
    const isCloudOnly = !document?.file_path;
    if (isCloudOnly && !openTabs.includes(docId)) {
      try {
        await invoke('delete_document', { id: docId });
      } catch (e) {
        console.warn('Could not evict offline copy:', e);
      }
    }
    await setters.fetchDocs();
  }, [documents, openTabs, setters]);

  const handleOpenWorkspace = useCallback(async () => {
    if (!(await canOpenLocalInCurrentContext(isTeamContext, user, teamPerms))) return;
    const result = await invoke<{ path: string; is_valid: boolean } | null>('open_workspace');
    if (result?.is_valid) setters.setWorkspacePath(result.path);
  }, [isTeamContext, user, teamPerms, setters]);

  return {
    handleCreateDocument, handleOpenExternalDocument, handleDeleteDocument,
    handleOpenFileFromPath, handleCreateFileInWorkspace, handleCreateFolderInWorkspace,
    handleDeleteFileOrFolder, handleSyncToCloud, handleUnsyncFromCloud,
    handleSetOfflineEnabled, handleOpenWorkspace,
  };
}
