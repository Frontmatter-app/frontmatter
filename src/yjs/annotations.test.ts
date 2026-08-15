import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const invoke = vi.fn().mockResolvedValue([]);
vi.mock('../filesystem/tauriCommands', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { AnnotationManager } from './annotations';
import { SuggestionManager } from './suggestions';

function docWithText(text: string) {
  const doc = new Y.Doc();
  doc.getText('markdown').insert(0, text);
  return doc;
}

function anchor(doc: Y.Doc, index: number) {
  return Y.createRelativePositionFromTypeIndex(doc.getText('markdown'), index);
}

/** Two peers sharing a document, as they would through the sync server. */
function pair(text: string) {
  const a = docWithText(text);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const merge = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, merge };
}

beforeEach(() => {
  invoke.mockClear();
  invoke.mockResolvedValue([]);
});

describe('AnnotationManager', () => {
  it('keeps both replies when two people answer at once', async () => {
    // Replies were a plain array rewritten whole on every change, so whichever
    // write landed second silently discarded the other.
    const { a, b, merge } = pair('some text');
    const peerA = new AnnotationManager(a, 'doc1');
    peerA.addAnnotation('ann1', 'doc1', 'author', anchor(a, 0), anchor(a, 4), 'some', 'note');
    merge();

    const peerB = new AnnotationManager(b, 'doc1');
    peerA.addReply('ann1', 'from A', 'userA');
    peerB.addReply('ann1', 'from B', 'userB');
    merge();

    const texts = peerA.getAnnotations()[0].replies.map((r) => r.text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain('from A');
    expect(texts).toContain('from B');
  });

  it('does not lose a reply to a concurrent resolve', async () => {
    const { a, b, merge } = pair('some text');
    const peerA = new AnnotationManager(a, 'doc1');
    peerA.addAnnotation('ann1', 'doc1', 'author', anchor(a, 0), anchor(a, 4), 'some', 'note');
    merge();
    const peerB = new AnnotationManager(b, 'doc1');

    peerA.resolveAnnotation('ann1');
    peerB.addReply('ann1', 'wait, one thing', 'userB');
    merge();

    const annotation = peerA.getAnnotations()[0];
    expect(annotation.resolved).toBe(true);
    expect(annotation.replies.map((r) => r.text)).toContain('wait, one thing');
  });

  it('persists the reply thread so it survives a reload', () => {
    // Replies used to live only in the Yjs document. The `annotations` table
    // had no column for them, nothing ever wrote one, and `loadInitial` read a
    // field that was always undefined — so closing a local document without
    // typing afterwards discarded every reply on it.
    const doc = docWithText('some text');
    const manager = new AnnotationManager(doc, 'doc1');
    manager.addAnnotation('ann1', 'doc1', 'author', anchor(doc, 0), anchor(doc, 4), 'some', 'note');
    manager.addReply('ann1', 'a reply', 'userB');

    const call = invoke.mock.calls.find(([command]) => command === 'save_annotation_replies');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ id: 'ann1' });
    expect(JSON.parse((call![1] as { replies: string }).replies)).toMatchObject([
      { text: 'a reply', author_id: 'userB' },
    ]);
  });

  it('reads a persisted reply thread back on load', async () => {
    invoke.mockResolvedValue([
      {
        id: 'ann1',
        document_id: 'doc1',
        author_id: 'author',
        start_pos: '',
        end_pos: '',
        selected_text: 'some',
        note: 'note',
        resolved: 0,
        created_at: new Date().toISOString(),
        replies: JSON.stringify([
          { id: 'r1', author_id: 'userB', text: 'a reply', created_at: new Date().toISOString() },
        ]),
      },
    ]);

    const doc = docWithText('some text');
    const manager = new AnnotationManager(doc, 'doc1');
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getAnnotations()[0].replies.map((r) => r.text)).toEqual(['a reply']);
  });

  it('exposes anchors that resolve to the annotated range', () => {
    const doc = docWithText('Hello world');
    const manager = new AnnotationManager(doc, 'doc1');
    manager.addAnnotation('ann1', 'doc1', 'author', anchor(doc, 6), anchor(doc, 11), 'world', 'note');

    const annotation = manager.getAnnotations()[0];
    expect(Y.createAbsolutePositionFromRelativePosition(annotation.start_pos!, doc)?.index).toBe(6);
    expect(Y.createAbsolutePositionFromRelativePosition(annotation.end_pos!, doc)?.index).toBe(11);
  });

  it('propagates a whole annotation to the other peer', () => {
    const { a, b, merge } = pair('Hello world');
    const peerA = new AnnotationManager(a, 'doc1');
    peerA.addAnnotation('ann1', 'doc1', 'author', anchor(a, 0), anchor(a, 5), 'Hello', 'my note');
    merge();

    const seen = new AnnotationManager(b, 'doc1').getAnnotations();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 'ann1', note: 'my note', selected_text: 'Hello' });
  });

  it('does not overwrite a shared annotation when hydrating from local storage', async () => {
    // Local rows are stale by definition: another person may have resolved or
    // replied since. Re-adding them would undo that.
    const doc = docWithText('text');
    const first = new AnnotationManager(doc, 'doc1');
    first.addAnnotation('ann1', 'doc1', 'author', anchor(doc, 0), anchor(doc, 4), 'text', 'note');
    first.addReply('ann1', 'a reply', 'userB');

    invoke.mockResolvedValue([
      {
        id: 'ann1',
        document_id: 'doc1',
        author_id: 'author',
        start_pos: 'unused',
        end_pos: 'unused',
        selected_text: 'text',
        note: 'note',
        resolved: 0,
        created_at: new Date().toISOString(),
        replies: null,
      },
    ]);

    const second = new AnnotationManager(doc, 'doc1');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    expect(second.getAnnotations()[0].replies).toHaveLength(1);
  });
});

describe('SuggestionManager', () => {
  it('keeps both replies when two people answer at once', () => {
    const { a, b, merge } = pair('some text');
    const peerA = new SuggestionManager(a, 'doc1');
    peerA.addSuggestion('sug1', 'author', 'insert', anchor(a, 0), anchor(a, 4), 'some');
    merge();
    const peerB = new SuggestionManager(b, 'doc1');

    peerA.addReply('sug1', 'from A', 'userA');
    peerB.addReply('sug1', 'from B', 'userB');
    merge();

    expect(peerA.getSuggestions()[0].replies).toHaveLength(2);
  });

  it('applies a partial update without clearing the replies', () => {
    const doc = docWithText('some text');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('sug1', 'author', 'insert', anchor(doc, 0), anchor(doc, 4), 'some');
    manager.addReply('sug1', 'a reply', 'userB');

    manager.updateSuggestion('sug1', { text: 'edited' });

    const suggestion = manager.getSuggestions()[0];
    expect(suggestion.text).toBe('edited');
    expect(suggestion.replies).toHaveLength(1);
  });

  it('records accept and reject decisions', () => {
    const doc = docWithText('some text');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('sug1', 'author', 'insert', anchor(doc, 0), anchor(doc, 4), 'some');

    manager.resolveSuggestion('sug1', 'accepted');

    expect(manager.getSuggestions()[0]).toMatchObject({ resolved: true, status: 'accepted' });
  });

  it('exposes anchors that resolve to the suggested range', () => {
    const doc = docWithText('Hello world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('sug1', 'author', 'delete', anchor(doc, 6), anchor(doc, 11), 'world');

    const suggestion = manager.getSuggestions()[0];
    expect(Y.createAbsolutePositionFromRelativePosition(suggestion.start_pos!, doc)?.index).toBe(6);
  });
});
