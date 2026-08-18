import { describe, expect, it } from 'vitest';
import { repositoryRelativePath, resolveDocumentBinding } from './documentBinding';

const repository = {
  root: '/Users/ada/writing',
  remoteUrl: 'https://github.com/ada/writing.git',
  branch: 'main',
};

describe('resolving a binding', () => {
  it('addresses the document by its path within the repository', () => {
    const binding = resolveDocumentBinding(repository, '/Users/ada/writing/notes/today.md');
    expect(binding).toEqual({
      status: 'bound',
      target: { repo: 'ada/writing', branch: 'main', path: 'notes/today.md' },
      forge: expect.objectContaining({ kind: 'github', fullName: 'ada/writing' }),
    });
  });

  it('measures the path from the repository root, not the workspace folder', () => {
    // Opening a subfolder of a repository is ordinary. Measuring from the open
    // folder would commit `chapter.md` while the repository holds
    // `book/chapter.md` — a second file, silently, with no working tree to
    // catch it.
    const binding = resolveDocumentBinding(
      { ...repository, root: '/Users/ada/writing' },
      '/Users/ada/writing/book/chapter.md',
    );
    expect(binding).toMatchObject({ target: { path: 'book/chapter.md' } });
  });

  it('carries the checked-out branch rather than the default one', () => {
    const binding = resolveDocumentBinding(
      { ...repository, branch: 'draft/chapter-two' },
      '/Users/ada/writing/x.md',
    );
    expect(binding).toMatchObject({ target: { branch: 'draft/chapter-two' } });
  });

  it('handles an ssh remote', () => {
    const binding = resolveDocumentBinding(
      { ...repository, remoteUrl: 'git@github.com:ada/writing.git' },
      '/Users/ada/writing/x.md',
    );
    expect(binding).toMatchObject({ target: { repo: 'ada/writing' } });
  });
});

describe('documents that cannot be committed', () => {
  it('reports a folder that is not a repository', () => {
    expect(resolveDocumentBinding({ ...repository, root: null }, '/x/y.md')).toEqual({
      status: 'unbound',
      reason: 'no-repository',
    });
  });

  it('reports a cloud document, which has no file at all', () => {
    expect(resolveDocumentBinding(repository, null)).toEqual({
      status: 'unbound',
      reason: 'no-file',
    });
  });

  it('refuses a document outside the repository rather than guessing a path', () => {
    expect(resolveDocumentBinding(repository, '/Users/ada/elsewhere/notes.md')).toEqual({
      status: 'unbound',
      reason: 'outside-repository',
    });
  });

  it('reports a repository with no remote', () => {
    expect(resolveDocumentBinding({ ...repository, remoteUrl: '' }, '/Users/ada/writing/x.md'))
      .toEqual({ status: 'unbound', reason: 'no-remote' });
  });

  it('reports a remote on a host with no adapter', () => {
    expect(
      resolveDocumentBinding(
        { ...repository, remoteUrl: 'https://example.com/ada/writing.git' },
        '/Users/ada/writing/x.md',
      ),
    ).toEqual({ status: 'unbound', reason: 'unsupported-remote' });
  });

  it('refuses a detached HEAD', () => {
    // `rev-parse --abbrev-ref HEAD` returns the literal string, and committing
    // to a branch called "HEAD" would either fail or create one.
    expect(resolveDocumentBinding({ ...repository, branch: 'HEAD' }, '/Users/ada/writing/x.md'))
      .toEqual({ status: 'unbound', reason: 'detached-head' });
  });
});

describe('repository-relative paths', () => {
  it('strips the root', () => {
    expect(repositoryRelativePath('/repo', '/repo/a/b.md')).toBe('a/b.md');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(repositoryRelativePath('/repo/', '/repo/a.md')).toBe('a.md');
  });

  it('does not match a sibling folder with a shared prefix', () => {
    // The bug a bare `startsWith` produces: `/repo` matching `/repository`.
    expect(repositoryRelativePath('/repo', '/repository/a.md')).toBeNull();
  });

  it('rejects the root itself, which is a directory rather than a document', () => {
    expect(repositoryRelativePath('/repo', '/repo/')).toBeNull();
  });

  it('normalises windows separators to the ones git speaks', () => {
    expect(repositoryRelativePath('C:\\Users\\ada\\repo', 'C:\\Users\\ada\\repo\\a\\b.md')).toBe(
      'a/b.md',
    );
  });

  it('falls back to a case-insensitive match, since the two paths have different sources', () => {
    expect(repositoryRelativePath('/Users/Ada/Repo', '/users/ada/repo/a.md')).toBe('a.md');
  });

  it('rejects a path outside the root', () => {
    expect(repositoryRelativePath('/repo', '/elsewhere/a.md')).toBeNull();
  });
});
