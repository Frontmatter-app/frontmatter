/**
 * The disk-backed explorer source.
 *
 * Everything here operates on absolute paths under the open workspace folder.
 * Cloud concerns do not appear: a node reaching these methods is guaranteed by
 * the type to be a local one.
 */

import { useMemo } from 'react';
import { invoke } from '../../../filesystem/tauriCommands';
import { showAlertDialog, showConfirmDialog } from '../../../lib/tauriDialog';
import { guardTeamAuth, guardTeamPermission } from '../../../auth/permissionGuards';
import type { EffectiveTeamPermissions } from '../../../auth/teamPermissions';
import { buildLocalTree, isDescendantPath, type ExplorerNode } from '../explorerModel';
import type { ExplorerCapabilities, ExplorerSource } from '../explorerSource';
import type { FileNode } from '../../../workspace/workspaceTypes';

interface LocalSourceOptions {
  workspacePath: string | null;
  directoryTree: FileNode | null;
  syncedPaths: Set<string>;
  isTeamContext: boolean;
  user: { id: string } | null;
  teamPerms: EffectiveTeamPermissions;
  openFileFromPath: (path: string) => Promise<void>;
  createFileInWorkspace: (parentDir: string, name: string) => Promise<void>;
  createFolderInWorkspace: (parentDir: string, name: string) => Promise<void>;
  deleteFileOrFolderFromWorkspace: (path: string) => Promise<void>;
  refreshDirectoryTree: () => Promise<void>;
  openWorkspace: () => void;
  /** Pulls a cloud document down to disk. Used for cloud-to-local drops. */
  saveCloudDocumentLocally: (docId: string) => Promise<void>;
}

const parentDirOf = (path: string) => {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
};

export function useLocalExplorerSource(opts: LocalSourceOptions): ExplorerSource {
  const {
    workspacePath, directoryTree, syncedPaths, isTeamContext, user, teamPerms,
    openFileFromPath, createFileInWorkspace, createFolderInWorkspace,
    deleteFileOrFolderFromWorkspace, refreshDirectoryTree, openWorkspace,
    saveCloudDocumentLocally,
  } = opts;

  const tree = useMemo(
    () => buildLocalTree(directoryTree, syncedPaths),
    [directoryTree, syncedPaths],
  );

  const capabilities = useMemo<ExplorerCapabilities>(() => {
    // Outside a team every local action is the user's own business. Inside one,
    // the local folder is still personal scratch space, so only the team's
    // "open local files" permission gates it.
    const allowed = !isTeamContext || teamPerms.isTeamOwner || teamPerms.openLocalFiles;
    return {
      createFile: allowed && !!workspacePath,
      createFolder: allowed && !!workspacePath,
      renameFile: allowed,
      renameFolder: allowed,
      deleteFile: allowed,
      deleteFolder: allowed,
      move: allowed,
      revealInFinder: true,
      managePermissions: false,
      offlineToggle: false,
    };
  }, [isTeamContext, teamPerms, workspacePath]);

  return useMemo<ExplorerSource>(() => {
    const guard = async (action: string, permitted: boolean) => {
      if (!(await guardTeamAuth(isTeamContext, user, action))) return false;
      return guardTeamPermission(isTeamContext, permitted, action);
    };

    const targetDir = (folder: ExplorerNode | null) => folder?.path ?? workspacePath ?? '';

    return {
      id: 'local',
      label: workspacePath ? workspacePath.split('/').filter(Boolean).pop() || workspacePath : 'Local',
      tree,
      capabilities,
      emptyMessage: 'This folder is empty.',
      unavailableMessage: workspacePath ? undefined : 'No folder open.',
      onActivate: workspacePath ? undefined : openWorkspace,
      activateLabel: 'Open Folder',
      headerAction: { label: 'Open a different folder', run: openWorkspace },

      open: async (node) => {
        if (node.isDir) return;
        await openFileFromPath(node.path);
      },

      createFile: async (parent, name) => {
        if (!(await guard('create files', capabilities.createFile))) return;
        const dir = targetDir(parent);
        if (!dir) return;
        try {
          await createFileInWorkspace(dir, name);
        } catch (e) {
          await showAlertDialog('Create File Failed', `Could not create file: ${e}`);
        }
      },

      createFolder: async (parent, name) => {
        if (!(await guard('create folders', capabilities.createFolder))) return;
        const dir = targetDir(parent);
        if (!dir) return;
        try {
          await createFolderInWorkspace(dir, name);
        } catch (e) {
          await showAlertDialog('Create Folder Failed', `Could not create folder: ${e}`);
        }
      },

      rename: async (node, newName) => {
        if (!(await guard('rename files', capabilities.renameFile))) return;
        const destination = `${parentDirOf(node.path)}/${newName}`;
        if (destination === node.path) return;
        try {
          await invoke('move_or_rename_on_disk', { oldPath: node.path, newPath: destination });
          await refreshDirectoryTree();
        } catch (e) {
          await showAlertDialog('Rename Failed', `Rename failed: ${e}`);
        }
      },

      remove: async (node) => {
        if (!(await guard('delete files', capabilities.deleteFile))) return;
        const confirmed = await showConfirmDialog(
          node.isDir ? 'Delete Folder' : 'Delete File',
          `Delete "${node.name}"? This cannot be undone.`,
        );
        if (!confirmed) return;
        await deleteFileOrFolderFromWorkspace(node.path);
      },

      move: async (node, folder) => {
        if (!(await guard('move files', capabilities.move))) return;
        const dir = targetDir(folder);
        if (!dir) return;

        // Dropping a folder inside itself would move the tree out from under
        // the drop target; `fs::rename` reports this as a generic OS error.
        if (node.isDir && isDescendantPath(node.path, dir)) {
          await showAlertDialog('Move Failed', 'A folder cannot be moved inside itself.');
          return;
        }

        const destination = `${dir}/${node.name}`;
        if (destination === node.path) return;
        try {
          await invoke('move_or_rename_on_disk', { oldPath: node.path, newPath: destination });
          await refreshDirectoryTree();
        } catch (e) {
          await showAlertDialog('Move Failed', `Move failed: ${e}`);
        }
      },

      transfer: {
        label: 'Save local copy',
        accept: async (node) => {
          if (node.source !== 'cloud' || !node.docId) return;
          if (!(await guard('save local copies', capabilities.createFile))) return;
          await saveCloudDocumentLocally(node.docId);
        },
      },

      revealInFinder: async (node) => {
        try {
          await invoke('reveal_in_folder', { path: node.path });
        } catch (e) {
          await showAlertDialog('Error', `Failed to reveal in Finder: ${e}`);
        }
      },
    };
  }, [
    tree, capabilities, workspacePath, isTeamContext, user, openWorkspace,
    openFileFromPath, createFileInWorkspace, createFolderInWorkspace,
    deleteFileOrFolderFromWorkspace, refreshDirectoryTree, saveCloudDocumentLocally,
  ]);
}
