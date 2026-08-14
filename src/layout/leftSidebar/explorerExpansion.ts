/**
 * Folder expansion state, held outside the row components.
 *
 * It used to live in each `ExplorerNode`'s `useState`, keyed by
 * `${path}-${index}`. Because the key carried the sibling index, creating a
 * file that sorted above an expanded folder shifted every later key, remounted
 * the rows, and collapsed the tree — as did each pass of the directory poll.
 * Keys are now stable node identities and the state outlives any remount.
 */

import { create } from 'zustand';

interface ExplorerExpansionState {
  expanded: Set<string>;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  expand: (key: string) => void;
  collapse: (key: string) => void;
  /** Reveals a node by expanding every ancestor key on the way to it. */
  expandAll: (keys: string[]) => void;
  reset: () => void;
}

export const useExplorerExpansion = create<ExplorerExpansionState>((set, get) => ({
  expanded: new Set<string>(),
  isExpanded: (key) => get().expanded.has(key),
  toggle: (key) => set((state) => {
    const next = new Set(state.expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { expanded: next };
  }),
  expand: (key) => set((state) => {
    if (state.expanded.has(key)) return state;
    const next = new Set(state.expanded);
    next.add(key);
    return { expanded: next };
  }),
  collapse: (key) => set((state) => {
    if (!state.expanded.has(key)) return state;
    const next = new Set(state.expanded);
    next.delete(key);
    return { expanded: next };
  }),
  expandAll: (keys) => set((state) => {
    if (keys.every(key => state.expanded.has(key))) return state;
    const next = new Set(state.expanded);
    for (const key of keys) next.add(key);
    return { expanded: next };
  }),
  reset: () => set({ expanded: new Set<string>() }),
}));

/**
 * Ancestor keys for a disk path, so opening a file can reveal it in the tree.
 * Returns the workspace root first, then each directory down to (not
 * including) the file itself.
 */
export function localAncestorKeys(workspacePath: string, filePath: string): string[] {
  if (!filePath.startsWith(workspacePath)) return [];
  const relative = filePath.slice(workspacePath.length).replace(/^\/+/, '');
  const parts = relative.split('/').filter(Boolean);
  parts.pop();

  const keys = [`local:${workspacePath}`];
  let current = workspacePath;
  for (const part of parts) {
    current = `${current}/${part}`;
    keys.push(`local:${current}`);
  }
  return keys;
}

/** Ancestor keys for a cloud path, in the same order as `localAncestorKeys`. */
export function cloudAncestorKeys(cloudPath: string): string[] {
  const parts = cloudPath.split('/').filter(Boolean);
  parts.pop();

  const keys = ['cloud:dir:'];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    keys.push(`cloud:dir:${current}`);
  }
  return keys;
}
