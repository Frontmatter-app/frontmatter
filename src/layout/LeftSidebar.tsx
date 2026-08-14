import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { cn } from '../lib/utils';
import { registry } from '../yjs/DocumentRegistry';
import { useOutline } from '../hooks/useOutline';
import { useSidebarContext } from './SidebarContext';
import { invoke } from '../filesystem/tauriCommands';
import { usePlan } from '../billing/PlanProvider';
import { cloudDocKey, localNodeKey } from './leftSidebar/explorerModel';
import {
  cloudAncestorKeys, localAncestorKeys, useExplorerExpansion,
} from './leftSidebar/explorerExpansion';
import { useLocalExplorerSource } from './leftSidebar/sources/useLocalExplorerSource';
import { useCloudExplorerSource } from './leftSidebar/sources/useCloudExplorerSource';
import { ExplorerView } from './leftSidebar/ExplorerView';
import { OutlineView } from './leftSidebar/OutlineView';
import { VersionControlPanel } from './leftSidebar/VersionControlPanel';
import { ContextMenuActions, type ExplorerContextTarget } from './leftSidebar/ContextMenuActions';

export function LeftSidebar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const {
    documents, cloudFolders, openTabs, currentDocumentId, workspacePath, directoryTree,
    refreshDirectoryTree, openWorkspace, openDocument, closeDocument, refreshDocuments,
    openFileFromPath, createFileInWorkspace, createFolderInWorkspace,
    deleteFileOrFolderFromWorkspace, syncToCloud, unsyncFromCloud, setOfflineEnabled,
  } = useWorkspace();

  const { user, isTeamContext, teamName, teamPerms, isAuthor } = useSidebarContext();
  const { teamId } = usePlan();

  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [contextTarget, setContextTarget] = useState<ExplorerContextTarget | null>(null);
  const expandAll = useExplorerExpansion(state => state.expandAll);
  const resetExpansion = useExplorerExpansion(state => state.reset);

  const syncedPaths = useMemo(() => {
    const paths = new Set<string>();
    documents.forEach(d => { if (d.cloud_synced && d.file_path) paths.add(d.file_path); });
    return paths;
  }, [documents]);

  const saveCloudDocumentLocally = useCallback(async (docId: string) => {
    await invoke('save_as_document', { id: docId });
    await refreshDocuments();
    await refreshDirectoryTree();
  }, [refreshDocuments, refreshDirectoryTree]);

  const localSource = useLocalExplorerSource({
    workspacePath, directoryTree, syncedPaths, isTeamContext, user, teamPerms,
    openFileFromPath, createFileInWorkspace, createFolderInWorkspace,
    deleteFileOrFolderFromWorkspace, refreshDirectoryTree, openWorkspace,
    saveCloudDocumentLocally,
  });

  const cloudSource = useCloudExplorerSource({
    label: isTeamContext ? (teamName || 'Team') : 'Cloud',
    user, teamId, isTeamContext, isAuthor, teamPerms, documents, cloudFolders,
    workspacePath, currentDocumentId, openDocument, closeDocument,
    fetchDocs: refreshDocuments, syncToCloud, unsyncFromCloud, setOfflineEnabled,
  });

  /**
   * The cloud section is hidden for signed-out users with nothing in it, so a
   * purely local user never sees an empty second pane.
   */
  const sources = useMemo(() => {
    const cloudHasContent = (cloudSource.tree?.children?.length ?? 0) > 0;
    if (!user || (!isTeamContext && !cloudHasContent)) return [localSource];
    return [cloudSource, localSource];
  }, [cloudSource, localSource, user, isTeamContext]);

  const currentDocument = useMemo(
    () => documents.find(d => d.id === currentDocumentId) ?? null,
    [documents, currentDocumentId],
  );

  const nodeKeyForDocument = useCallback((id: string) => {
    const document = documents.find(d => d.id === id);
    if (!document) return null;
    return document.file_path ? localNodeKey(document.file_path) : cloudDocKey(id);
  }, [documents]);

  const activeKey = useMemo(
    () => (currentDocumentId ? nodeKeyForDocument(currentDocumentId) : null),
    [currentDocumentId, nodeKeyForDocument],
  );

  const openKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const id of openTabs) {
      const key = nodeKeyForDocument(id);
      if (key) keys.add(key);
    }
    return keys;
  }, [openTabs, nodeKeyForDocument]);

  // Reveal the active document by expanding its ancestors. Expansion is
  // additive, so this never collapses anything the user opened by hand.
  useEffect(() => {
    if (!currentDocument) return;
    if (currentDocument.file_path && workspacePath) {
      expandAll(localAncestorKeys(workspacePath, currentDocument.file_path));
    } else if (currentDocument.cloud_path) {
      expandAll(cloudAncestorKeys(currentDocument.cloud_path));
    }
  }, [currentDocument, workspacePath, expandAll]);

  // Expansion keys are workspace-scoped paths; carrying them into a different
  // workspace would leave stale entries accumulating for the session.
  useEffect(() => { resetExpansion(); }, [workspacePath, resetExpansion]);

  useEffect(() => {
    if (!currentDocumentId) {
      setYdoc(null);
      return;
    }
    let active = true;
    registry.acquire(currentDocumentId).then(doc => {
      if (!active) { registry.release(currentDocumentId); return; }
      setYdoc(doc);
    });
    return () => {
      active = false;
      registry.release(currentDocumentId);
    };
  }, [currentDocumentId]);

  const markdownOutline = useOutline(ydoc ? ydoc.getText('markdown') : null);

  const handleContextMenu = useCallback<
    (x: number, y: number, node: ExplorerContextTarget['node'], source: ExplorerContextTarget['source']) => void
  >((x, y, node, source) => setContextTarget({ x, y, node, source }), []);

  const transferSource = contextTarget
    ? sources.find(source => source.id !== contextTarget.source.id)
    : undefined;

  return (
    <div className={cn('px-4 py-6 flex flex-col h-full overflow-hidden', className)} style={style}>
      <div className="flex-1 overflow-y-auto min-h-0 pr-1 flex flex-col gap-3">
        <ExplorerView
          sources={sources}
          activeKey={activeKey}
          openKeys={openKeys}
          onContextMenu={handleContextMenu}
        />
        <OutlineView outline={markdownOutline} hasDocument={!!currentDocumentId} />
      </div>

      <VersionControlPanel ydoc={ydoc} currentDocumentId={currentDocumentId} />

      <ContextMenuActions
        target={contextTarget}
        transferSource={transferSource}
        onClose={() => setContextTarget(null)}
      />
    </div>
  );
}
