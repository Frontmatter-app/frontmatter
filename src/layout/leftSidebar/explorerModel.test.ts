import { describe, expect, it } from 'vitest';
import {
  buildCloudTree,
  buildLocalTree,
  cloudParentPath,
  isDescendantPath,
  joinCloudPath,
  stripMarkdownExtension,
  walkTree,
  type ExplorerNode,
} from './explorerModel';
import type { CloudFolderMeta, DocumentMeta } from '../../types';
import type { FileNode } from '../../workspace/workspaceTypes';

const doc = (id: string, cloudPath: string, extra: Partial<DocumentMeta> = {}): DocumentMeta => ({
  id,
  title: cloudPath.split('/').pop() || id,
  content: '',
  stage: 'write',
  focus_mode: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  word_count: 0,
  cloud_path: cloudPath,
  is_cloud: true,
  ...extra,
});

const folder = (path: string): CloudFolderMeta => ({
  id: `team:${path}`,
  ownerId: 'u1',
  teamId: 'team',
  path,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const names = (node: ExplorerNode | null) => (node?.children ?? []).map(child => child.name);

const find = (root: ExplorerNode, name: string): ExplorerNode | undefined => {
  let found: ExplorerNode | undefined;
  walkTree(root, node => { if (!found && node.name === name) found = node; });
  return found;
};

describe('buildLocalTree', () => {
  const tree: FileNode = {
    name: 'workspace',
    path: '/w',
    is_dir: true,
    children: [
      { name: 'b.md', path: '/w/b.md', is_dir: false },
      { name: 'chapters', path: '/w/chapters', is_dir: true, children: [
        { name: 'one.md', path: '/w/chapters/one.md', is_dir: false },
      ] },
      { name: 'a.md', path: '/w/a.md', is_dir: false },
    ],
  };

  it('keys nodes by path rather than sibling position', () => {
    const built = buildLocalTree(tree)!;
    expect(built.key).toBe('local:/w');
    expect(find(built, 'one.md')!.key).toBe('local:/w/chapters/one.md');
  });

  it('puts directories first, then sorts by name', () => {
    expect(names(buildLocalTree(tree))).toEqual(['chapters', 'a.md', 'b.md']);
  });

  it('marks files that are mirrored to the cloud', () => {
    const built = buildLocalTree(tree, new Set(['/w/a.md']))!;
    expect(find(built, 'a.md')!.syncedToCloud).toBe(true);
    expect(find(built, 'b.md')!.syncedToCloud).toBe(false);
  });

  it('returns null without a directory tree', () => {
    expect(buildLocalTree(null)).toBeNull();
  });
});

describe('buildCloudTree', () => {
  it('nests documents under the folders their paths imply', () => {
    const tree = buildCloudTree([doc('d1', 'chapter1/intro')], [], 'Team');
    const chapter = find(tree, 'chapter1')!;

    expect(chapter.isDir).toBe(true);
    expect(chapter.key).toBe('cloud:dir:chapter1');
    expect(names(chapter)).toEqual(['intro']);
    expect(find(tree, 'intro')!.docId).toBe('d1');
  });

  it('keeps empty folders that exist only as folder records', () => {
    const tree = buildCloudTree([], [folder('drafts')], 'Team');
    expect(names(tree)).toEqual(['drafts']);
  });

  it('shows both documents when two share a path, and marks them apart', () => {
    // Cloud paths carry no uniqueness constraint, so two people can create the
    // same one. Hiding either would lose a document.
    const tree = buildCloudTree(
      [doc('aaaaaa11', 'chapter1/intro'), doc('bbbbbb22', 'chapter1/intro')],
      [],
      'Team',
    );
    const chapter = find(tree, 'chapter1')!;

    expect(chapter.children).toHaveLength(2);
    expect(names(chapter).sort()).toEqual(['intro · aaaaaa', 'intro · bbbbbb']);
  });

  it('leaves a unique name untouched', () => {
    const tree = buildCloudTree([doc('d1', 'notes')], [], 'Team');
    expect(names(tree)).toEqual(['notes']);
  });

  it('falls back to the title when a document has no path', () => {
    const tree = buildCloudTree([doc('d1', '', { title: 'Untitled Draft' })], [], 'Team');
    expect(names(tree)).toEqual(['Untitled Draft']);
  });

  it('reuses one folder node for documents that share a prefix', () => {
    const tree = buildCloudTree(
      [doc('d1', 'part1/a'), doc('d2', 'part1/b')],
      [folder('part1')],
      'Team',
    );
    expect(names(tree)).toEqual(['part1']);
    expect(names(find(tree, 'part1')!)).toEqual(['a', 'b']);
  });

  it('carries the offline flag onto the node', () => {
    const tree = buildCloudTree([doc('d1', 'notes', { offline_enabled: true })], [], 'Team');
    expect(find(tree, 'notes')!.offlineEnabled).toBe(true);
  });
});

describe('path helpers', () => {
  it('finds a cloud path parent', () => {
    expect(cloudParentPath('a/b/c')).toBe('a/b');
    expect(cloudParentPath('a')).toBe('');
  });

  it('joins and normalises cloud paths', () => {
    expect(joinCloudPath('a', 'b')).toBe('a/b');
    expect(joinCloudPath('', 'b')).toBe('b');
    expect(joinCloudPath('a/', '/b')).toBe('a/b');
  });

  it('strips a markdown extension', () => {
    expect(stripMarkdownExtension('notes.md')).toBe('notes');
    expect(stripMarkdownExtension('notes.MD')).toBe('notes');
    expect(stripMarkdownExtension('notes')).toBe('notes');
  });

  it('recognises descendants without matching sibling prefixes', () => {
    expect(isDescendantPath('a', 'a/b')).toBe(true);
    expect(isDescendantPath('a', 'a')).toBe(true);
    // "ab" must not count as inside "a".
    expect(isDescendantPath('a', 'ab')).toBe(false);
    expect(isDescendantPath('', 'anything')).toBe(true);
  });
});
