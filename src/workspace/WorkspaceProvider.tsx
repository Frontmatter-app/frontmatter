import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../filesystem/tauriCommands';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useTeamPermissions } from '../auth/teamPermissions';
import { useWorkspaceDocuments } from './useWorkspaceDocuments';
import { useWorkspaceInit } from './useWorkspaceInit';
import { useWorkspaceTabRestore } from './useWorkspaceTabRestore';
import { useWorkspacePersistence } from './useWorkspacePersistence';
import { useFileChangeListener, useManualSave, useCloseHandler } from './useWorkspaceEventListeners';
import { useWorkspaceOperations } from './useWorkspaceOperations';
import { useMenuEvents } from './useMenuEvents';
import { useShallowMemo } from '../lib/useShallowMemo';
import type { WorkspaceContextType } from './workspaceTypes';
import type { DocumentMeta } from '../types';

const WorkspaceContext = createContext<WorkspaceContextType>({} as WorkspaceContextType);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAuthor, teamId, activeContext, isTeamOwner, teamDoc } = usePlan();
  const teamPerms = useTeamPermissions();
  const isTeamContext = activeContext.type === 'team';

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [directoryTree, setDirectoryTree] = useState<any>(null);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const {
    localDocuments, setLocalDocuments, cloudDocuments, cloudFolders, documents,
  } = useWorkspaceDocuments({ user, isAuthor, teamId, isTeamOwner, teamDoc, activeContext });

  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current !== (user?.id || null)) {
      const oldId = prevUserIdRef.current;
      prevUserIdRef.current = user?.id || null;
      if (oldId !== null) {
        setOpenTabs(prevTabs => {
          const cloudIds = new Set(cloudDocuments.map(d => d.id));
          const filtered = prevTabs.filter(id => !cloudIds.has(id));
          if (filtered.length === 0) setCurrentDocumentId(null);
          else if (currentDocumentId && cloudIds.has(currentDocumentId)) setCurrentDocumentId(filtered[0]);
          return filtered;
        });
      }
    }
  }, [user?.id, cloudDocuments, currentDocumentId]);

  const fetchDocs = useCallback(async () => {
    try {
      if (workspacePath) {
        // `stage` is TEXT in SQLite, so Rust hands it back as a plain string.
        // Narrowing to the Stage union is an assertion this boundary owns.
        const data = (await invoke('get_documents')) as DocumentMeta[];
        setLocalDocuments(data || []);
        return data || [];
      }
    } catch { /* ignore */ }
    return [];
  }, [workspacePath, setLocalDocuments]);

  const refreshDirectoryTree = useCallback(async () => {
    try {
      if (workspacePath) {
        const tree = await invoke('get_directory_tree', { workspacePath, showHidden });
        setDirectoryTree(tree);
      }
    } catch { /* ignore */ }
  }, [workspacePath, showHidden]);

  const toggleShowHidden = useCallback(() => {
    setShowHidden(prev => !prev);
  }, []);

  const openDocument = useCallback((id: string) => {
    setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id]);
    setCurrentDocumentId(id);
    setActiveVersionId(null);
  }, []);

  const closeDocument = useCallback((id: string) => {
    setOpenTabs(prev => prev.filter(d => d !== id));
    setCurrentDocumentId(prev => prev === id ? null : prev);
    setActiveVersionId(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === '.') {
        e.preventDefault();
        toggleShowHidden();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleShowHidden]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('workspace-reconciled', () => {
      fetchDocs();
      refreshDirectoryTree();
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [fetchDocs, refreshDirectoryTree]);

  useWorkspaceInit({ activeContext, setWorkspacePath, setIsInitializing, fetchDocs, openDocument });

  useWorkspaceTabRestore({
    workspacePath, setOpenTabs, setCurrentDocumentId, fetchDocs, refreshDirectoryTree,
  });

  useWorkspacePersistence({
    workspacePath, openTabs, currentDocumentId, activeContext,
    cloudDocuments, setWorkspacePath, fetchDocs, refreshDirectoryTree,
  });

  useFileChangeListener(workspacePath);
  useManualSave(currentDocumentId);
  useCloseHandler({ currentDocumentId, documents, workspacePath });

  const ops = useWorkspaceOperations(
    { user, isAuthor, isTeamContext, teamPerms, teamId, workspacePath, currentDocumentId, documents },
    { setWorkspacePath, setLocalDocuments, fetchDocs, refreshDirectoryTree, openDocument, closeDocument },
  );

  const overlay = useMenuEvents({
    workspacePath, currentDocumentId, openExternalDocument: ops.handleOpenExternalDocument,
    openWorkspace: ops.handleOpenWorkspace, openFileFromPath: ops.handleOpenFileFromPath,
    createDocument: ops.handleCreateDocument, refreshDirectoryTree,
  });

  // Built inline this object was fresh on every render, so all nine consumers
  // re-rendered whenever any single piece of workspace state changed.
  const value = useShallowMemo<WorkspaceContextType>({
    documents, cloudFolders, openTabs, currentDocumentId, workspacePath,
    isInitializing, directoryTree, refreshDirectoryTree, openWorkspace: ops.handleOpenWorkspace,
    openDocument, closeDocument, createDocument: ops.handleCreateDocument,
    openExternalDocument: ops.handleOpenExternalDocument, deleteDocument: ops.handleDeleteDocument,
    openFileFromPath: ops.handleOpenFileFromPath, createFileInWorkspace: ops.handleCreateFileInWorkspace,
    createFolderInWorkspace: ops.handleCreateFolderInWorkspace,
    deleteFileOrFolderFromWorkspace: ops.handleDeleteFileOrFolder,
    syncToCloud: ops.handleSyncToCloud, unsyncFromCloud: ops.handleUnsyncFromCloud,
    setOfflineEnabled: ops.handleSetOfflineEnabled,
    activeHeading, setActiveHeading, activeVersionId, setActiveVersionId,
    activeAnnotationId, setActiveAnnotationId, activeSuggestionId, setActiveSuggestionId,
    showHidden, toggleShowHidden,
  });

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {overlay}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
