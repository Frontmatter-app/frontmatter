/**
 * The Firestore-backed explorer source.
 *
 * A cloud "folder" is a record whose id is derived from its path, and a cloud
 * document stores its folder path as a plain string. Nothing enforces that
 * those agree, so every structural change here has to fix up descendants
 * explicitly — that cascade is the reason renaming and deleting cloud folders
 * were previously refused outright.
 */

import { useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { invoke } from '../../../filesystem/tauriCommands';
import { showAlertDialog, showConfirmDialog } from '../../../lib/tauriDialog';
import { guardTeamAuth, guardTeamPermission } from '../../../auth/permissionGuards';
import type { EffectiveTeamPermissions } from '../../../auth/teamPermissions';
import {
  createCloudFolder,
  deleteCloudDocument,
  deleteCloudFolder,
  moveCloudDocument,
  pushCloudDocument,
} from '../../../cloud/cloudDocuments';
import type { CloudFolderMeta, DocumentMeta } from '../../../types';
import {
  buildCloudTree,
  cloudParentPath,
  isDescendantPath,
  joinCloudPath,
  stripMarkdownExtension,
  type ExplorerNode,
} from '../explorerModel';
import type { ExplorerCapabilities, ExplorerSource } from '../explorerSource';

interface CloudSourceOptions {
  label: string;
  user: { id: string } | null;
  teamId: string | null;
  isTeamContext: boolean;
  isAuthor: boolean;
  teamPerms: EffectiveTeamPermissions;
  /** Every document the workspace knows about, local and cloud alike. */
  documents: DocumentMeta[];
  cloudFolders: CloudFolderMeta[];
  workspacePath: string | null;
  currentDocumentId: string | null;
  openDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  fetchDocs: () => Promise<unknown>;
  syncToCloud: (filePath: string, cloudPath?: string) => Promise<void>;
  unsyncFromCloud: (docId: string) => Promise<void>;
  setOfflineEnabled: (docId: string, enabled: boolean) => Promise<void>;
}

export function useCloudExplorerSource(opts: CloudSourceOptions): ExplorerSource {
  const {
    label, user, teamId, isTeamContext, isAuthor, teamPerms, documents, cloudFolders,
    workspacePath, currentDocumentId, openDocument, closeDocument, fetchDocs,
    syncToCloud, unsyncFromCloud, setOfflineEnabled,
  } = opts;

  const cloudDocuments = useMemo(
    () => documents.filter(d => d.is_cloud || d.cloud_synced),
    [documents],
  );

  // Only documents without a local file belong in the cloud tree; a synced
  // local file is shown once, in the local section, with a badge.
  const cloudOnlyDocuments = useMemo(
    () => cloudDocuments.filter(d => !d.file_path),
    [cloudDocuments],
  );

  const tree = useMemo(
    () => buildCloudTree(cloudOnlyDocuments, cloudFolders, label),
    [cloudOnlyDocuments, cloudFolders, label],
  );

  const capabilities = useMemo<ExplorerCapabilities>(() => {
    const owner = teamPerms.isTeamOwner;
    const signedIn = !!user && isAuthor;
    return {
      createFile: signedIn && (!isTeamContext || owner || teamPerms.createFiles),
      createFolder: signedIn && (!isTeamContext || owner || teamPerms.createFolders),
      renameFile: signedIn && (!isTeamContext || owner || teamPerms.renameFiles),
      renameFolder: signedIn && (!isTeamContext || owner || teamPerms.renameFiles),
      deleteFile: signedIn && (!isTeamContext || owner || teamPerms.deleteFiles),
      deleteFolder: signedIn && (!isTeamContext || owner || teamPerms.deleteFiles),
      move: signedIn && (!isTeamContext || owner || teamPerms.renameFiles),
      revealInFinder: false,
      managePermissions: owner && isTeamContext,
      offlineToggle: signedIn && (!isTeamContext || owner || teamPerms.offlineAccess),
    };
  }, [user, isAuthor, isTeamContext, teamPerms]);

  return useMemo<ExplorerSource>(() => {
    const guard = async (action: string, permitted: boolean) => {
      if (!user) {
        await showAlertDialog('Sign In Required', `Please sign in to ${action}.`);
        return false;
      }
      if (!(await guardTeamAuth(isTeamContext, user, action))) return false;
      return guardTeamPermission(isTeamContext, permitted, action);
    };

    /** Cloud documents whose path sits at or below `folderPath`. */
    const documentsUnder = (folderPath: string) =>
      cloudOnlyDocuments.filter(d => isDescendantPath(folderPath, d.cloud_path || ''));

    const foldersUnder = (folderPath: string) =>
      cloudFolders.filter(f => isDescendantPath(folderPath, f.path));

    const repointPath = (path: string, fromRoot: string, toRoot: string) =>
      toRoot + path.slice(fromRoot.length);

    const createDocumentAt = async (cloudPath: string) => {
      if (!user) return;
      const normalized = stripMarkdownExtension(cloudPath)
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');
      if (!normalized) return;

      const title = normalized.split('/').pop() || 'Untitled';
      const newId = uuidv4();
      try {
        const content = JSON.stringify({ markdown: '', draft: '' });
        await invoke('create_document', { id: newId, title, content, filePath: null });
        await pushCloudDocument(
          { id: newId, title, content, cloud_path: normalized, stage: 'draft', focus_mode: false } as DocumentMeta,
          user.id,
          teamId,
          normalized,
        );
        await invoke('set_cloud_sync', { id: newId, cloudId: newId, cloudPath: normalized });
        await fetchDocs();
        openDocument(newId);
      } catch (e) {
        await showAlertDialog('Error', `Failed to create cloud document: ${e}`);
      }
    };

    /** Moves a folder and everything under it to `toRoot`. */
    const relocateFolder = async (node: ExplorerNode, toRoot: string) => {
      if (!user) return;
      const fromRoot = node.path;
      if (fromRoot === toRoot) return;

      if (isDescendantPath(fromRoot, toRoot)) {
        await showAlertDialog('Move Failed', 'A folder cannot be moved inside itself.');
        return;
      }

      for (const folder of foldersUnder(fromRoot)) {
        const next = repointPath(folder.path, fromRoot, toRoot);
        await createCloudFolder(next, user.id, teamId);
      }
      for (const document of documentsUnder(fromRoot)) {
        const currentPath = document.cloud_path || '';
        const next = repointPath(currentPath, fromRoot, toRoot);
        await moveCloudDocument(document.id, next);
        await invoke('set_cloud_sync', { id: document.id, cloudId: document.id, cloudPath: next });
      }
      // Old records are removed last so a failure part-way leaves the tree
      // duplicated rather than truncated.
      for (const folder of foldersUnder(fromRoot)) {
        await deleteCloudFolder(folder.path, user.id, teamId);
      }
      await fetchDocs();
    };

    return {
      id: 'cloud',
      label,
      tree,
      capabilities,
      emptyMessage: isTeamContext
        ? 'No team documents yet. Add a local file or create one here.'
        : 'Nothing synced to the cloud yet.',
      unavailableMessage: user ? undefined : 'Sign in to see your cloud documents.',

      open: async (node) => {
        if (node.isDir || !node.docId) return;
        openDocument(node.docId);
      },

      createFile: async (parent, name) => {
        if (!(await guard('create files', capabilities.createFile))) return;
        await createDocumentAt(joinCloudPath(parent?.path ?? '', name));
      },

      createFolder: async (parent, name) => {
        if (!(await guard('create folders', capabilities.createFolder))) return;
        if (!user) return;
        const path = joinCloudPath(parent?.path ?? '', name);
        if (!path) return;
        try {
          await createCloudFolder(path, user.id, teamId);
        } catch (e: any) {
          await showAlertDialog('Create Folder Failed', `Could not create cloud folder: ${e.message || e}`);
        }
      },

      rename: async (node, newName) => {
        if (!(await guard('rename files', capabilities.renameFile))) return;
        if (!user) return;
        const cleaned = stripMarkdownExtension(newName).trim();
        if (!cleaned) return;
        const destination = joinCloudPath(cloudParentPath(node.path), cleaned);

        try {
          if (node.isDir) {
            await relocateFolder(node, destination);
          } else if (node.docId) {
            await moveCloudDocument(node.docId, destination);
            await invoke('set_cloud_sync', { id: node.docId, cloudId: node.docId, cloudPath: destination });
            await fetchDocs();
          }
        } catch (e: any) {
          await showAlertDialog('Rename Failed', `Rename failed: ${e.message || e}`);
        }
      },

      remove: async (node) => {
        if (!(await guard('delete files', capabilities.deleteFile))) return;
        if (!user) return;

        if (node.isDir) {
          const docs = documentsUnder(node.path);
          const confirmed = await showConfirmDialog(
            'Delete Cloud Folder',
            docs.length === 0
              ? `Delete the folder "${node.name}"?`
              : `Delete "${node.name}" and the ${docs.length} document${docs.length === 1 ? '' : 's'} inside it? This cannot be undone.`,
          );
          if (!confirmed) return;

          try {
            for (const document of docs) {
              await deleteCloudDocument(document.id);
              closeDocument(document.id);
            }
            for (const folder of foldersUnder(node.path)) {
              await deleteCloudFolder(folder.path, user.id, teamId);
            }
            await fetchDocs();
          } catch (e: any) {
            await showAlertDialog('Delete Failed', `Could not delete folder: ${e.message || e}`);
          }
          return;
        }

        if (!node.docId) return;
        const confirmed = await showConfirmDialog(
          'Delete Cloud Document',
          `Delete cloud document "${node.name}"? This cannot be undone.`,
        );
        if (!confirmed) return;
        try {
          await deleteCloudDocument(node.docId);
          if (currentDocumentId === node.docId) closeDocument(node.docId);
          await fetchDocs();
        } catch (e: any) {
          await showAlertDialog('Delete Failed', `Could not delete document: ${e.message || e}`);
        }
      },

      move: async (node, folder) => {
        if (!(await guard('move files', capabilities.move))) return;
        const parentPath = folder?.path ?? '';
        const destination = joinCloudPath(parentPath, node.name);
        if (destination === node.path) return;

        try {
          if (node.isDir) {
            await relocateFolder(node, destination);
          } else if (node.docId) {
            await moveCloudDocument(node.docId, destination);
            await invoke('set_cloud_sync', { id: node.docId, cloudId: node.docId, cloudPath: destination });
            await fetchDocs();
          }
        } catch (e: any) {
          await showAlertDialog('Move Failed', `Move failed: ${e.message || e}`);
        }
      },

      transfer: {
        label: isTeamContext ? 'Add to team' : 'Sync to cloud',
        accept: async (node, targetFolder) => {
          if (node.source !== 'local' || node.isDir) return;
          const action = isTeamContext ? 'add files to the team' : 'sync files to the cloud';
          const permitted = isTeamContext
            ? teamPerms.isTeamOwner || teamPerms.addToTeam
            : isAuthor;
          if (!(await guard(action, permitted))) return;

          const relative = workspacePath && node.path.startsWith(workspacePath)
            ? node.path.slice(workspacePath.length).replace(/^\/+/, '')
            : node.name;
          const base = stripMarkdownExtension(targetFolder
            ? joinCloudPath(targetFolder.path, node.name)
            : relative);

          try {
            await syncToCloud(node.path, base);
          } catch (e: any) {
            await showAlertDialog('Sync Failed', e.message || 'Failed to add to the team.');
          }
        },
      },

      setOffline: async (node, enabled) => {
        if (!node.docId) return;
        if (!(await guard('change offline access', capabilities.offlineToggle))) return;
        await setOfflineEnabled(node.docId, enabled);
      },

      unsync: async (node) => {
        if (!node.docId) return;
        if (!(await guard('remove cloud sync', capabilities.deleteFile))) return;
        await unsyncFromCloud(node.docId);
      },
    };
  }, [
    label, tree, capabilities, user, teamId, isTeamContext, isAuthor, teamPerms,
    cloudOnlyDocuments, cloudFolders, workspacePath, currentDocumentId,
    openDocument, closeDocument, fetchDocs, syncToCloud, unsyncFromCloud, setOfflineEnabled,
  ]);
}
