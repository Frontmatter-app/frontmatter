import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { encodeRelativePosition, decodeRelativePosition, toAbsolute } from './relativePositions';

function docWith(text: string) {
  const doc = new Y.Doc();
  doc.getText('markdown').insert(0, text);
  return doc;
}

describe('relative position encoding', () => {
  it('survives a round trip through storage', () => {
    const doc = docWith('Hello world');
    const ytext = doc.getText('markdown');
    const position = Y.createRelativePositionFromTypeIndex(ytext, 6);

    const restored = decodeRelativePosition(encodeRelativePosition(position));

    expect(toAbsolute(restored, doc)?.index).toBe(6);
  });

  it('still points at the same text after an edit before it', () => {
    // The whole reason anchors are relative: an insertion earlier in the
    // document must move them.
    const doc = docWith('Hello world');
    const ytext = doc.getText('markdown');
    const encoded = encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, 6));

    ytext.insert(0, '>> ');

    expect(toAbsolute(decodeRelativePosition(encoded), doc)?.index).toBe(9);
  });

  it('survives transport to another peer', () => {
    // This is what broke: handing the position object to `Y.Map.set` kept its
    // shape but lost the `Y.ID` classes inside, so the anchor was unresolvable
    // on the far side — and after any reload.
    const local = docWith('shared text');
    const encoded = encodeRelativePosition(
      Y.createRelativePositionFromTypeIndex(local.getText('markdown'), 7),
    );

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    expect(toAbsolute(decodeRelativePosition(encoded), remote)?.index).toBe(7);
  });

  it('returns null for the legacy plain-object form rather than throwing', () => {
    const doc = docWith('text');
    const legacy = JSON.stringify({ type: { client: 1, clock: 0 }, tname: null, item: null });

    expect(decodeRelativePosition(legacy)).toBeNull();
    expect(toAbsolute(decodeRelativePosition(legacy), doc)).toBeNull();
  });

  it('returns null for missing or malformed input', () => {
    expect(decodeRelativePosition(null)).toBeNull();
    expect(decodeRelativePosition(undefined)).toBeNull();
    expect(decodeRelativePosition('')).toBeNull();
    expect(decodeRelativePosition('not base64 !!')).toBeNull();
    expect(decodeRelativePosition(42)).toBeNull();
  });

  it('toAbsolute tolerates a null position or document', () => {
    // Yjs's own function throws on null, and strictNullChecks is off in this
    // project, so nothing would have caught it before it reached a user.
    const doc = docWith('text');
    expect(toAbsolute(null, doc)).toBeNull();
    expect(toAbsolute(undefined, doc)).toBeNull();
    expect(
      toAbsolute(Y.createRelativePositionFromTypeIndex(doc.getText('markdown'), 0), null),
    ).toBeNull();
  });
});
