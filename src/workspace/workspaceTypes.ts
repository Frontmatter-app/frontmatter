import type { TeamGroupsMap } from '../auth/teamPermissions';

export const isPathInside = (parent: string, child: string) => {
  const parentNormalized = parent.replace(/\/+$/, '');
  const childNormalized = child.replace(/\/+$/, '');
  if (childNormalized === parentNormalized) return true;
  return childNormalized.startsWith(parentNormalized + '/');
};

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface WorkspaceContextType {
  documents: import('../types').DocumentMeta[];
  cloudFolders: import('../types').CloudFolderMeta[];
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
  showHidden: boolean;
  toggleShowHidden: () => void;
}
