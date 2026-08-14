/**
 * The explorer's node model.
 *
 * The sidebar previously merged disk files and cloud documents into one tree of
 * `FileNode`, using magic prefixes on `path` (`__cloud__:`, `__cloud_dir__:`) as
 * a stand-in for a type tag. Every consumer then re-derived the node's kind by
 * sniffing that string, which is how destinations ended up unguarded, cloud
 * folders ended up unrenameable, and duplicate cloud paths ended up rendering as
 * indistinguishable twins.
 *
 * Here the kind is part of the type. A node knows which source owns it, and
 * `key` is a stable identity usable as both a React key and an expansion-state
 * key without colliding across sources.
 */

import type { CloudFolderMeta, DocumentMeta } from '../../types';
import type { FileNode } from '../../workspace/workspaceTypes';

export type ExplorerSourceId = 'local' | 'cloud';

export interface ExplorerNode {
  /** Stable, globally unique identity. Never derived from sibling position. */
  key: string;
  name: string;
  isDir: boolean;
  source: ExplorerSourceId;
  /**
   * Absolute path on disk for local nodes; the slash-separated cloud path for
   * cloud nodes. Empty string for a source root.
   */
  path: string;
  /** Firestore document id. Cloud files only. */
  docId?: string;
  /** Local file that is mirrored to the cloud, so the row can show a badge. */
  syncedToCloud?: boolean;
  /** Cloud document the user has pinned for offline use. */
  offlineEnabled?: boolean;
  children?: ExplorerNode[];
}

export const localNodeKey = (path: string) => `local:${path}`;
export const cloudDocKey = (docId: string) => `cloud:doc:${docId}`;
export const cloudDirKey = (path: string) => `cloud:dir:${path}`;

/** Directories first, then case-insensitive name. Matches the Rust-side order. */
function compareNodes(a: ExplorerNode, b: ExplorerNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function sortTree(node: ExplorerNode): ExplorerNode {
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map(sortTree).sort(compareNodes),
  };
}

/**
 * Converts the directory tree Rust reports into explorer nodes.
 *
 * `syncedPaths` carries the set of disk paths that also exist in the cloud, so
 * rows can render a badge without the view having to search the document list.
 */
export function buildLocalTree(
  tree: FileNode | null,
  syncedPaths: Set<string> = new Set(),
): ExplorerNode | null {
  if (!tree) return null;

  const convert = (node: FileNode): ExplorerNode => ({
    key: localNodeKey(node.path),
    name: node.name,
    isDir: node.is_dir,
    source: 'local',
    path: node.path,
    syncedToCloud: !node.is_dir && syncedPaths.has(node.path),
    children: node.is_dir ? (node.children ?? []).map(convert) : undefined,
  });

  return sortTree(convert(tree));
}

function emptyCloudDir(path: string, name: string): ExplorerNode {
  return {
    key: cloudDirKey(path),
    name,
    isDir: true,
    source: 'cloud',
    path,
    children: [],
  };
}

/** Walks (creating as needed) the folder chain `parts` under `root`. */
function ensureCloudDir(root: ExplorerNode, parts: string[]): ExplorerNode {
  let current = root;
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    let next = current.children!.find(child => child.isDir && child.name === part);
    if (!next) {
      next = emptyCloudDir(currentPath, part);
      current.children!.push(next);
    }
    current = next;
  }

  return current;
}

/**
 * Appends a short id to every member of a same-name group.
 *
 * Cloud paths carry no uniqueness constraint, so two people can independently
 * create `chapter1/intro`. Hiding one would lose data and silently disagree
 * with what the other person sees, so both are shown and both are marked.
 */
function disambiguateSiblings(node: ExplorerNode): ExplorerNode {
  if (!node.children) return node;

  const byName = new Map<string, ExplorerNode[]>();
  for (const child of node.children) {
    const group = byName.get(child.name);
    if (group) group.push(child);
    else byName.set(child.name, [child]);
  }

  const children = node.children.map(child => {
    const group = byName.get(child.name)!;
    if (group.length < 2 || !child.docId) return disambiguateSiblings(child);
    return disambiguateSiblings({ ...child, name: `${child.name} · ${child.docId.slice(0, 6)}` });
  });

  return { ...node, children };
}

export function buildCloudTree(
  docs: DocumentMeta[],
  folders: CloudFolderMeta[],
  rootName: string,
): ExplorerNode {
  const root: ExplorerNode = {
    key: cloudDirKey(''),
    name: rootName,
    isDir: true,
    source: 'cloud',
    path: '',
    children: [],
  };

  for (const folder of folders) {
    const parts = folder.path.split('/').filter(Boolean);
    if (parts.length > 0) ensureCloudDir(root, parts);
  }

  for (const doc of docs) {
    const raw = doc.cloud_path || doc.title || 'Untitled';
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const name = parts[parts.length - 1];
    const parent = ensureCloudDir(root, parts.slice(0, -1));
    parent.children!.push({
      key: cloudDocKey(doc.id),
      name,
      isDir: false,
      source: 'cloud',
      path: parts.join('/'),
      docId: doc.id,
      offlineEnabled: doc.offline_enabled ?? false,
    });
  }

  return sortTree(disambiguateSiblings(root));
}

/** The parent folder path of a cloud path (`""` for a top-level entry). */
export function cloudParentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function joinCloudPath(parent: string, name: string): string {
  return [parent, name]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** Strips a trailing `.md`, which cloud paths never carry. */
export function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}

export function isDescendantPath(ancestor: string, candidate: string): boolean {
  if (!ancestor) return true;
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

/** Depth-first walk, parents before children. */
export function walkTree(node: ExplorerNode, visit: (node: ExplorerNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkTree(child, visit);
}

export function countEntries(node: ExplorerNode | null): number {
  if (!node) return 0;
  let count = 0;
  walkTree(node, n => { if (n !== node) count += 1; });
  return count;
}
