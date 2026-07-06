import React from 'react';
import { SidebarContextMenu } from '../../components/SidebarContextMenu';
import { FilePermissionsModal } from '../../components/FilePermissionsModal';
import { showPromptDialog } from '../../lib/tauriDialog';
import { guardTeamPermission } from '../../auth/permissionGuards';
import { isCloudOnlyNode, isCloudVirtualDir, cloudDocIdFromPath, CLOUD_DIR_PREFIX } from './cloudNodes';

interface ContextMenuState {
  x: number; y: number; node: { path: string; name: string; is_dir: boolean };
  isSynced: boolean; isCloudOnly: boolean; isOfflineEnabled: boolean; docId?: string;
}

interface ContextMenuActionsProps {
  contextMenu: ContextMenuState | null;
  onClose: () => void;
  onSetContextMenu: (menu: ContextMenuState | null) => void;
  onOpenFile: (path: string) => void;
  onOpenCloudDoc: (docId: string) => void;
  onCreateFile: (parentDir: string, name: string) => void;
  onCreateFolder: (parentDir: string, name: string) => void;
  onCreateCloudDocInFolder: (folderPath: string, name: string) => void;
  onDeleteFileOrFolder: (path: string, name: string) => void;
  onRename: (path: string, newName: string) => void;
  onRevealInFolder: (path: string) => void;
  onSyncToCloud: (path: string) => void;
  onUnsyncFromCloud: (docId: string) => void;
  onMakeOffline: (docId: string) => void;
  onRemoveOffline: (docId: string) => void;
  onAddToTeam: (path: string) => void;
  syncedPaths: Set<string>;
  documents: Array<{ id: string; file_path?: string; cloud_path?: string; offline_enabled?: boolean }>;
  isTeamContext: boolean;
  isTeamOwner: boolean;
  isAuthor: boolean;
  user: any;
  teamPerms: any;
}

export function ContextMenuActions({
  contextMenu, onClose, onSetContextMenu,
  onOpenFile, onOpenCloudDoc, onCreateFile, onCreateFolder,
  onCreateCloudDocInFolder, onDeleteFileOrFolder, onRename, onRevealInFolder,
  onSyncToCloud, onUnsyncFromCloud, onMakeOffline, onRemoveOffline, onAddToTeam,
  syncedPaths, documents, isTeamContext, isTeamOwner, isAuthor, user, teamPerms,
}: ContextMenuActionsProps) {
  const [filePermsModal, setFilePermsModal] = React.useState<{ docId: string; title?: string } | null>(null);
  const canRenameInContext = !isTeamContext || teamPerms.renameFiles;
  const canDeleteInContext = !isTeamContext || teamPerms.deleteFiles;

  return (
    <>
      <SidebarContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        isFolder={contextMenu?.node.is_dir ?? false}
        isSynced={contextMenu?.isSynced ?? false}
        isCloudOnly={contextMenu?.isCloudOnly ?? false}
        isOfflineEnabled={contextMenu?.isOfflineEnabled ?? false}
        canSync={isAuthor && !!user && !!contextMenu && !contextMenu.node.is_dir && !contextMenu.isSynced && !contextMenu.isCloudOnly}
        canMakeOffline={!!user && teamPerms.offlineAccess}
        canAddToTeam={teamPerms.isTeamContext && teamPerms.addToTeam && !!contextMenu && !contextMenu.node.is_dir && !contextMenu.isSynced && !contextMenu.isCloudOnly}
        showManagePerms={isTeamOwner && isTeamContext && !!contextMenu && !contextMenu.node.is_dir && (contextMenu.isSynced || contextMenu.isCloudOnly)}
        isCloudFolder={isCloudVirtualDir(contextMenu?.node.path ?? '')}
        onClose={onClose}
        onCreateFile={async () => {
          if (contextMenu) {
            if (!(await guardTeamPermission(isTeamContext, teamPerms.createFiles, 'create files'))) return;
            const name = await showPromptDialog('New File', 'Enter file name (e.g. notes.md):');
            if (name?.trim()) {
              if (isCloudVirtualDir(contextMenu.node.path)) {
                onCreateCloudDocInFolder(contextMenu.node.path, name.trim());
              } else {
                onCreateFile(contextMenu.node.path, name.trim());
              }
            }
          }
        }}
        onCreateFolder={
          contextMenu
            ? async () => {
                if (!(await guardTeamPermission(isTeamContext, teamPerms.createFolders, 'create folders'))) return;
                const name = await showPromptDialog('New Folder', 'Enter folder name:');
                if (name?.trim()) onCreateFolder(contextMenu.node.path, name.trim());
              }
            : undefined
        }
        onRename={
          canRenameInContext
            ? async () => {
                if (contextMenu) {
                  const newName = await showPromptDialog('Rename', 'Enter new name:', contextMenu.node.name);
                  if (newName?.trim() && newName.trim() !== contextMenu.node.name) {
                    onRename(contextMenu.node.path, newName.trim());
                  }
                }
              }
            : undefined
        }
        onDelete={
          canDeleteInContext && contextMenu && !isCloudVirtualDir(contextMenu.node.path)
            ? () => { if (contextMenu) onDeleteFileOrFolder(contextMenu.node.path, contextMenu.node.name); }
            : undefined
        }
        onRevealInFolder={() => { if (contextMenu) onRevealInFolder(contextMenu.node.path); }}
        onOpen={() => {
          if (!contextMenu) return;
          if (contextMenu.isCloudOnly) onOpenCloudDoc(cloudDocIdFromPath(contextMenu.node.path));
          else onOpenFile(contextMenu.node.path);
        }}
        onSyncToCloud={
          isAuthor && user && contextMenu && !contextMenu.node.is_dir && !contextMenu.isSynced && !contextMenu.isCloudOnly
            ? () => onSyncToCloud(contextMenu.node.path)
            : undefined
        }
        onUnsyncFromCloud={
          contextMenu && (contextMenu.isSynced || contextMenu.isCloudOnly)
            ? () => {
                if (!contextMenu) return;
                const docId = contextMenu.isCloudOnly
                  ? cloudDocIdFromPath(contextMenu.node.path)
                  : documents.find(d => d.file_path === contextMenu.node.path)?.id;
                if (docId) onUnsyncFromCloud(docId);
              }
            : undefined
        }
        onMakeOffline={
          user && contextMenu && (contextMenu.isSynced || contextMenu.isCloudOnly) && teamPerms.offlineAccess
            ? () => {
                if (!contextMenu) return;
                const docId = contextMenu.isCloudOnly
                  ? cloudDocIdFromPath(contextMenu.node.path)
                  : documents.find(d => d.file_path === contextMenu.node.path)?.id;
                if (docId) onMakeOffline(docId);
              }
            : undefined
        }
        onRemoveOffline={
          user && contextMenu && contextMenu.isOfflineEnabled
            ? () => {
                if (!contextMenu) return;
                const docId = contextMenu.isCloudOnly
                  ? cloudDocIdFromPath(contextMenu.node.path)
                  : documents.find(d => d.file_path === contextMenu.node.path)?.id;
                if (docId) onRemoveOffline(docId);
              }
            : undefined
        }
        onAddToTeam={
          contextMenu && teamPerms.isTeamContext && teamPerms.addToTeam
            ? () => onAddToTeam(contextMenu.node.path)
            : undefined
        }
        onManagePermissions={
          isTeamOwner && isTeamContext && contextMenu?.docId
            ? () => setFilePermsModal({ docId: contextMenu!.docId!, title: contextMenu!.node.name })
            : undefined
        }
      />

      {filePermsModal && (
        <FilePermissionsModal
          docId={filePermsModal.docId}
          docTitle={filePermsModal.title}
          isOpen={true}
          onClose={() => setFilePermsModal(null)}
        />
      )}
    </>
  );
}
