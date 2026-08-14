import { describe, expect, it } from 'vitest';
import {
  batchReaderTokens,
  deriveReadableBy,
  readerTokens,
  READABLE_BY_BATCH_SIZE,
  UNRESTRICTED,
} from './readableBy';

describe('deriveReadableBy', () => {
  it('marks an unrestricted document with the sentinel', () => {
    expect(deriveReadableBy('owner-1', null).sort()).toEqual(['*', 'owner-1']);
    expect(deriveReadableBy('owner-1', []).sort()).toEqual(['*', 'owner-1']);
  });

  it('lists the permitted groups when restricted', () => {
    expect(deriveReadableBy('owner-1', ['editors', 'legal']).sort())
      .toEqual(['editors', 'legal', 'owner-1']);
  });

  it('drops the sentinel once a restriction exists', () => {
    expect(deriveReadableBy('owner-1', ['editors'])).not.toContain(UNRESTRICTED);
  });

  it('always keeps the owner, even when they are in no permitted group', () => {
    // Otherwise restricting a document to a group the owner is not in would
    // hide it from the person who created it.
    expect(deriveReadableBy('owner-1', ['legal'])).toContain('owner-1');
  });

  it('de-duplicates when the owner id also appears as a group', () => {
    expect(deriveReadableBy('dual', ['dual'])).toEqual(['dual']);
  });

  it('ignores empty group entries', () => {
    expect(deriveReadableBy('owner-1', ['', 'editors']).sort()).toEqual(['editors', 'owner-1']);
  });

  it('copes with a missing owner', () => {
    expect(deriveReadableBy(null, ['editors'])).toEqual(['editors']);
  });
});

describe('reader tokens', () => {
  it('matches an unrestricted document, own documents, and group documents', () => {
    const tokens = readerTokens('me', ['editors']);
    expect(tokens).toContain(UNRESTRICTED);
    expect(tokens).toContain('me');
    expect(tokens).toContain('editors');
  });

  it('reads a document shared with a group the user belongs to', () => {
    const stored = deriveReadableBy('someone-else', ['editors']);
    const tokens = readerTokens('me', ['editors']);
    expect(stored.some(value => tokens.includes(value))).toBe(true);
  });

  it('does not match a document restricted to a group the user is not in', () => {
    const stored = deriveReadableBy('someone-else', ['legal']);
    const tokens = readerTokens('me', ['editors']);
    expect(stored.some(value => tokens.includes(value))).toBe(false);
  });

  it('matches the owner of a restricted document', () => {
    const stored = deriveReadableBy('me', ['legal']);
    const tokens = readerTokens('me', []);
    expect(stored.some(value => tokens.includes(value))).toBe(true);
  });

  it('uses a single query for a typical member', () => {
    expect(batchReaderTokens('me', ['a', 'b', 'c'])).toHaveLength(1);
  });

  it('splits only when a member is in more groups than one query allows', () => {
    const many = Array.from({ length: READABLE_BY_BATCH_SIZE + 5 }, (_, i) => `g${i}`);
    const batches = batchReaderTokens('me', many);

    expect(batches).toHaveLength(2);
    // Every batch has to carry the sentinel and the user's own id, or the
    // second query would miss unrestricted documents.
    for (const batch of batches) {
      expect(batch).toContain(UNRESTRICTED);
      expect(batch).toContain('me');
      expect(batch.length).toBeLessThanOrEqual(30);
    }
    expect(batches.flat()).toEqual(expect.arrayContaining(many));
  });
});
