import React, { createContext, useContext, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CloudFolderMeta, DocumentMeta } from '../types';
import { invoke } from '../filesystem/tauriCommands';
import { listen } from '@tauri-apps/api/event';
import { registry, useDirtyDocsStore } from '../yjs/DocumentRegistry';
import { generateDraftFromMarkdown } from '../yjs/DocumentRegistry';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { subscribeToCloudDocuments, subscribeToCloudFolders, pushCloudDocument } from '../cloud/firestoreSync';
import { useSyncStatusStore } from '../cloud/syncStatusStore';
import { TeamGroupsMap, useTeamPermissions } from '../auth/teamPermissions';
import { showAlertDialog } from '../lib/tauriDialog';
import { useMenuEvents } from './useMenuEvents';

const isPathInside = (parent: string, child: string) => {
  const parentNormalized = parent.replace(/\/+$/, "");
  const childNormalized = child.replace(/\/+$/, "");
  
  if (childNormalized === parentNormalized) return true;
  return childNormalized.startsWith(parentNormalized + "/");
};

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface WorkspaceContextType {
  documents: DocumentMeta[];
  cloudFolders: CloudFolderMeta[];
  openTabs: string[];
  currentDocumentId: string | null;
  workspacePath: string | null;
  isInitializing: boolean;
  directoryTree: FileNode | null;
  refreshDirectoryTree: () => Promise<void>;
  openWorkspace: () => void;
  openDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  createDocument: (title?: string) => Promise<void>;
  openExternalDocument: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  openFileFromPath: (path: string) => Promise<void>;
  createFileInWorkspace: (parentDir: string, name: string) => Promise<void>;
  createFolderInWorkspace: (parentDir: string, name: string) => Promise<void>;
  deleteFileOrFolderFromWorkspace: (path: string) => Promise<void>;
  syncToCloud: (filePath: string, cloudPath?: string) => Promise<void>;
  unsyncFromCloud: (docId: string) => Promise<void>;
  setOfflineEnabled: (docId: string, enabled: boolean) => Promise<void>;
  activeHeading: string | null;
  setActiveHeading: (heading: string | null) => void;
  activeVersionId: string | null;
  setActiveVersionId: (id: string | null) => void;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  activeSuggestionId: string | null;
  setActiveSuggestionId: (id: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  documents: [],
  cloudFolders: [],
  openTabs: [],
  currentDocumentId: null,
  workspacePath: null,
  isInitializing: true,
  directoryTree: null,
  refreshDirectoryTree: async () => {},
  openWorkspace: () => {},
  openDocument: () => {},
  closeDocument: () => {},
  createDocument: async () => {},
  openExternalDocument: () => {},
  deleteDocument: async () => {},
  openFileFromPath: async () => {},
  createFileInWorkspace: async () => {},
  createFolderInWorkspace: async () => {},
  deleteFileOrFolderFromWorkspace: async () => {},
  syncToCloud: async () => {},
  unsyncFromCloud: async () => {},
  setOfflineEnabled: async () => {},
  activeHeading: null,
  setActiveHeading: () => {},
  activeVersionId: null,
  setActiveVersionId: () => {},
  activeAnnotationId: null,
  setActiveAnnotationId: () => {},
  activeSuggestionId: null,
  setActiveSuggestionId: () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [localDocuments, setLocalDocuments] = useState<DocumentMeta[]>([]);
  const [cloudDocuments, setCloudDocuments] = useState<DocumentMeta[]>([]);
  const [cloudFolders, setCloudFolders] = useState<CloudFolderMeta[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [directoryTree, setDirectoryTree] = useState<FileNode | null>(null);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);

  const { user } = useAuth();
  const { isAuthor, teamId, activeContext, isTeamOwner, teamDoc } = usePlan();
  const teamPerms = useTeamPermissions();
  const isTeamContext = activeContext.type === 'team';

  const guardTeamAuth = async (description: string) => {
    if (!user && isTeamContext) {
      await showAlertDialog('Authentication Required', description);
      return false;
    }
    return true;
  };

  const canCreateInCurrentContext = async () => {
    if (!(await guardTeamAuth('Please sign in to create files in a team workspace.'))) return false;
    if (isTeamContext && !teamPerms.createFiles) {
      await showAlertDialog('Permission Denied', 'You do not have permission to create files in this team workspace.');
      return false;
    }
    return true;
  };

  const canOpenLocalInCurrentContext = async () => {
    if (!(await guardTeamAuth('Please sign in to open local files in a team workspace.'))) return false;
    if (isTeamContext && !teamPerms.openLocalFiles) {
      await showAlertDialog('Permission Denied', 'Your group does not have permission to open local files or folders in this team workspace.');
      return false;
    }
    return true;
  };

  const canAddLocalToCurrentTeam = async () => {
    if (!(await guardTeamAuth('Please sign in to add files to a team workspace.'))) return false;
    if (isTeamContext && !teamPerms.addToTeam) {
      await showAlertDialog('Permission Denied', 'Your group does not have permission to add files to the team.');
      return false;
    }
    return true;
  };

  // Merge local and cloud documents.
  // Local docs take priority — if the same ID exists in both, local wins
  // and gets annotated with cloud sync metadata from the Firestore record.
  // Cloud-only docs (not in local SQLite) are added with is_cloud:true.
  const documents = React.useMemo(() => {
    const map = new Map<string, DocumentMeta>();
    // Step 1: seed from local (includes cloud_synced / cloud_id from SQLite)
    localDocuments.forEach((doc) => map.set(doc.id, doc));
    // Step 2: merge cloud docs — annotate existing, add new cloud-only
    cloudDocuments.forEach((cloudDoc) => {
      const existing = map.get(cloudDoc.id);
      if (existing) {
        // Already have a local copy — keep local content but mark cloud_path/synced
        map.set(cloudDoc.id, {
          ...existing,
          cloud_synced: existing.cloud_synced || existing.cloud_id === cloudDoc.id,
          cloud_path:   existing.cloud_path   || cloudDoc.cloud_path,
        });
      } else {
        // No local copy — treat as cloud-only
        map.set(cloudDoc.id, { ...cloudDoc, is_cloud: true });
      }
    });
    return Array.from(map.values());
  }, [localDocuments, cloudDocuments]);

  // Subscribe to Cloud Documents
  useEffect(() => {
    if (user && isAuthor) {
      const myGroupIds = activeContext.type === 'team'
        ? Object.entries((teamDoc?.groups ?? {}) as TeamGroupsMap)
            .filter(([, group]) => group.members.includes(user.id))
            .map(([groupId]) => groupId)
        : [];

      const unsub = subscribeToCloudDocuments(
        user.id,
        teamId,
        {
          isTeamOwner,
          myGroupIds,
        },
        (cloudDocs) => {
          setCloudDocuments(cloudDocs);
          useSyncStatusStore.getState().setCloudDocumentIds(cloudDocs.map(d => d.id));
        },
      );
      return () => {
        unsub();
        useSyncStatusStore.getState().setCloudDocumentIds([]);
      };
    } else if (!user) {
      setCloudDocuments([]);
      setCloudFolders([]);
      useSyncStatusStore.getState().setCloudDocumentIds([]);
    }
  }, [user, isAuthor, teamId, isTeamOwner, teamDoc, activeContext]);

  useEffect(() => {
    if (!user || !isAuthor) {
      setCloudFolders([]);
      return;
    }

    const unsub = subscribeToCloudFolders(user.id, teamId, setCloudFolders);
    return () => unsub();
  }, [user, isAuthor, teamId]);

  // Handle Account Switching / Logout: close cloud-only active tabs
  const prevUserIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current !== (user?.id || null)) {
      const oldId = prevUserIdRef.current;
      prevUserIdRef.current = user?.id || null;
      if (oldId !== null) {
        setOpenTabs((prevTabs) => {
          const cloudIds = new Set(cloudDocuments.map(d => d.id));
          const filtered = prevTabs.filter(id => !cloudIds.has(id));
          if (filtered.length === 0) {
            setCurrentDocumentId(null);
          } else if (currentDocumentId && cloudIds.has(currentDocumentId)) {
            setCurrentDocumentId(filtered[0]);
          }
          return filtered;
        });
      }
    }
  }, [user?.id, cloudDocuments, currentDocumentId]);

  const fetchDocs = async () => {
    try {
      if (workspacePath) {
        const data: DocumentMeta[] = await invoke('get_documents');
        const docs = data || [];
        setLocalDocuments(docs);
        return docs;
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  };

  const refreshDirectoryTree = async () => {
    try {
      if (workspacePath) {
        const tree = await invoke<FileNode>('get_directory_tree', { workspacePath });
        setDirectoryTree(tree);
      }
    } catch (e) {
      console.error('Failed to get directory tree:', e);
    }
  };

  useEffect(() => {
    if (workspacePath) {
      // Fetch docs first, then validate localStorage tabs against the live document list.
      // This prevents stale IDs (from a wiped DB) from causing "Document not found" errors.
      fetchDocs().then((liveDocs) => {
        const liveIds = new Set((liveDocs || []).map((d: DocumentMeta) => d.id));

        const savedTabs = localStorage.getItem(`marktype_tabs_${workspacePath}`);
        const savedActive = localStorage.getItem(`marktype_active_${workspacePath}`);

        if (savedTabs) {
          try {
            const parsed = (JSON.parse(savedTabs) as string[]).filter(id => liveIds.has(id));
            if (parsed.length > 0) {
              setOpenTabs(parsed);
              const active = savedActive && liveIds.has(savedActive) ? savedActive : parsed[0];
              setCurrentDocumentId(active);
            } else {
              // All saved tabs are stale — clear them so the app starts fresh
              localStorage.removeItem(`marktype_tabs_${workspacePath}`);
              localStorage.removeItem(`marktype_active_${workspacePath}`);
            }
          } catch (e) {
            console.error('Failed to parse saved tabs:', e);
            localStorage.removeItem(`marktype_tabs_${workspacePath}`);
            localStorage.removeItem(`marktype_active_${workspacePath}`);
          }
        }
      });

      refreshDirectoryTree();

      const intervalDocs = setInterval(fetchDocs, 10000);
      const intervalTree = setInterval(refreshDirectoryTree, 10000);

      return () => {
        clearInterval(intervalDocs);
        clearInterval(intervalTree);
      };
    }
  }, [workspacePath]);

  // Persist open tabs and active tab
  useEffect(() => {
    if (workspacePath) {
      localStorage.setItem(`marktype_tabs_${workspacePath}`, JSON.stringify(openTabs));
    }
  }, [openTabs, workspacePath]);

useEffect(() => {
    if (currentDocumentId) {
      localStorage.setItem(`marktype_active_${workspacePath}`, currentDocumentId);
    } else {
      localStorage.removeItem(`marktype_active_${workspacePath}`);
    }
  }, [currentDocumentId, workspacePath]);

// Save last opened workspace to config
   useEffect(() => {
     if (workspacePath) {
       invoke('save_last_workspace', {
         workspaceContextJson: JSON.stringify(activeContext),
         path: workspacePath,
       }).catch(console.error);
     }
   }, [workspacePath, activeContext]);

  // Auto-initialize workspace on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Check if this window already has a workspace from the backend (e.g. opened via menu)
        const existingPath = await invoke<string | null>('get_window_workspace');
        if (existingPath) {
          setWorkspacePath(existingPath);
          setIsInitializing(false);

          // Check for a pending import (file opened via File > Open File menu)
          const pending = await invoke<{ path: string; name: string; content: string } | null>('get_pending_import');
          if (pending) {
            const newId = uuidv4();
            await invoke('create_document', {
              id: newId,
              title: pending.name.replace(/\.md$/i, ''),
              content: JSON.stringify({ markdown: pending.content, draft: '' }),
              filePath: pending.path,
            });
            await fetchDocs();
            openDocument(newId);
          }
          return;
        }

        // If this window was opened for a different account (via account switcher),
        // skip restoring the last workspace path to avoid inheriting the parent
        // window's workspace. Start fresh with the default for this context.
        const urlParams = new URLSearchParams(window.location.search);
        const isAccountWindow = urlParams.has('account_uid');

        let workspaceToOpen: string;
        if (isAccountWindow) {
          workspaceToOpen = await invoke<string>('get_default_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
        } else {
          const lastWorkspace = await invoke<string | null>('get_last_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
          workspaceToOpen = lastWorkspace || await invoke<string>('get_default_workspace', {
            workspaceContextJson: JSON.stringify(activeContext),
          });
        }

        const result = await invoke<{ path: string; is_valid: boolean } | null>('open_workspace', { path: workspaceToOpen });
        if (result && result.is_valid) {
          setWorkspacePath(result.path);
        }
      } catch (e) {
        console.error('Failed to initialize workspace:', e);
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, [activeContext]);

  // Listen for file changes from external editors and re-index
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

  // Listen for Cmd+S or Ctrl+S manual save shortcuts
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentDocumentId]);

  // Listen for window close request to warn about unsaved changes
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupCloseListener = async () => {
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        const dirtyDocs = useDirtyDocsStore.getState().dirtyDocs;
        if (dirtyDocs.size === 0) {
          return;
        }

        // We have unsaved changes, prevent the immediate close
        event.preventDefault();

        // Get the title of the dirty document (prefer active doc, fallback to first dirty)
        const dirtyArray = Array.from(dirtyDocs);
        const docToSaveId = currentDocumentId && dirtyDocs.has(currentDocumentId) 
          ? currentDocumentId 
          : dirtyArray[0];

        const docMeta = documents.find(d => d.id === docToSaveId);
        const docTitle = docMeta?.title || "Untitled Document";

        try {
          const action = await invoke<string>('show_unsaved_dialog', { title: docTitle });
          
          if (action === 'save') {
            // Save all dirty documents
            for (const docId of dirtyArray) {
              await registry.saveDocument(docId);
            }
            // Once saved, unlisten and close
            if (unlisten) unlisten();
            await appWindow.close();
          } else if (action === 'discard') {
            // Discard: mark all clean so we don't prompt again
            for (const docId of dirtyArray) {
              useDirtyDocsStore.getState().setDirty(docId, false);
            }
            if (unlisten) unlisten();
            await appWindow.close();
          }
          // If 'cancel', we just return and leave the window open
        } catch (e) {
          console.error("Failed to show unsaved changes dialog:", e);
        }
      });
    };

    setupCloseListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [currentDocumentId, documents]);

  const openWorkspace = async () => {
    if (!(await canOpenLocalInCurrentContext())) return;
    try {
      const result = await invoke<{ path: string, is_valid: boolean } | null>('open_workspace');
      if (result && result.is_valid) {
        setWorkspacePath(result.path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openDocument = (id: string) => {
    setOpenTabs((prev) => {
      const newTabs = [...prev];
      if (!newTabs.includes(id)) {
        newTabs.push(id);
      }
      return newTabs;
    });
    setCurrentDocumentId(id);
    setActiveVersionId(null);
  };

  const closeDocument = (id: string) => {
    setOpenTabs((prev) => prev.filter((docId) => docId !== id));
    if (currentDocumentId === id) {
      setCurrentDocumentId(null);
    }
    setActiveVersionId(null);
  };

  const createDocument = async (title?: string) => {
    if (!(await canCreateInCurrentContext())) return;

    const newId = uuidv4();
    const isTeamWorkspace = isTeamContext && user && teamId;

    if (isTeamWorkspace) {
      const resolvedTitle = title || `Untitled ${newId.slice(0, 8)}`;
      try {
        const docMeta = await invoke<DocumentMeta>('create_document', {
          id: newId,
          title: resolvedTitle,
          content: JSON.stringify({ markdown: '', draft: '' }),
          filePath: null,
        });

        await pushCloudDocument(
          {
            ...docMeta,
            cloud_path: resolvedTitle,
          },
          user.id,
          teamId,
          resolvedTitle,
        );

        await invoke('set_cloud_sync', {
          id: newId,
          cloudId: newId,
          cloudPath: resolvedTitle,
        });

        await fetchDocs();
        openDocument(newId);
      } catch (e) {
        console.error('Failed to create team document:', e);
      }
      return;
    }

    let filePath = null;
    try {
      filePath = await invoke<string | null>('pick_save_path', { suggestedTitle: 'Untitled Document' });
    } catch (e) {
      console.error('No file picker available', e);
    }

    if (currentDocumentId) {
      await invoke('create_document', {
        id: newId,
        title: 'Untitled Document',
        content: '',
        filePath: filePath
      });
      if (filePath && workspacePath) {
        await invoke('open_file_in_new_window_command', {
          workspacePath,
          filePath
        });
      }
    } else {
      await invoke('create_document', {
        id: newId,
        title: 'Untitled Document',
        content: '',
        filePath: filePath
      });
      await fetchDocs();
      if (filePath) {
        await refreshDirectoryTree();
      }
      openDocument(newId);
    }
  };

  const openExternalDocument = async () => {
    if (isTeamContext) {
      if (!(await canAddLocalToCurrentTeam())) return;
    } else if (!(await canOpenLocalInCurrentContext())) {
      return;
    }

    try {
      if (isTeamContext) {
        const file = await invoke<[string, string, string] | null>('open_external_file');
        if (file) {
          const [path] = file;
          await syncToCloud(path);
        }
        return;
      }

      const file = await invoke<[string, string, string] | null>('open_external_file');
      if (file) {
        const [path] = file;
        await openFileFromPath(path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteDocument = async (id: string) => {
    try {
      await invoke('delete_document', { id });
      closeDocument(id);
      await fetchDocs();
    } catch (e) {
      console.error('Failed to delete document:', e);
    }
  };

  const openFileFromPath = async (filePath: string) => {
    if (!(await canOpenLocalInCurrentContext())) return;

    try {
      const isInWorkspace = workspacePath && isPathInside(workspacePath, filePath);
      
      if (isInWorkspace) {
        if (currentDocumentId) {
          await registry.saveDocument(currentDocumentId);
        }
        const doc = await invoke<DocumentMeta>('open_or_import_file', { filePath });
        await fetchDocs();
        openDocument(doc.id);
      } else {
        // External file: open in new window or as a new document but only keep outline in draft
        if (currentDocumentId && workspacePath) {
          // Save current doc first
          await invoke('open_file_in_new_window_command', {
            workspacePath,
            filePath
          });
        } else {
          // Import the file as a new document
          const doc = await invoke<DocumentMeta>('open_or_import_file', { filePath });
          await fetchDocs();
          openDocument(doc.id);
          // After loading, clear markdown and set stage to draft with outline generated from original content
          const ydoc = await registry.acquire(doc.id);
          const markdownText = ydoc.getText('markdown');
          const originalMarkdown = markdownText.toString();
          const draftOutline = generateDraftFromMarkdown(originalMarkdown, false);
          const draftText = ydoc.getText('draft');
          ydoc.transact(() => {
            // Remove full markdown content
            markdownText.delete(0, markdownText.length);
            // Insert outline into draft if available
            if (draftOutline) {
              draftText.delete(0, draftText.length);
              draftText.insert(0, draftOutline);
            }
            ydoc.getMap('meta').set('stage', 'draft');
          }, 'external-outline-only');
        }
      }
    } catch (e) {
      console.error('Failed to open file from path:', e);
    }
  };

  const createFileInWorkspace = async (parentDir: string, name: string) => {
    try {
      const filePath = await invoke<string>('create_file_on_disk', { parentDir, name });
      await refreshDirectoryTree();
      await openFileFromPath(filePath);
    } catch (e) {
      console.error('Failed to create file on disk:', e);
      throw e;
    }
  };

  const createFolderInWorkspace = async (parentDir: string, name: string) => {
    try {
      await invoke('create_directory_on_disk', { parentDir, name });
      await refreshDirectoryTree();
    } catch (e) {
      console.error('Failed to create directory on disk:', e);
      throw e;
    }
  };

  const deleteFileOrFolderFromWorkspace = async (filePath: string) => {
    try {
      await invoke('delete_file_or_dir_on_disk', { path: filePath });
      // If any open tabs represent files inside the deleted path, close them
      const affectedDocs = documents.filter(d => d.file_path && d.file_path.startsWith(filePath));
      for (const d of affectedDocs) {
        closeDocument(d.id);
        await invoke('delete_document', { id: d.id });
      }
      await fetchDocs();
      await refreshDirectoryTree();
    } catch (e) {
      console.error('Failed to delete file/folder:', e);
    }
  };

  // Sync a local file to cloud (keeps local copy intact)
  const syncToCloud = async (filePath: string, cloudPath?: string) => {
    if (!user || !isAuthor) {
      throw new Error('You must be signed in with an active author plan to sync files to the cloud.');
    }
    try {
      // 1. Get/import the document metadata from SQLite
      const docMeta = await invoke<DocumentMeta>('open_or_import_file', { filePath });

      // 2. Derive the cloud path from the workspace path if not provided
      const resolvedCloudPath = cloudPath ?? (
        workspacePath && filePath.startsWith(workspacePath)
          ? filePath.slice(workspacePath.length + 1).replace(/\.md$/i, '')
          : docMeta.title
      );

      // 3. Push to Firestore (merge, does NOT delete local)
      await pushCloudDocument(
        { ...docMeta, cloud_path: resolvedCloudPath },
        user.id,
        teamId,
        resolvedCloudPath,
      );

      // 4. Record cloud_id in SQLite so badge renders correctly
      await invoke('set_cloud_sync', {
        id: docMeta.id,
        cloudId: docMeta.id,
        cloudPath: resolvedCloudPath,
      });

      // 5. Refresh local docs so badge updates immediately
      await fetchDocs();
    } catch (e) {
      console.error('Failed to sync document to cloud:', e);
      throw e;
    }
  };

  // Remove cloud sync for a file (deletes Firestore copy, local file stays)
  const unsyncFromCloud = async (docId: string) => {
    try {
      const { deleteCloudDocument } = await import('../cloud/firestoreSync');
      await deleteCloudDocument(docId);
      await invoke('clear_cloud_sync', { id: docId });
      await fetchDocs();
    } catch (e) {
      console.error('Failed to unsync document from cloud:', e);
      throw e;
    }
  };

  // Toggle offline availability for a cloud document
  const setOfflineEnabled = async (docId: string, enabled: boolean) => {
    try {
      await invoke('set_offline_enabled', { id: docId, enabled });
      await fetchDocs();
    } catch (e) {
      console.error('Failed to set offline mode:', e);
      throw e;
    }
  };

  // All menu event listeners extracted to a reusable hook
  useMenuEvents({
    workspacePath,
    currentDocumentId,
    openExternalDocument,
    openWorkspace,
    openFileFromPath,
    createDocument,
    refreshDirectoryTree,
  });

  return (
    <WorkspaceContext.Provider value={{
      documents,
      cloudFolders,
      openTabs,
      currentDocumentId,
      workspacePath,
      isInitializing,
      directoryTree,
      refreshDirectoryTree,
      openWorkspace,
      openDocument,
      closeDocument,
      createDocument,
      openExternalDocument,
      deleteDocument,
      openFileFromPath,
      createFileInWorkspace,
      createFolderInWorkspace,
      deleteFileOrFolderFromWorkspace,
      syncToCloud,
      unsyncFromCloud,
      setOfflineEnabled,
      activeHeading,
      setActiveHeading,
      activeVersionId,
      setActiveVersionId,
      activeAnnotationId,
      setActiveAnnotationId,
      activeSuggestionId,
      setActiveSuggestionId
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
