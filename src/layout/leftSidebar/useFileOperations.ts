import { v4 as uuidv4 } from 'uuid';
import { useWorkspace, FileNode } from '../../workspace/WorkspaceProvider';
import type { DocumentMeta } from '../../types';
import { useAuth } from '../../auth/AuthProvider';
import { usePlan } from '../../billing/PlanProvider';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { invoke } from '../../filesystem/tauriCommands';
import { createCloudFolder, deleteCloudDocument, pushCloudDocument } from '../../cloud/firestoreSync';
import { showPromptDialog, showAlertDialog, showConfirmDialog } from '../../lib/tauriDialog';
import { isCloudOnlyNode, isCloudVirtualDir, CLOUD_DIR_PREFIX } from './cloudNodes';

export function useFileOperations() {
  const {
    documents, cloudFolders, openDocument, closeDocument, currentDocumentId,
    workspacePath, directoryTree, refreshDirectoryTree, openFileFromPath,
    openExternalDocument, createDocument, createFileInWorkspace, createFolderInWorkspace,
    deleteFileOrFolderFromWorkspace, syncToCloud, unsyncFromCloud, setOfflineEnabled,
  } = useWorkspace();

  const { user } = useAuth();
  const { isAuthor, isTeamOwner, teamId, activeContext } = usePlan();
  const teamPerms = useTeamPermissions();
  const isTeamContext = activeContext.type === 'team';

  const syncedPaths = new Set<string>();
  documents.forEach(d => { if (d.cloud_synced && d.file_path) syncedPaths.add(d.file_path); });

  const handleOpenFile = async (path: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to access team files.');
      return;
    }
    openFileFromPath(path);
  };

  const handleOpenCloudDoc = (docId: string) => openDocument(docId);

  const handleOpenExternalDocument = async () => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to add files to a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.addToTeam) {
      await showAlertDialog('Permission Denied', 'Your group does not have permission to add files to the team.');
      return;
    }
    openExternalDocument();
  };

  const handleNewRootFile = async () => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to create files in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.createFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create files in this team workspace.');
      return;
    }
    if (isTeamContext) {
      const name = await showPromptDialog('New Team File', 'Enter a name for the new team file:');
      if (!name?.trim()) return;
      createDocument(name.trim().replace(/\.md$/i, ''));
      return;
    }
    if (!workspacePath) return;
    const savePath = await invoke<string | null>('pick_save_path', { suggestedTitle: 'untitled.md' });
    if (!savePath) return;
    const name = savePath.split('/').pop() || savePath.split('\\').pop() || 'untitled.md';
    await createFileInWorkspace(workspacePath, name);
  };

  const handleNewRootFolder = async () => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to create folders in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.createFolders) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create folders in this team workspace.');
      return;
    }
    if (isTeamContext) {
      const name = await showPromptDialog('New Cloud Folder', 'Enter a name for the new folder:');
      if (!name?.trim()) return;
      await createCloudFolderAtPath(name.trim());
      return;
    }
    if (!workspacePath) {
      await showAlertDialog('No Folder Open', 'Open a local folder before creating a folder.');
      return;
    }
    const name = await showPromptDialog('New Folder', 'Enter a name for the new folder:');
    if (!name?.trim()) return;
    try {
      await createFolderInWorkspace(workspacePath, name.trim());
    } catch (e: any) {
      await showAlertDialog('Create Folder Failed', `Could not create folder: ${e}`);
    }
  };

  const cloudFolderPathFromParent = (parentDir: string, name: string) => {
    const parentPath = isCloudVirtualDir(parentDir)
      ? parentDir.replace(CLOUD_DIR_PREFIX, '').replace(/^root\/?/, '')
      : workspacePath && parentDir.startsWith(workspacePath)
        ? parentDir.slice(workspacePath.length).replace(/^\/+/, '')
        : '';
    return `${parentPath}/${name}`.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  };

  const createCloudFolderAtPath = async (cloudPath: string) => {
    if (!user || !teamId) {
      await showAlertDialog('Authentication Required', 'Cannot create cloud folder: user or team context not available.');
      return;
    }
    const normalizedPath = cloudPath.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalizedPath) return;
    try {
      await createCloudFolder(normalizedPath, user.id, teamId);
    } catch (e: any) {
      await showAlertDialog('Create Folder Failed', `Could not create cloud folder: ${e.message || e}`);
    }
  };

  const createCloudDocumentAtPath = async (cloudPath: string) => {
    if (!user || !teamId) {
      await showAlertDialog('Authentication Required', 'Cannot create cloud document: user or team context not available.');
      return;
    }
    const normalizedPath = cloudPath.replace(/\.md$/i, '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    const title = normalizedPath.split('/').pop() || 'Untitled';
    try {
      const newId = uuidv4();
      const content = JSON.stringify({ markdown: '', draft: '' });
      await invoke('create_document', { id: newId, title, content, filePath: null });
      await pushCloudDocument(
        { id: newId, title, content, cloud_path: normalizedPath, stage: 'draft', focus_mode: false } as DocumentMeta,
        user.id, teamId, normalizedPath,
      );
      await invoke('set_cloud_sync', { id: newId, cloudId: newId, cloudPath: normalizedPath });
      await refreshDirectoryTree();
      openDocument(newId);
    } catch (e: any) {
      await showAlertDialog('Error', `Failed to create cloud document: ${e}`);
    }
  };

  const handleCreateFile = async (parentDir: string, name: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to create files in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.createFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create files in this team workspace.');
      return;
    }
    if (isTeamContext) {
      const relativeParent = workspacePath && parentDir.startsWith(workspacePath)
        ? parentDir.slice(workspacePath.length).replace(/^\/+/, '')
        : '';
      const fullCloudPath = `${relativeParent}/${name}`.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
      await createCloudDocumentAtPath(fullCloudPath || name);
      return;
    }
    try {
      await createFileInWorkspace(parentDir, name);
    } catch (e: any) {
      await showAlertDialog('Create File Failed', `Could not create file: ${e}`);
    }
  };

  const handleCreateFolder = async (parentDir: string, name: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to create folders in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.createFolders) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create folders in this team workspace.');
      return;
    }
    if (isTeamContext) {
      const cloudPath = cloudFolderPathFromParent(parentDir, name);
      await createCloudFolderAtPath(cloudPath);
      return;
    }
    try {
      await createFolderInWorkspace(parentDir, name);
    } catch (e: any) {
      await showAlertDialog('Create Folder Failed', `Could not create folder: ${e}`);
    }
  };

  const handleCreateCloudDocInFolder = async (folderPath: string, name: string) => {
    if (!user || !teamId) {
      await showAlertDialog('Authentication Required', 'Cannot create cloud document: user or team context not available.');
      return;
    }
    if (isTeamContext && !teamPerms.createFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create files in this team workspace.');
      return;
    }
    const cloudFolderPath = folderPath.replace(CLOUD_DIR_PREFIX, '');
    const fullCloudPath = `${cloudFolderPath}/${name}`.replace(/\/+/g, '/').replace(/\/$/, '');
    await createCloudDocumentAtPath(fullCloudPath);
  };

  const handleDeleteFileOrFolder = async (path: string, name: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to manage files in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.deleteFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to delete files in this team workspace.');
      return;
    }
    if (isCloudOnlyNode(path)) {
      if (!user && isTeamContext) {
        await showAlertDialog('Authentication Required', 'Please sign in to delete cloud documents.');
        return;
      }
      const docId = path.replace('__cloud__:', '');
      const confirmed = await showConfirmDialog('Delete Cloud Document', `Delete cloud document "${name}"? This cannot be undone.`);
      if (confirmed) {
        await deleteCloudDocument(docId).catch(console.error);
        if (currentDocumentId === docId) closeDocument(docId);
      }
      return;
    }
    const confirmed = await showConfirmDialog('Delete File/Folder', `Delete "${name}"? This action cannot be undone.`);
    if (confirmed) {
      deleteFileOrFolderFromWorkspace(path);
    }
  };

  const handleRename = async (path: string, newName: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to rename files in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.renameFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to rename files in this team workspace.');
      return;
    }
    if (isCloudVirtualDir(path)) {
      await showAlertDialog('Not Allowed', 'Cloud directories cannot be renamed directly. Rename the files inside instead.');
      return;
    }
    if (isCloudOnlyNode(path)) {
      if (!user && isTeamContext) {
        await showAlertDialog('Authentication Required', 'Please sign in to rename cloud documents.');
        return;
      }
      const docId = path.replace('__cloud__:', '');
      const doc = documents.find(d => d.id === docId && d.cloud_path);
      if (!doc) return;
      const parts = doc.cloud_path!.split('/');
      parts.pop();
      const newCloudPath = [...parts, newName.replace(/\.md$/i, '')].join('/');
      await pushCloudDocument({ ...doc, cloud_path: newCloudPath }, user!.id, teamId, newCloudPath);
      await invoke('set_cloud_sync', { id: docId, cloudId: docId, cloudPath: newCloudPath });
      return;
    }
    try {
      const parts = path.split('/');
      parts.pop();
      const newPath = `${parts.join('/')}/${newName}`;
      await invoke('move_or_rename_on_disk', { oldPath: path, newPath });
      await refreshDirectoryTree();
    } catch (e: any) {
      await showAlertDialog('Rename Failed', `Rename failed: ${e}`);
    }
  };

  const handleMove = async (oldPath: string, newPath: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', 'Please sign in to move files in a team workspace.');
      return;
    }
    if (isTeamContext && !teamPerms.renameFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to move files in this team workspace.');
      return;
    }
    if (isCloudOnlyNode(oldPath) || isCloudVirtualDir(oldPath)) return;
    try {
      await invoke('move_or_rename_on_disk', { oldPath, newPath });
      await refreshDirectoryTree();
    } catch (e: any) {
      await showAlertDialog('Move Failed', `Move failed: ${e}`);
    }
  };

  const handleRevealInFolder = async (path: string) => {
    if (isCloudOnlyNode(path) || isCloudVirtualDir(path)) return;
    try {
      await invoke('reveal_in_folder', { path });
    } catch (e: any) {
      await showAlertDialog('Error', `Failed to reveal in Finder: ${e}`);
    }
  };

  const handleAddToTeam = async (path: string) => {
    if (!teamPerms.addToTeam) {
      await showAlertDialog('Permission Denied', 'Your group does not have permission to add files to the team.');
      return;
    }
    try {
      await syncToCloud(path);
    } catch (e: any) {
      await showAlertDialog('Sync Failed', e.message || 'Failed to add to team.');
    }
  };

  return {
    documents, cloudFolders, openDocument, closeDocument, currentDocumentId,
    workspacePath, directoryTree, refreshDirectoryTree, openWorkspace: useWorkspace().openWorkspace,
    isTeamContext, isTeamOwner, isAuthor, user, teamId, teamPerms,
    syncedPaths, handleOpenFile, handleOpenCloudDoc, handleOpenExternalDocument,
    handleNewRootFile, handleNewRootFolder, handleCreateFile, handleCreateFolder,
    handleCreateCloudDocInFolder, handleDeleteFileOrFolder, handleRename, handleMove,
    handleRevealInFolder, handleAddToTeam, cloudFolderPathFromParent,
    createCloudFolderAtPath, createCloudDocumentAtPath,
    syncToCloud, unsyncFromCloud, setOfflineEnabled,
  };
}
