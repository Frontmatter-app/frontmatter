import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { uint8ToBase64 } from '../lib/base64';

vi.mock('../filesystem/tauriCommands', () => ({ invoke: vi.fn() }));
vi.mock('../cloud/firestoreSync', () => ({
  pushCloudDocument: vi.fn(),
  fetchCloudDocument: vi.fn(),
}));
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }));

import { applyDocData, YJS_STATE_ORIGIN } from './documentSync';

const META = { focus_mode: false, stage: 'write', title: 'Doc' };

/** Exchanges updates both ways until both documents have seen everything. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('applyDocData bootstrap', () => {
  it('does not duplicate content when two peers open the same cloud document', () => {
    // The C4 regression. Both peers previously fell through to
    // `ytext.insert(0, markdown)` because the cloud copy carried no CRDT state,
    // each authoring its own structs for the same text. Once they exchanged
    // updates the document contained everything twice.
    const payload = { markdown: '# Chapter One\n\nIt was a quiet morning.', draft: '', yjs_state: '' };

    const peerA = new Y.Doc();
    const peerB = new Y.Doc();
    applyDocData(peerA, META, payload, { isCloud: true });
    applyDocData(peerB, META, payload, { isCloud: true });

    // The server seeds the room; here that is peer A receiving it first.
    const server = new Y.Doc();
    server.getText('markdown').insert(0, payload.markdown);
    Y.applyUpdate(peerA, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(server));

    sync(peerA, peerB);

    expect(peerA.getText('markdown').toString()).toBe(payload.markdown);
    expect(peerB.getText('markdown').toString()).toBe(payload.markdown);
    expect(peerA.getText('markdown').toString()).toBe(peerB.getText('markdown').toString());
  });

  it('converges when both peers edit concurrently', () => {
    const server = new Y.Doc();
    server.getText('markdown').insert(0, 'shared');
    const seed = Y.encodeStateAsUpdate(server);

    const peerA = new Y.Doc();
    const peerB = new Y.Doc();
    applyDocData(peerA, META, { markdown: 'shared', draft: '', yjs_state: '' }, { isCloud: true });
    applyDocData(peerB, META, { markdown: 'shared', draft: '', yjs_state: '' }, { isCloud: true });
    Y.applyUpdate(peerA, seed);
    Y.applyUpdate(peerB, seed);

    peerA.getText('markdown').insert(0, 'A: ');
    peerB.getText('markdown').insert(6, ' (B)');

    sync(peerA, peerB);

    const a = peerA.getText('markdown').toString();
    expect(a).toBe(peerB.getText('markdown').toString());
    expect(a).toContain('A: ');
    expect(a).toContain('(B)');
  });

  it('still seeds a local document from its markdown', () => {
    // Local documents have no server to seed them, so this path must remain.
    const doc = new Y.Doc();
    applyDocData(doc, META, { markdown: 'local notes', draft: 'outline', yjs_state: '' });

    expect(doc.getText('markdown').toString()).toBe('local notes');
    expect(doc.getText('draft').toString()).toBe('outline');
  });

  it('applies stored CRDT state in preference to the plaintext copy', () => {
    const source = new Y.Doc();
    source.getText('markdown').insert(0, 'from crdt');

    const doc = new Y.Doc();
    applyDocData(doc, META, {
      markdown: 'from plaintext',
      draft: '',
      yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(source)),
    });

    expect(doc.getText('markdown').toString()).toBe('from crdt');
  });

  it('never doubles the content, at any point of CRDT-state corruption', () => {
    // `Y.applyUpdate` integrates leading structs before throwing on a bad tail,
    // so a corrupt update could leave the document partly populated. Applying
    // straight to it and inserting the markdown in the catch then produced the
    // content twice. Sweeping every truncation point covers both the
    // fails-at-decode and fails-midway cases rather than assuming which occurs.
    const source = new Y.Doc();
    source.getText('markdown').insert(0, 'real content');
    const valid = Y.encodeStateAsUpdate(source);

    for (let cut = 1; cut < valid.length; cut++) {
      const doc = new Y.Doc();
      applyDocData(doc, META, {
        markdown: 'real content',
        draft: '',
        yjs_state: uint8ToBase64(valid.slice(0, cut)),
      });

      const text = doc.getText('markdown').toString();
      const occurrences = text.split('real content').length - 1;
      expect(occurrences, `truncated at ${cut} produced: ${JSON.stringify(text)}`).toBeLessThanOrEqual(1);
      doc.destroy();
    }
  });

  it('leaves a cloud document empty rather than seeding it locally', () => {
    const doc = new Y.Doc();
    applyDocData(doc, META, { markdown: 'server owns this', draft: '', yjs_state: '' }, { isCloud: true });

    expect(doc.getText('markdown').toString()).toBe('');
  });

  it('discards pre-sync-server cached state for cloud documents', () => {
    // Legacy local state has no history in common with the server's copy, so
    // merging the two would integrate both as separate content. Dropping it is
    // free — the server resends everything on connect.
    const legacy = new Y.Doc();
    legacy.getText('markdown').insert(0, 'legacy local copy');

    const doc = new Y.Doc();
    applyDocData(
      doc,
      META,
      {
        markdown: 'legacy local copy',
        draft: '',
        yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(legacy)),
        // no yjs_origin: written before the sync server existed
      },
      { isCloud: true },
    );

    expect(doc.getText('markdown').toString()).toBe('');
  });

  it('keeps cached state that shares history with the sync server', () => {
    const cached = new Y.Doc();
    cached.getText('markdown').insert(0, 'offline edit');

    const doc = new Y.Doc();
    applyDocData(
      doc,
      META,
      {
        markdown: 'offline edit',
        draft: '',
        yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(cached)),
        yjs_origin: YJS_STATE_ORIGIN,
      },
      { isCloud: true },
    );

    // Preserved so edits made offline survive to the next connection.
    expect(doc.getText('markdown').toString()).toBe('offline edit');
  });

  it('legacy cached state is still honoured for local documents', () => {
    const cached = new Y.Doc();
    cached.getText('markdown').insert(0, 'local only');

    const doc = new Y.Doc();
    applyDocData(doc, META, {
      markdown: 'local only',
      draft: '',
      yjs_state: uint8ToBase64(Y.encodeStateAsUpdate(cached)),
    });

    expect(doc.getText('markdown').toString()).toBe('local only');
  });

  it('carries metadata onto the document either way', () => {
    const doc = new Y.Doc();
    applyDocData(
      doc,
      { focus_mode: true, stage: 'revise', title: 'Titled', file_path: '/tmp/a.md' },
      { markdown: 'x', draft: '', yjs_state: '' },
    );

    expect(doc.getMap('meta').get('focus_mode')).toBe(true);
    expect(doc.getMap('meta').get('stage')).toBe('revise');
    expect(doc.getMap('meta').get('title')).toBe('Titled');
    expect(doc.getMap('meta').get('file_path')).toBe('/tmp/a.md');
  });
});
