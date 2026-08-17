import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeForge } from '../forge/fake';
import { GitBackedDocument } from './gitBackedDocument';

function setup(files: Record<string, string> = {}) {
  const forge = new FakeForge({ repo: 'acme/docs', branch: 'main', files });
  const doc = new Y.Doc();
  const text = doc.getText('markdown');
  const document = new GitBackedDocument(
    forge,
    { repo: 'acme/docs', branch: 'main', path: 'notes.md' },
    text,
  );
  return { forge, doc, text, document };
}

describe('loading', () => {
  it('seeds an empty document from the branch', async () => {
    const { text, document } = setup({ 'notes.md': '# From the branch\n' });
    await document.load();
    expect(text.toString()).toBe('# From the branch\n');
    expect(document.base.text).toBe('# From the branch\n');
  });

  it('treats a file that does not exist yet as an empty base', async () => {
    const { text, document } = setup();
    await document.load();
    expect(text.toString()).toBe('');
    expect(document.base.commit).not.toBeNull();
  });

  it('records the commit the content was read at', async () => {
    const { forge, document } = setup({ 'notes.md': 'x' });
    await document.load();
    expect(document.base.commit).toBe(await forge.getRef('acme/docs', 'main'));
  });
});

describe('committing', () => {
  it('does nothing when the text has not changed', async () => {
    const { document } = setup({ 'notes.md': 'unchanged\n' });
    await document.load();
    expect(await document.commit({ message: 'noop' })).toEqual({ status: 'unchanged' });
  });

  it('commits an edit and advances the base', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'before\n' });
    await document.load();
    const beforeSha = document.base.commit;

    text.insert(text.length, 'after\n');
    const outcome = await document.commit({ message: 'Add a line' });

    expect(outcome.status).toBe('committed');
    expect(document.base.commit).not.toBe(beforeSha);
    expect(document.base.text).toBe('before\nafter\n');
    expect((await forge.getFile('acme/docs', 'notes.md'))?.text).toBe('before\nafter\n');
  });

  it('passes co-authors through to the commit', async () => {
    // A collaborative session produces one commit containing several people's
    // writing; attributing it solely to whoever flushed the room would be a
    // quiet lie about who wrote what.
    const { forge, text, document } = setup({ 'notes.md': 'base\n' });
    await document.load();
    text.insert(text.length, 'more\n');

    await document.commit({
      message: 'Write together',
      coAuthors: [{ name: 'Ada', email: 'ada@example.com' }],
    });

    expect(forge.commits[0].request.coAuthors).toEqual([
      { name: 'Ada', email: 'ada@example.com' },
    ]);
  });

  it('sends the base commit so the forge can detect a moved branch', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'base\n' });
    await document.load();
    const base = document.base.commit;
    text.insert(text.length, 'edit\n');

    await document.commit({ message: 'Edit' });

    expect(forge.commits[0].request.expectedHeadSha).toBe(base);
  });

  it('reports a non-conflict failure rather than throwing', async () => {
    const { text, document, forge } = setup({ 'notes.md': 'base\n' });
    await document.load();
    text.insert(text.length, 'edit\n');
    forge.commit = async () => {
      throw new Error('network down');
    };

    const outcome = await document.commit({ message: 'Edit' });
    expect(outcome.status).toBe('failed');
  });
});

describe('when the branch moved underneath the room', () => {
  it('keeps both sides and commits the merge', async () => {
    // The case the whole design exists for: somebody pushed while the room was
    // being edited. Neither their commit nor the local writing may be lost.
    const base = '# Notes\n\nIntro paragraph.\n\nClosing paragraph.\n';
    const { forge, text, document } = setup({ 'notes.md': base });
    await document.load();

    // Local edit, in the intro.
    const introAt = base.indexOf('Intro paragraph.') + 'Intro paragraph.'.length;
    text.insert(introAt, ' Extended locally.');

    // Someone else pushes an edit to the closing paragraph.
    forge.advanceBranch('acme/docs', 'main', {
      'notes.md': base.replace('Closing paragraph.', 'Closing paragraph, revised remotely.'),
    });

    const outcome = await document.commit({ message: 'Save' });

    expect(outcome.status).toBe('reconciled');
    const finalText = (await forge.getFile('acme/docs', 'notes.md'))!.text;
    expect(finalText).toContain('Extended locally.');
    expect(finalText).toContain('revised remotely');
    // The document itself converged on the same thing that was committed.
    expect(text.toString()).toBe(finalText);
  });

  it('does not clobber the other writer', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'line one\n' });
    await document.load();
    text.insert(text.length, 'local line\n');

    forge.advanceBranch('acme/docs', 'main', { 'notes.md': 'line one\nremote line\n' });
    await document.commit({ message: 'Save' });

    expect((await forge.getFile('acme/docs', 'notes.md'))!.text).toContain('remote line');
  });

  it('never writes a conflict marker into the repository', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'shared\n' });
    await document.load();
    text.delete(0, text.length);
    text.insert(0, 'local rewrote everything\n');

    forge.advanceBranch('acme/docs', 'main', { 'notes.md': 'remote rewrote everything\n' });
    await document.commit({ message: 'Save' });

    const committed = (await forge.getFile('acme/docs', 'notes.md'))!.text;
    expect(committed).not.toContain('<<<<<<<');
    expect(committed).not.toContain('=======');
  });

  it('retries when the branch moves again mid-merge', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'base\n' });
    await document.load();
    text.insert(text.length, 'local\n');

    // Move the branch once more the first time a commit is attempted, so the
    // first retry also hits a conflict.
    const original = forge.commit.bind(forge);
    let calls = 0;
    forge.commit = async (repo, request) => {
      calls += 1;
      if (calls === 1) {
        forge.advanceBranch('acme/docs', 'main', { 'notes.md': 'base\nfirst remote\n' });
      } else if (calls === 2) {
        forge.advanceBranch('acme/docs', 'main', { 'notes.md': 'base\nfirst remote\nsecond\n' });
      }
      return original(repo, request);
    };

    const outcome = await document.commit({ message: 'Save' });
    expect(calls).toBeGreaterThan(1);
    expect(['reconciled', 'failed']).toContain(outcome.status);
  });

  it('gives up rather than looping forever on a branch that never settles', async () => {
    const { forge, text, document } = setup({ 'notes.md': 'base\n' });
    await document.load();
    text.insert(text.length, 'local\n');

    let churn = 0;
    forge.commit = async () => {
      forge.advanceBranch('acme/docs', 'main', { 'notes.md': `base\nchurn ${churn++}\n` });
      const { ForgeConflictError } = await import('../forge/types');
      throw new ForgeConflictError('main', 'stale', 'moved');
    };

    const outcome = await document.commit({ message: 'Save' });
    expect(outcome.status).toBe('failed');
    // Bounded: three attempts, not an infinite retry against a busy branch.
    expect(churn).toBeLessThanOrEqual(3);
  });

  it('keeps local work when the file was deleted on the branch', async () => {
    // The two sides disagree about whether the document should exist. Keeping
    // the writing is the recoverable choice; deleting it is not.
    const { forge, text, document } = setup({ 'notes.md': 'original\n' });
    await document.load();
    text.insert(text.length, 'still being written\n');

    forge.advanceBranch('acme/docs', 'main', {});
    await forge.commit('acme/docs', {
      branch: 'main',
      message: 'Delete it',
      changes: [{ path: 'notes.md', content: null }],
    });

    await document.commit({ message: 'Save' });
    expect(text.toString()).toContain('still being written');
  });
});
