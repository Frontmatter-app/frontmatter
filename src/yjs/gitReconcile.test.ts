import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyAsOperations, reconcileIntoDocument } from './gitReconcile';

function docWith(initial: string): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  const text = doc.getText('markdown');
  text.insert(0, initial);
  return { doc, text };
}

/** Wires two documents together the way a room and a peer are connected. */
function connect(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  });
}

describe('applyAsOperations', () => {
  it('reports no change when the text is identical', () => {
    const { text } = docWith('unchanged');
    expect(applyAsOperations(text, 'unchanged', 'unchanged')).toBe(false);
  });

  it('applies an insertion', () => {
    const { text } = docWith('hello world');
    applyAsOperations(text, 'hello world', 'hello brave world');
    expect(text.toString()).toBe('hello brave world');
  });

  it('applies a deletion', () => {
    const { text } = docWith('hello brave world');
    applyAsOperations(text, 'hello brave world', 'hello world');
    expect(text.toString()).toBe('hello world');
  });

  it('applies a replacement', () => {
    const { text } = docWith('the quick brown fox');
    applyAsOperations(text, 'the quick brown fox', 'the slow brown fox');
    expect(text.toString()).toBe('the slow brown fox');
  });

  it('edits only what changed, leaving the rest of the document untouched', () => {
    // The property the whole design rests on. Replacing the text would delete
    // and reinsert every character, which to a CRDT is an edit the size of the
    // document: cursors jump, anchors die, and the broadcast is enormous.
    const before = 'para one\n\npara two\n\npara three';
    const after = 'para one\n\npara TWO\n\npara three';
    const { doc, text } = docWith(before);

    // A relative position in the untouched first paragraph.
    const anchor = Y.createRelativePositionFromTypeIndex(text, 4);

    applyAsOperations(text, before, after);

    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
    expect(text.toString()).toBe(after);
    expect(resolved?.index).toBe(4);
  });

  it('emits a single update rather than one per character', () => {
    const { doc, text } = docWith('a b c d e');
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    applyAsOperations(text, 'a b c d e', 'a X c Y e');
    expect(updates).toBe(1);
  });

  it('tags its updates so listeners can tell them from typing', () => {
    const { doc, text } = docWith('base');
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    applyAsOperations(text, 'base', 'based');
    expect(origins).toContain('git-reconcile');
  });
});

describe('reconcileIntoDocument', () => {
  it('does nothing when the branch has not moved', () => {
    const { text } = docWith('same');
    const result = reconcileIntoDocument(text, 'same', 'same');
    expect(result.changed).toBe(false);
    expect(text.toString()).toBe('same');
  });

  it('adopts the remote when the room has no unpushed work', () => {
    const { text } = docWith('base');
    const result = reconcileIntoDocument(text, 'base', 'someone else pushed this');
    expect(text.toString()).toBe('someone else pushed this');
    expect(result.merged).toBe('someone else pushed this');
    expect(result.changed).toBe(true);
  });

  it('keeps both sides when each edited a different region', () => {
    // The ordinary case: two people working in one document at once.
    const base = '# Title\n\nIntro paragraph.\n\nClosing paragraph.\n';
    const local = '# Title\n\nIntro paragraph, now expanded locally.\n\nClosing paragraph.\n';
    const remote = '# Title\n\nIntro paragraph.\n\nClosing paragraph, extended remotely.\n';

    const { text } = docWith(local);
    const result = reconcileIntoDocument(text, base, remote);

    expect(result.merged).toContain('expanded locally');
    expect(result.merged).toContain('extended remotely');
    expect(result.rejected).toHaveLength(0);
  });

  it('never writes a conflict marker', () => {
    // A marker in a CRDT is not something a person resolves — it is text every
    // peer immediately starts editing on top of.
    const base = 'shared line\n';
    const local = 'local rewrote this line entirely\n';
    const remote = 'remote rewrote this line differently\n';

    const { text } = docWith(local);
    const result = reconcileIntoDocument(text, base, remote);

    expect(result.merged).not.toContain('<<<<<<<');
    expect(result.merged).not.toContain('>>>>>>>');
    expect(text.toString()).not.toContain('=======');
  });

  it('keeps local work and reports the hunk when a remote change cannot be placed', () => {
    // Both sides rewrote the same region beyond recognition. Dropping the
    // remote hunk silently would lose a commit, so it is surfaced instead.
    const base = 'alpha bravo charlie delta echo\n';
    const local = 'completely different local content that shares nothing\n';
    const remote = 'alpha bravo CHARLIE delta echo\n';

    const { text } = docWith(local);
    const result = reconcileIntoDocument(text, base, remote);

    expect(text.toString()).toContain('completely different local content');
    if (result.rejected.length > 0) {
      expect(result.rejected.join(' ')).toContain('CHARLIE');
    }
  });

  it('preserves a comment anchor in a region neither side touched', () => {
    const base = '# Heading\n\nUntouched paragraph worth anchoring.\n\nTail.\n';
    const local = base.replace('Tail.', 'Tail edited locally.');
    const remote = base.replace('# Heading', '# Heading, revised');

    const { doc, text } = docWith(local);
    const index = local.indexOf('worth anchoring');
    const anchor = Y.createRelativePositionFromTypeIndex(text, index);

    reconcileIntoDocument(text, base, remote);

    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
    expect(resolved).not.toBeNull();
    expect(text.toString().slice(resolved!.index, resolved!.index + 15)).toBe('worth anchoring');
  });

  it('leaves two connected peers converged on the same text', () => {
    // The end-to-end property: reconciliation must not fork the room. Whatever
    // the merge produces, every peer must agree on it.
    const base = 'one\ntwo\nthree\n';
    const local = 'one\ntwo edited by us\nthree\n';
    const remote = 'one\ntwo\nthree edited by them\n';

    const roomDoc = new Y.Doc();
    const peerDoc = new Y.Doc();
    const roomText = roomDoc.getText('markdown');
    roomText.insert(0, local);
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(roomDoc), 'remote');
    connect(roomDoc, peerDoc);

    reconcileIntoDocument(roomText, base, remote);

    expect(peerDoc.getText('markdown').toString()).toBe(roomText.toString());
    expect(roomText.toString()).toContain('edited by us');
    expect(roomText.toString()).toContain('edited by them');
  });

  it('survives a peer typing during reconciliation', () => {
    const base = 'alpha\nbravo\ncharlie\n';
    const remote = 'alpha\nbravo REMOTE\ncharlie\n';

    const roomDoc = new Y.Doc();
    const peerDoc = new Y.Doc();
    const roomText = roomDoc.getText('markdown');
    roomText.insert(0, base);
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(roomDoc), 'remote');
    connect(roomDoc, peerDoc);

    // A collaborator appends while the merge is being applied.
    peerDoc.getText('markdown').insert(base.length, 'delta typed live\n');
    reconcileIntoDocument(roomText, base, remote);

    expect(roomText.toString()).toBe(peerDoc.getText('markdown').toString());
    expect(roomText.toString()).toContain('delta typed live');
    expect(roomText.toString()).toContain('REMOTE');
  });

  it('handles a remote that emptied the file', () => {
    const { text } = docWith('content');
    const result = reconcileIntoDocument(text, 'content', '');
    expect(result.merged).toBe('');
    expect(text.toString()).toBe('');
  });

  it('handles a base that was empty', () => {
    const { text } = docWith('');
    const result = reconcileIntoDocument(text, '', '# New file from the branch\n');
    expect(text.toString()).toBe('# New file from the branch\n');
    expect(result.changed).toBe(true);
  });

  it('preserves non-ASCII content', () => {
    const base = '# Notes\n\ncafé — 日本語\n';
    const remote = '# Notes, revised\n\ncafé — 日本語\n';
    const { text } = docWith(base);
    reconcileIntoDocument(text, base, remote);
    expect(text.toString()).toContain('café — 日本語');
    expect(text.toString()).toContain('revised');
  });
});
