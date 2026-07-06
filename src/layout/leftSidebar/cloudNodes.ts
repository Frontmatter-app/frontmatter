import type { FileNode } from '../../workspace/workspaceTypes';
import type { CloudFolderMeta, DocumentMeta } from '../../types';

export const CLOUD_FILE_PREFIX = '__cloud__:';
export const CLOUD_DIR_PREFIX = '__cloud_dir__:';

export const isCloudOnlyNode = (path: string) => path.startsWith(CLOUD_FILE_PREFIX);
export const isCloudVirtualDir = (path: string) => path.startsWith(CLOUD_DIR_PREFIX);
export const cloudDocIdFromPath = (path: string) => path.replace(CLOUD_FILE_PREFIX, '');

export function injectCloudOnlyDocs(
  tree: FileNode | null,
  cloudOnlyDocs: DocumentMeta[],
  cloudFolders: CloudFolderMeta[] = [],
): FileNode | null {
  if (!tree || (cloudOnlyDocs.length === 0 && cloudFolders.length === 0)) return tree;

  const enhanced: FileNode = {
    ...tree,
    children: tree.children ? [...tree.children] : [],
  };

  for (const folder of cloudFolders) {
    const parts = folder.path.split('/').filter(Boolean);
    insertCloudFolderAtPath(enhanced.children!, parts);
  }

  for (const doc of cloudOnlyDocs) {
    const rawPath = doc.cloud_path || doc.title || 'Untitled';
    const parts = rawPath.split('/').filter(Boolean);
    insertCloudNodeAtPath(enhanced.children!, parts, doc);
  }

  return enhanced;
}

export function buildCloudWorkspaceTree(
  cloudDocs: DocumentMeta[],
  cloudFolders: CloudFolderMeta[],
  rootName: string,
): FileNode {
  const root: FileNode = {
    name: rootName,
    path: `${CLOUD_DIR_PREFIX}root`,
    is_dir: true,
    children: [],
  };

  for (const folder of cloudFolders) {
    const parts = folder.path.split('/').filter(Boolean);
    insertCloudFolderAtPath(root.children!, parts);
  }

  for (const doc of cloudDocs) {
    const rawPath = doc.cloud_path || doc.title || 'Untitled';
    const parts = rawPath.split('/').filter(Boolean);
    insertCloudNodeAtPath(root.children!, parts, doc);
  }

  return root;
}

function insertCloudFolderAtPath(
  children: FileNode[],
  parts: string[],
  currentPath = '',
): void {
  if (parts.length === 0) return;

  const folderName = parts[0];
  const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
  let folderIndex = children.findIndex(child => child.is_dir && child.name === folderName);
  if (folderIndex === -1) {
    children.push({
      name: folderName,
      path: `${CLOUD_DIR_PREFIX}${nextPath}`,
      is_dir: true,
      children: [],
    });
    folderIndex = children.length - 1;
  }

  const folder = children[folderIndex];
  const cloned: FileNode = {
    ...folder,
    children: folder.children ? [...folder.children] : [],
  };
  children[folderIndex] = cloned;
  insertCloudFolderAtPath(cloned.children!, parts.slice(1), nextPath);
}

function insertCloudNodeAtPath(
  children: FileNode[],
  parts: string[],
  doc: DocumentMeta,
  currentPath = '',
): void {
  if (parts.length === 0) return;

  if (parts.length === 1) {
    children.push({
      name: parts[0],
      path: `${CLOUD_FILE_PREFIX}${doc.id}`,
      is_dir: false,
    });
    return;
  }

  const folderName = parts[0];
  const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
  let folderIndex = children.findIndex(child => child.is_dir && child.name === folderName);
  if (folderIndex === -1) {
    children.push({
      name: folderName,
      path: `${CLOUD_DIR_PREFIX}${nextPath}`,
      is_dir: true,
      children: [],
    });
    folderIndex = children.length - 1;
  }

  const folder = children[folderIndex];
  const cloned: FileNode = {
    ...folder,
    children: folder.children ? [...folder.children] : [],
  };
  children[folderIndex] = cloned;
  insertCloudNodeAtPath(cloned.children!, parts.slice(1), doc, nextPath);
}
