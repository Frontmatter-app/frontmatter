import { describe, expect, it } from 'vitest';
import { decodeBase64, withCoAuthors } from './github';
import { FakeForge } from './fake';
import { ForgeConflictError } from './types';

describe('withCoAuthors', () => {
  it('leaves a message alone when there are no co-authors', () => {
    expect(withCoAuthors('Fix the thing')).toBe('Fix the thing');
  });

  it('appends trailers after a blank line, as git requires', () => {
    const result = withCoAuthors('Fix the thing', [{ name: 'Ada', email: 'ada@example.com' }]);
    expect(result).toBe('Fix the thing\n\nCo-authored-by: Ada <ada@example.com>\n');
  });

  it('keeps every distinct co-author', () => {
    const result = withCoAuthors('Write together', [
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Grace', email: 'grace@example.com' },
    ]);
    expect(result).toContain('Co-authored-by: Ada <ada@example.com>');
    expect(result).toContain('Co-authored-by: Grace <grace@example.com>');
  });

  it('does not repeat a co-author listed twice', () => {
    // A room that flushes repeatedly would otherwise accumulate duplicates.
    const result = withCoAuthors('Write together', [
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Ada', email: 'ada@example.com' },
    ]);
    expect(result.match(/Co-authored-by:/g)).toHaveLength(1);
  });

  it('does not re-add a trailer the message already carries', () => {
    const existing = 'Write together\n\nCo-authored-by: Ada <ada@example.com>\n';
    const result = withCoAuthors(existing, [{ name: 'Ada', email: 'ada@example.com' }]);
    expect(result.match(/Co-authored-by:/g)).toHaveLength(1);
  });
});

describe('decodeBase64', () => {
  it('decodes the line-wrapped base64 the contents API returns', () => {
    // GitHub wraps at 60 characters, so the whitespace must be tolerated.
    expect(decodeBase64('aGVsbG8g\nd29ybGQ=')).toBe('hello world');
  });

  it('returns empty for empty input', () => {
    expect(decodeBase64('')).toBe('');
    expect(decodeBase64('\n')).toBe('');
  });

  it('decodes UTF-8 rather than Latin-1', () => {
    // atob yields bytes; reading them as characters mangles anything non-ASCII.
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('café — 日本語')));
    expect(decodeBase64(encoded)).toBe('café — 日本語');
  });
});

describe('FakeForge', () => {
  it('reads a seeded file', async () => {
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'intro.md': '# Intro' } });
    const file = await forge.getFile('acme/docs', 'intro.md');
    expect(file?.text).toBe('# Intro');
  });

  it('resolves null for a file that is not there', async () => {
    const forge = new FakeForge({ repo: 'acme/docs' });
    expect(await forge.getFile('acme/docs', 'missing.md')).toBeNull();
  });

  it('commits a change and moves the branch', async () => {
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'intro.md': 'old' } });
    const before = await forge.getRef('acme/docs', 'main');

    const result = await forge.commit('acme/docs', {
      branch: 'main',
      message: 'Update intro',
      changes: [{ path: 'intro.md', content: 'new' }],
    });

    expect(result.sha).not.toBe(before);
    expect((await forge.getFile('acme/docs', 'intro.md'))?.text).toBe('new');
    expect(await forge.getRef('acme/docs', 'main')).toBe(result.sha);
  });

  it('deletes a file when content is null', async () => {
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'gone.md': 'x' } });
    await forge.commit('acme/docs', {
      branch: 'main',
      message: 'Remove',
      changes: [{ path: 'gone.md', content: null }],
    });
    expect(await forge.getFile('acme/docs', 'gone.md')).toBeNull();
  });

  it('commits several files as one commit', async () => {
    const forge = new FakeForge({ repo: 'acme/docs' });
    await forge.commit('acme/docs', {
      branch: 'main',
      message: 'Add two',
      changes: [
        { path: 'a.md', content: 'A' },
        { path: 'b.md', content: 'B' },
      ],
    });
    expect(forge.commits).toHaveLength(1);
    expect((await forge.getFile('acme/docs', 'a.md'))?.text).toBe('A');
    expect((await forge.getFile('acme/docs', 'b.md'))?.text).toBe('B');
  });

  it('accepts a commit whose expected head still matches', async () => {
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'intro.md': 'old' } });
    const head = (await forge.getRef('acme/docs', 'main'))!;

    await expect(
      forge.commit('acme/docs', {
        branch: 'main',
        message: 'Update',
        changes: [{ path: 'intro.md', content: 'new' }],
        expectedHeadSha: head,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a commit when the branch moved underneath it', async () => {
    // The case the whole abstraction exists for: somebody else pushed between
    // our read and our write. It must be detectable, not a silent overwrite.
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'intro.md': 'base' } });
    const staleHead = (await forge.getRef('acme/docs', 'main'))!;

    forge.advanceBranch('acme/docs', 'main', { 'intro.md': 'someone else wrote this' });

    await expect(
      forge.commit('acme/docs', {
        branch: 'main',
        message: 'Update',
        changes: [{ path: 'intro.md', content: 'my version' }],
        expectedHeadSha: staleHead,
      }),
    ).rejects.toBeInstanceOf(ForgeConflictError);

    // And the other writer's work is still there, unclobbered.
    expect((await forge.getFile('acme/docs', 'intro.md'))?.text).toBe('someone else wrote this');
  });

  it('reports the branch a file was read at, so a writer can detect movement', async () => {
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'intro.md': 'base' } });
    const file = await forge.getFile('acme/docs', 'intro.md');
    expect(file?.commitSha).toBe(await forge.getRef('acme/docs', 'main'));
  });

  it('lists the tree, filtered by path prefix', async () => {
    const forge = new FakeForge({
      repo: 'acme/docs',
      files: { 'docs/a.md': 'A', 'docs/b.md': 'B', 'README.md': 'R' },
    });
    const entries = await forge.listTree('acme/docs', { path: 'docs' });
    expect(entries.map((entry) => entry.path).sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('searches repositories by name', async () => {
    const forge = new FakeForge({ repo: 'acme/docs' });
    forge.addRepo('acme/website');
    expect((await forge.listRepos({ search: 'web' })).map((repo) => repo.fullName)).toEqual([
      'acme/website',
    ]);
  });
});
