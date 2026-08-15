import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn().mockResolvedValue('');
vi.mock('../filesystem/tauriCommands', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { showFileAtCommit, toRepoRelativePath } from './gitCommands';

describe('toRepoRelativePath', () => {
  it('strips the workspace prefix', () => {
    expect(toRepoRelativePath('/home/me/notes', '/home/me/notes/chapter.md')).toBe('chapter.md');
    expect(toRepoRelativePath('/home/me/notes', '/home/me/notes/a/b.md')).toBe('a/b.md');
  });

  it('tolerates a trailing slash on the workspace', () => {
    expect(toRepoRelativePath('/home/me/notes/', '/home/me/notes/chapter.md')).toBe('chapter.md');
  });

  it('leaves an already-relative path alone', () => {
    expect(toRepoRelativePath('/home/me/notes', 'chapter.md')).toBe('chapter.md');
  });

  it('leaves a path outside the workspace alone', () => {
    expect(toRepoRelativePath('/home/me/notes', '/elsewhere/chapter.md')).toBe('/elsewhere/chapter.md');
  });
});

describe('showFileAtCommit', () => {
  it('sends a repository-relative path', async () => {
    // `git show <commit>:<path>` fails on an absolute path. The history
    // dropdown passed one, so restoring from a commit silently did nothing.
    invoke.mockClear();
    await showFileAtCommit('/home/me/notes', 'abc123', '/home/me/notes/chapter.md');

    expect(invoke).toHaveBeenCalledWith('git_show_file', {
      path: '/home/me/notes',
      commit: 'abc123',
      filePath: 'chapter.md',
    });
  });
});
