import React, { useState, useMemo, useEffect } from 'react';
import { useWorkspace, FileNode } from '../workspace/WorkspaceProvider';
import { cn } from '../lib/utils';
import { registry } from '../yjs/DocumentRegistry';
import * as Y from 'yjs';
import { useOutline } from '../hooks/useOutline';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useTeamPermissions } from '../auth/teamPermissions';
import { injectCloudOnlyDocs, buildCloudWorkspaceTree } from './leftSidebar/cloudNodes';
import { useFileOperations } from './leftSidebar/useFileOperations';
import { SidebarHeader } from './leftSidebar/SidebarHeader';
import { ExplorerView } from './leftSidebar/ExplorerView';
import { OutlineView } from './leftSidebar/OutlineView';
import { GitPanel } from './leftSidebar/GitPanel';
import { ContextMenuActions } from './leftSidebar/ContextMenuActions';



export function LeftSidebar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const {
    documents, cloudFolders, currentDocumentId, workspacePath,
    directoryTree, openWorkspace,
  } = useWorkspace();

  const { user } = useAuth();
  const { activeContext } = usePlan();
  const teamPerms = useTeamPermissions();
  const isTeamContext = activeContext.type === 'team';

  const workspaceLabel = useMemo(() => {
    if (isTeamContext) return activeContext.teamName || 'Team Workspace';
    if (!workspacePath) return 'Open Folder';
    const parts = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || workspacePath;
  }, [isTeamContext, activeContext.teamName, workspacePath]);

  const [showOverview, setShowOverview] = useState(!currentDocumentId);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; node: FileNode;
    isSynced: boolean; isCloudOnly: boolean;
    isOfflineEnabled: boolean; docId?: string;
  } | null>(null);

  const ops = useFileOperations();

  const syncedPaths = useMemo(() => {
    const s = new Set<string>();
    documents.forEach(d => { if (d.cloud_synced && d.file_path) s.add(d.file_path); });
    return s;
  }, [documents]);

  const sidebarTree = useMemo(() => {
    const cloudOnlyDocs = documents.filter(d => d.is_cloud && !d.file_path);
    if (isTeamContext && !directoryTree) {
      return buildCloudWorkspaceTree(cloudOnlyDocs, cloudFolders, workspaceLabel);
    }
    return injectCloudOnlyDocs(directoryTree, cloudOnlyDocs, cloudFolders);
  }, [directoryTree, documents, cloudFolders, isTeamContext, workspaceLabel]);

  useEffect(() => {
    if (!currentDocumentId) {
      setShowOverview(true);
      setYdoc(null);
      return;
    }
    setShowOverview(false);
    let active = true;
    let acquiredDoc: Y.Doc | null = null;

    registry.acquire(currentDocumentId).then(doc => {
      if (!active) { registry.release(currentDocumentId); return; }
      acquiredDoc = doc;
      setYdoc(doc);
    });

    return () => {
      active = false;
      registry.release(currentDocumentId);
    };
  }, [currentDocumentId]);

  const markdownOutline = useOutline(ydoc ? ydoc.getText('markdown') : null);

  const handleContextMenuOpen = (x: number, y: number, node: FileNode) => {
    const isSynced = !node.is_dir && syncedPaths.has(node.path);
    const isCloud = node.path.startsWith('__cloud__:');
    const docId = isCloud
      ? node.path.replace('__cloud__:', '')
      : documents.find(d => d.file_path === node.path)?.id;
    const doc = documents.find(d => d.id === docId);
    const isOffline = doc?.offline_enabled ?? false;
    setContextMenu({ x, y, node, isSynced, isCloudOnly: isCloud, isOfflineEnabled: isOffline, docId });
  };

  return (
    <div className={cn('px-4 py-6 flex flex-col h-full overflow-hidden', className)} style={style}>
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {showOverview ? (
          <div className="flex flex-col h-full">
            {currentDocumentId && (
              <button
                onClick={() => setShowOverview(false)}
                className="flex items-center text-xs font-semibold text-gray-500 hover:text-gray-900 mb-6 transition cursor-pointer"
              >
                <span className="mr-1">&larr;</span> Back to Outline
              </button>
            )}
            <SidebarHeader
              isTeamContext={isTeamContext}
              workspacePath={workspacePath}
              workspaceLabel={workspaceLabel}
              onNewRootFile={ops.handleNewRootFile}
              onNewRootFolder={ops.handleNewRootFolder}
              onOpenExternal={ops.handleOpenExternalDocument}
              onOpenWorkspace={openWorkspace}
            />
            <ExplorerView
              sidebarTree={sidebarTree}
              isTeamContext={isTeamContext}
              onMove={ops.handleMove}
              onOpenFile={ops.handleOpenFile}
              onOpenCloudDoc={ops.handleOpenCloudDoc}
              onContextMenu={handleContextMenuOpen}
              syncedPaths={syncedPaths}
            />
          </div>
        ) : (
          <OutlineView onBackToExplorer={() => setShowOverview(true)} outline={markdownOutline} />
        )}
      </div>

      <GitPanel />

      <ContextMenuActions
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        onSetContextMenu={setContextMenu}
        onOpenFile={ops.handleOpenFile}
        onOpenCloudDoc={ops.handleOpenCloudDoc}
        onCreateFile={ops.handleCreateFile}
        onCreateFolder={ops.handleCreateFolder}
        onCreateCloudDocInFolder={ops.handleCreateCloudDocInFolder}
        onDeleteFileOrFolder={ops.handleDeleteFileOrFolder}
        onRename={ops.handleRename}
        onRevealInFolder={ops.handleRevealInFolder}
        onSyncToCloud={ops.syncToCloud}
        onUnsyncFromCloud={ops.unsyncFromCloud}
        onMakeOffline={(docId: string) => ops.setOfflineEnabled(docId, true)}
        onRemoveOffline={(docId: string) => ops.setOfflineEnabled(docId, false)}
        onAddToTeam={ops.handleAddToTeam}
        syncedPaths={syncedPaths}
        documents={documents}
        isTeamContext={isTeamContext}
        isTeamOwner={ops.isTeamOwner}
        isAuthor={ops.isAuthor}
        user={user}
        teamPerms={teamPerms}
      />
    </div>
  );
}
