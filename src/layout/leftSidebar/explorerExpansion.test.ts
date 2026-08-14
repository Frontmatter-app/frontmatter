import { beforeEach, describe, expect, it } from 'vitest';
import {
  cloudAncestorKeys,
  localAncestorKeys,
  useExplorerExpansion,
} from './explorerExpansion';
import { buildLocalTree, cloudDirKey, localNodeKey } from './explorerModel';
import type { FileNode } from '../../workspace/workspaceTypes';

describe('expansion state', () => {
  beforeEach(() => useExplorerExpansion.getState().reset());

  it('survives a tree rebuild that reorders siblings', () => {
    // Expansion used to live in each row's own state, keyed by path *and*
    // sibling index, so inserting a file above an expanded folder remounted
    // the rows and collapsed them.
    const before: FileNode = {
      name: 'w', path: '/w', is_dir: true, children: [
        { name: 'chapters', path: '/w/chapters', is_dir: true, children: [] },
      ],
    };
    const after: FileNode = {
      name: 'w', path: '/w', is_dir: true, children: [
        { name: 'aaa.md', path: '/w/aaa.md', is_dir: false },
        { name: 'chapters', path: '/w/chapters', is_dir: true, children: [] },
      ],
    };

    const chaptersKey = buildLocalTree(before)!.children![0].key;
    useExplorerExpansion.getState().toggle(chaptersKey);

    const rebuilt = buildLocalTree(after)!;
    const chaptersAfter = rebuilt.children!.find(child => child.name === 'chapters')!;

    expect(chaptersAfter.key).toBe(chaptersKey);
    expect(useExplorerExpansion.getState().expanded.has(chaptersAfter.key)).toBe(true);
  });

  it('toggles a key on and off', () => {
    const { toggle } = useExplorerExpansion.getState();
    toggle('local:/w/a');
    expect(useExplorerExpansion.getState().isExpanded('local:/w/a')).toBe(true);
    toggle('local:/w/a');
    expect(useExplorerExpansion.getState().isExpanded('local:/w/a')).toBe(false);
  });

  it('leaves state identical when expanding an already-expanded key', () => {
    const { expand } = useExplorerExpansion.getState();
    expand('k');
    const first = useExplorerExpansion.getState().expanded;
    expand('k');
    expect(useExplorerExpansion.getState().expanded).toBe(first);
  });

  it('adds every ancestor at once when revealing a node', () => {
    useExplorerExpansion.getState().expandAll(['a', 'b', 'c']);
    const { expanded } = useExplorerExpansion.getState();
    expect([...expanded].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('ancestor keys', () => {
  it('walks from the workspace root down to the file folder', () => {
    expect(localAncestorKeys('/w', '/w/part1/chapter/one.md')).toEqual([
      localNodeKey('/w'),
      localNodeKey('/w/part1'),
      localNodeKey('/w/part1/chapter'),
    ]);
  });

  it('returns just the root for a top-level file', () => {
    expect(localAncestorKeys('/w', '/w/one.md')).toEqual([localNodeKey('/w')]);
  });

  it('returns nothing for a file outside the workspace', () => {
    expect(localAncestorKeys('/w', '/elsewhere/one.md')).toEqual([]);
  });

  it('walks cloud paths the same way', () => {
    expect(cloudAncestorKeys('part1/chapter/intro')).toEqual([
      cloudDirKey(''),
      cloudDirKey('part1'),
      cloudDirKey('part1/chapter'),
    ]);
  });

  it('returns the cloud root for a top-level document', () => {
    expect(cloudAncestorKeys('intro')).toEqual([cloudDirKey('')]);
  });
});
