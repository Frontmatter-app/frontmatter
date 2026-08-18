/**
 * Binding an open document to its repository, through the registry.
 *
 * The pieces are tested on their own elsewhere. What is only visible here is
 * the lifecycle: a document is bound while it is open, the binding is the thing
 * that carries the base revision between commits, and closing the document
 * neither commits behind the user's back nor destroys the document out from
 * under a commit that is still running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const settings = { autoSave: false, autoSync: false, versionControl: { enabled: true, commitPolicy: 'explicit' as string } };

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../filesystem/tauriCommands', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../settings/settingsStore', () => ({ getSettings: () => settings }));
vi.mock('../billing/PlanProvider', () => ({
  usePlanStore: { getState: () => ({ activeContext: { type: 'personal' } }), subscribe: vi.fn() },
}));
vi.mock('../auth/session', () => ({ getCurrentUser: () => null }));
vi.mock('../cloud/syncStatusStore', () => ({
  useSyncStatusStore: { getState: () => ({ cloudDocumentIds: new Set<string>() }) },
}));
vi.mock('../collab/RoomProvider', () => ({ RoomProvider: class {} }));
vi.mock('../images/assetGc', () => ({ sweepLocalAssets: vi.fn(async () => ({ trashed: [] })) }));
vi.mock('./documentSync', () => ({
  loadDocData: vi.fn(async () => ({ data: { file_path: '/repo/notes.md' }, parsed: {} })),
  applyDocData: vi.fn(),
  saveToLocalDb: vi.fn(async () => {}),
  syncDraftNodesToDb: vi.fn(async () => {}),
  syncToCloud: vi.fn(async () => {}),
  buildDocSavePayload: vi.fn(),
}));

import { FakeForge } from '../forge/fake';
import { DocumentRegistry } from './DocumentRegistry';

const TARGET = { repo: 'acme/docs', branch: 'main', path: 'notes.md' };

async function openDocument(registry: DocumentRegistry, id = 'doc-1') {
  const doc = await registry.acquire(id);
  return doc;
}

beforeEach(() => {
  settings.versionControl.commitPolicy = 'explicit';
});

describe('binding', () => {
  it('adopts the committed revision without disturbing the open document', async () => {
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'committed\n' } });

    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'committed\nedited since\n');

    const bound = await registry.attachGitDocument('doc-1', forge, TARGET);

    expect(bound).not.toBeNull();
    expect(doc.getText('markdown').toString()).toBe('committed\nedited since\n');
    expect(bound!.base.text).toBe('committed\n');
  });

  it('reuses the binding, so the base survives a panel being collapsed', async () => {
    // The base is what makes a commit conflict-detecting. Rebuilding it per
    // render would be harmless; losing it would not be.
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'x\n' } });
    await openDocument(registry);

    const first = await registry.attachGitDocument('doc-1', forge, TARGET);
    const second = await registry.attachGitDocument('doc-1', forge, TARGET);

    expect(second).toBe(first);
  });

  it('rebinds when the branch changes underneath it', async () => {
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'x\n' } });
    forge.addRepo('acme/docs-other', 'draft', { 'notes.md': 'y\n' });
    await openDocument(registry);

    const first = await registry.attachGitDocument('doc-1', forge, TARGET);
    const second = await registry.attachGitDocument('doc-1', forge, {
      ...TARGET,
      repo: 'acme/docs-other',
      branch: 'draft',
    });

    expect(second).not.toBe(first);
    expect(second!.base.text).toBe('y\n');
  });

  it('does not bind a document that was never opened', async () => {
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs' });
    expect(await registry.attachGitDocument('never-opened', forge, TARGET)).toBeNull();
  });

  it('leaves the document usable when the repository cannot be read', async () => {
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'x\n' } });
    forge.getFile = async () => { throw new Error('offline'); };

    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'still typing');

    expect(await registry.attachGitDocument('doc-1', forge, TARGET)).toBeNull();
    expect(doc.getText('markdown').toString()).toBe('still typing');
  });
});

describe('committing on request', () => {
  it('writes the document and advances the base', async () => {
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nafter\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    const outcome = await registry.commitDocument('doc-1', 'Add a line');

    expect(outcome.status).toBe('committed');
    expect((await forge.getFile('acme/docs', 'notes.md'))?.text).toBe('before\nafter\n');
    expect(registry.getGitDocument('doc-1')!.base.text).toBe('before\nafter\n');
  });

  it('fails honestly when the document is not bound', async () => {
    const registry = new DocumentRegistry();
    await openDocument(registry);
    const outcome = await registry.commitDocument('doc-1', 'Save');
    expect(outcome.status).toBe('failed');
  });
});

describe('closing the document', () => {
  it('commits nothing under the default policy', async () => {
    // Explicit is the default precisely so that closing a tab never puts a
    // commit in somebody's repository.
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nuncommitted\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    registry.release('doc-1');
    await vi.waitFor(() => expect(registry.getGitDocument('doc-1')).toBeUndefined());

    expect(forge.commits).toHaveLength(0);
  });

  it('flushes once when the policy asks for it', async () => {
    settings.versionControl.commitPolicy = 'on-empty';
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nwritten in the room\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    registry.release('doc-1');

    await vi.waitFor(() => expect(forge.commits).toHaveLength(1));
    expect((await forge.getFile('acme/docs', 'notes.md'))?.text).toBe(
      'before\nwritten in the room\n',
    );
    // Named after the file, so a history of automatic commits still says which
    // document each one touched.
    expect(forge.commits[0].request.message).toContain('notes.md');
  });

  it('does not destroy the document until the final commit has finished', async () => {
    // The commit reads the text, and on a branch that moved it merges the
    // remote revision back in before writing. A destroyed Y.Doc supports
    // neither.
    settings.versionControl.commitPolicy = 'on-empty';
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nlocal\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    let destroyedDuringCommit = false;
    let released = false;
    doc.on('destroy', () => { destroyedDuringCommit = !released; });

    const original = forge.commit.bind(forge);
    forge.commit = async (repo, request) => {
      // Somebody else pushed while the room was closing.
      forge.advanceBranch('acme/docs', 'main', { 'notes.md': 'before\nremote\n' });
      forge.commit = original;
      return original(repo, request);
    };

    registry.release('doc-1');
    released = true;

    await vi.waitFor(() => expect(forge.commits.length).toBeGreaterThan(0));
    expect(destroyedDuringCommit).toBe(false);
    const committed = (await forge.getFile('acme/docs', 'notes.md'))!.text;
    expect(committed).toContain('local');
    expect(committed).toContain('remote');
  });

  it('waits for a commit the user asked for on the way out', async () => {
    // Pressing Commit and closing the document is one gesture as far as the
    // user is concerned. The write must not be cut off by the close, and the
    // close must not commit the same text a second time.
    settings.versionControl.commitPolicy = 'on-empty';
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nedited\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const original = forge.commit.bind(forge);
    forge.commit = async (repo, request) => { await held; return original(repo, request); };

    const commit = registry.commitDocument('doc-1', 'Save before closing');
    let destroyed = false;
    doc.on('destroy', () => { destroyed = true; });

    registry.release('doc-1');
    expect(destroyed).toBe(false);

    release();
    expect((await commit).status).toBe('committed');
    await vi.waitFor(() => expect(destroyed).toBe(true));
    expect(forge.commits).toHaveLength(1);
  });

  it('gives a reopened document a fresh binding rather than the closing one', async () => {
    settings.versionControl.commitPolicy = 'on-empty';
    const registry = new DocumentRegistry();
    const forge = new FakeForge({ repo: 'acme/docs', files: { 'notes.md': 'before\n' } });
    const doc = await openDocument(registry);
    doc.getText('markdown').insert(0, 'before\nedited\n');
    await registry.attachGitDocument('doc-1', forge, TARGET);

    registry.release('doc-1');
    const reopened = await registry.acquire('doc-1');

    expect(reopened).not.toBe(doc);
    expect(registry.getGitDocument('doc-1')).toBeUndefined();
  });
});
