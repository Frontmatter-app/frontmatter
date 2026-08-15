import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const invoke = vi.fn().mockResolvedValue([]);
vi.mock('../filesystem/tauriCommands', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { SuggestionManager, type Suggestion } from './suggestions';
import { toAbsolute } from './relativePositions';

function docWithText(text: string) {
  const doc = new Y.Doc();
  doc.getText('markdown').insert(0, text);
  return doc;
}

function anchor(doc: Y.Doc, index: number) {
  return Y.createRelativePositionFromTypeIndex(doc.getText('markdown'), index);
}

/**
 * The outcome rules from `useReviewState.settleSuggestion`, exercised against a
 * real document. Accepting a delete removes the text; rejecting an insert
 * removes it again; the other two outcomes leave the document alone.
 */
function settle(doc: Y.Doc, sug: Suggestion, outcome: 'accepted' | 'rejected') {
  const removesText = outcome === 'accepted' ? sug.type === 'delete' : sug.type === 'insert';
  if (!removesText) return;
  const startAbs = toAbsolute(sug.start_pos, doc);
  const endAbs = toAbsolute(sug.end_pos, doc);
  if (startAbs && endAbs && startAbs.index < endAbs.index) {
    const ytext = doc.getText('markdown');
    doc.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
  }
}

beforeEach(() => {
  invoke.mockClear();
  invoke.mockResolvedValue([]);
});

describe('settling a suggestion', () => {
  it('removes the text when a delete is accepted', () => {
    const doc = docWithText('hello cruel world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('s1', 'author', 'delete', anchor(doc, 6), anchor(doc, 12), 'cruel ');

    const sug = manager.getSuggestions()[0];
    settle(doc, sug, 'accepted');
    manager.resolveSuggestion('s1', 'accepted');

    expect(doc.getText('markdown').toString()).toBe('hello world');
    expect(manager.getSuggestions()[0].resolved).toBe(true);
  });

  it('leaves the text alone when a delete is rejected', () => {
    const doc = docWithText('hello cruel world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('s1', 'author', 'delete', anchor(doc, 6), anchor(doc, 12), 'cruel ');

    settle(doc, manager.getSuggestions()[0], 'rejected');

    expect(doc.getText('markdown').toString()).toBe('hello cruel world');
  });

  it('removes the text when an insert is rejected', () => {
    const doc = docWithText('hello cruel world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('s1', 'author', 'insert', anchor(doc, 6), anchor(doc, 12), 'cruel ');

    settle(doc, manager.getSuggestions()[0], 'rejected');

    expect(doc.getText('markdown').toString()).toBe('hello world');
  });

  it('leaves the text alone when an insert is accepted', () => {
    // It is already in the document — applying it again would delete it.
    const doc = docWithText('hello cruel world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('s1', 'author', 'insert', anchor(doc, 6), anchor(doc, 12), 'cruel ');

    settle(doc, manager.getSuggestions()[0], 'accepted');

    expect(doc.getText('markdown').toString()).toBe('hello cruel world');
  });

  it('does nothing when the anchors have collapsed', () => {
    // The annotated text was deleted while the card was on screen.
    const doc = docWithText('hello cruel world');
    const manager = new SuggestionManager(doc, 'doc1');
    manager.addSuggestion('s1', 'author', 'delete', anchor(doc, 6), anchor(doc, 12), 'cruel ');
    doc.getText('markdown').delete(6, 6);

    expect(() => settle(doc, manager.getSuggestions()[0], 'accepted')).not.toThrow();
    expect(doc.getText('markdown').toString()).toBe('hello world');
  });
});
