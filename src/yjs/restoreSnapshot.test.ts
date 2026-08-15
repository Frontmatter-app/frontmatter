import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { restoreSnapshot } from './restoreSnapshot';

function snapshotOf(text: string, draft = ''): Uint8Array {
  const doc = new Y.Doc();
  doc.getText('markdown').insert(0, text);
  if (draft) doc.getText('draft').insert(0, draft);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe('restoreSnapshot', () => {
  it('removes text added after the snapshot', () => {
    // The bug: `Y.applyUpdate` only ever adds information, so restoring left
    // every later addition in place and the document could only grow.
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'original');
    const snapshot = Y.encodeStateAsUpdate(doc);

    doc.getText('markdown').insert(8, ' plus more');
    expect(doc.getText('markdown').toString()).toBe('original plus more');

    restoreSnapshot(doc, snapshot);

    expect(doc.getText('markdown').toString()).toBe('original');
  });

  it('does not resurrect text deleted after the snapshot', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'keep me delete me');
    const snapshot = Y.encodeStateAsUpdate(doc);

    doc.getText('markdown').delete(0, 8);
    restoreSnapshot(doc, snapshot);

    // Restoring to a snapshot that *did* contain the text should bring it back
    // exactly once, not merge two copies.
    expect(doc.getText('markdown').toString()).toBe('keep me delete me');
  });

  it('restores to precisely the snapshot text', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'completely different current text');

    restoreSnapshot(doc, snapshotOf('the snapshot text'));

    expect(doc.getText('markdown').toString()).toBe('the snapshot text');
  });

  it('leaves the draft alone when the snapshot has none', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'prose');
    doc.getText('draft').insert(0, 'my outline');

    restoreSnapshot(doc, snapshotOf('older prose'));

    expect(doc.getText('markdown').toString()).toBe('older prose');
    expect(doc.getText('draft').toString()).toBe('my outline');
  });

  it('restores the draft when the snapshot carried one', () => {
    const doc = new Y.Doc();
    doc.getText('draft').insert(0, 'current outline');

    restoreSnapshot(doc, snapshotOf('prose', 'older outline'));

    expect(doc.getText('draft').toString()).toBe('older outline');
  });

  it('tags the transaction so callers can filter it', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'a');

    const origins: unknown[] = [];
    doc.on('afterTransaction', (tx: Y.Transaction) => origins.push(tx.origin));

    restoreSnapshot(doc, snapshotOf('b'), 'my-origin');

    expect(origins).toContain('my-origin');
  });

  it('is a no-op when the document already matches', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'same');

    let changes = 0;
    doc.getText('markdown').observe(() => changes++);

    restoreSnapshot(doc, snapshotOf('same'));

    expect(changes).toBe(0);
    expect(doc.getText('markdown').toString()).toBe('same');
  });

  it('leaves the restore visible to collaborators as an ordinary edit', () => {
    // Restoring must merge, not fork: a peer applying the resulting update
    // should land on the same text.
    const local = new Y.Doc();
    local.getText('markdown').insert(0, 'shared start');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    restoreSnapshot(local, snapshotOf('restored text'));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local, Y.encodeStateVector(remote)));

    expect(remote.getText('markdown').toString()).toBe('restored text');
    expect(remote.getText('markdown').toString()).toBe(local.getText('markdown').toString());
  });
});
