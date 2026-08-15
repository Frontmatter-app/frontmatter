import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnchorIndex } from './anchorIndex';

function doc(text: string) {
  const ydoc = new Y.Doc();
  ydoc.getText('markdown').insert(0, text);
  return ydoc;
}

function item(ydoc: Y.Doc, id: string, from: number, to: number, resolved = false) {
  const ytext = ydoc.getText('markdown');
  return {
    id,
    start_pos: Y.createRelativePositionFromTypeIndex(ytext, from),
    end_pos: Y.createRelativePositionFromTypeIndex(ytext, to),
    resolved,
  };
}

describe('AnchorIndex', () => {
  it('finds the range covering a position', () => {
    const ydoc = doc('hello world foo bar');
    const index = new AnchorIndex([item(ydoc, 'a', 6, 11), item(ydoc, 'b', 12, 15)], ydoc);

    expect(index.at(8)).toBe('a');
    expect(index.at(13)).toBe('b');
  });

  it('includes both endpoints', () => {
    const ydoc = doc('hello world');
    const index = new AnchorIndex([item(ydoc, 'a', 6, 11)], ydoc);

    expect(index.at(6)).toBe('a');
    expect(index.at(11)).toBe('a');
  });

  it('returns null outside every range', () => {
    const ydoc = doc('hello world foo');
    const index = new AnchorIndex([item(ydoc, 'a', 6, 11)], ydoc);

    expect(index.at(0)).toBeNull();
    expect(index.at(5)).toBeNull();
    expect(index.at(14)).toBeNull();
  });

  it('finds an enclosing range that starts well before the position', () => {
    // The walk back has to survive a short range sitting inside a long one.
    const ydoc = doc('x'.repeat(200));
    const index = new AnchorIndex(
      [item(ydoc, 'outer', 0, 190), item(ydoc, 'inner', 100, 110)],
      ydoc,
    );

    expect(index.at(105)).toBe('inner');
    expect(index.at(150)).toBe('outer');
    expect(index.at(195)).toBeNull();
  });

  it('skips resolved items', () => {
    const ydoc = doc('hello world');
    const index = new AnchorIndex([item(ydoc, 'a', 6, 11, true)], ydoc);

    expect(index.size).toBe(0);
    expect(index.at(8)).toBeNull();
  });

  it('skips items whose anchors cannot be decoded', () => {
    const ydoc = doc('hello world');
    const index = new AnchorIndex(
      [{ id: 'a', start_pos: null, end_pos: null, resolved: false }, item(ydoc, 'b', 6, 11)],
      ydoc,
    );

    expect(index.size).toBe(1);
    expect(index.at(8)).toBe('b');
  });

  it('tracks the text as the document changes around it', () => {
    const ydoc = doc('hello world');
    const index0 = new AnchorIndex([item(ydoc, 'a', 6, 11)], ydoc);
    expect(index0.at(8)).toBe('a');

    const anchored = [item(ydoc, 'a', 6, 11)];
    ydoc.getText('markdown').insert(0, 'oh, ');
    const index1 = new AnchorIndex(anchored, ydoc);

    // "world" is now at 10..15.
    expect(index1.at(12)).toBe('a');
    expect(index1.at(8)).toBeNull();
  });

  it('is empty for an empty list', () => {
    const ydoc = doc('hello');
    expect(new AnchorIndex([], ydoc).at(2)).toBeNull();
  });
});
