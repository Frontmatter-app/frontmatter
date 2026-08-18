import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SEED_CLIENT_ID, deterministicSeed, seedIfEmpty } from './roomSeed';

const CHAPTER = '# Chapter one\n\nIt was a bright cold day in April.\n';

describe('determinism', () => {
  it('produces identical bytes on every machine', () => {
    // The property everything else rests on. Two clients building a seed from
    // the same committed text must produce the same update, or they are two
    // different authors writing the same words.
    expect(deterministicSeed(CHAPTER)).toEqual(deterministicSeed(CHAPTER));
  });

  it('produces different bytes for different text', () => {
    expect(deterministicSeed('one')).not.toEqual(deterministicSeed('two'));
  });

  it('writes under the reserved author id', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, deterministicSeed(CHAPTER));
    // A real client id is a random 32-bit integer, so seeded content stays
    // distinguishable from anything a person typed.
    expect([...Y.encodeStateVector(doc)].length).toBeGreaterThan(0);
    expect(doc.getText('markdown').toString()).toBe(CHAPTER);
    expect(new Y.Doc().clientID).not.toBe(SEED_CLIENT_ID);
  });
});

describe('two clients seeding the same cold room', () => {
  it('leaves one copy of the document, not two', () => {
    // The bug in full. Both peers hold the file from their own clone, both
    // arrive to an empty room, both seed. Without a fixed author id this ends
    // with the chapter in the room twice.
    const alice = new Y.Doc();
    const bob = new Y.Doc();

    seedIfEmpty(alice, CHAPTER);
    seedIfEmpty(bob, CHAPTER);

    // They sync with each other, as the room would.
    Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

    expect(alice.getText('markdown').toString()).toBe(CHAPTER);
    expect(bob.getText('markdown').toString()).toBe(CHAPTER);
  });

  it('converges even when the seeds arrive in different orders', () => {
    const room = new Y.Doc();
    const first = deterministicSeed(CHAPTER);
    const second = deterministicSeed(CHAPTER);

    Y.applyUpdate(room, second);
    Y.applyUpdate(room, first);
    Y.applyUpdate(room, second);

    expect(room.getText('markdown').toString()).toBe(CHAPTER);
  });

  it('survives a third peer arriving late with the same file', () => {
    const room = new Y.Doc();
    seedIfEmpty(room, CHAPTER);

    const latecomer = new Y.Doc();
    seedIfEmpty(latecomer, CHAPTER);
    Y.applyUpdate(room, Y.encodeStateAsUpdate(latecomer));

    expect(room.getText('markdown').toString()).toBe(CHAPTER);
  });
});

describe('seeding a room that is not empty', () => {
  it('does not seed over existing content', () => {
    const doc = new Y.Doc();
    doc.getText('markdown').insert(0, 'already here');

    expect(seedIfEmpty(doc, CHAPTER)).toBe(false);
    expect(doc.getText('markdown').toString()).toBe('already here');
  });

  it('does not seed an empty file', () => {
    const doc = new Y.Doc();
    expect(seedIfEmpty(doc, '')).toBe(false);
    expect(doc.getText('markdown').toString()).toBe('');
  });

  it('reports whether it seeded', () => {
    const doc = new Y.Doc();
    expect(seedIfEmpty(doc, CHAPTER)).toBe(true);
    expect(seedIfEmpty(doc, CHAPTER)).toBe(false);
  });
});

describe('editing after a seed', () => {
  it('keeps a real author distinct from the seed', () => {
    const doc = new Y.Doc();
    seedIfEmpty(doc, CHAPTER);
    doc.getText('markdown').insert(doc.getText('markdown').length, 'Added by a person.\n');

    expect(doc.getText('markdown').toString()).toBe(`${CHAPTER}Added by a person.\n`);
    expect(doc.clientID).not.toBe(SEED_CLIENT_ID);
  });

  it('merges two peers who edited after seeding independently', () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    seedIfEmpty(alice, CHAPTER);
    seedIfEmpty(bob, CHAPTER);

    alice.getText('markdown').insert(alice.getText('markdown').length, 'Alice was here.\n');
    bob.getText('markdown').insert(0, 'Bob was first.\n');

    Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

    const merged = alice.getText('markdown').toString();
    expect(merged).toBe(bob.getText('markdown').toString());
    expect(merged).toContain('Alice was here.');
    expect(merged).toContain('Bob was first.');
    // And exactly one copy of the chapter, despite two independent seeds.
    expect(merged.split('It was a bright cold day').length - 1).toBe(1);
  });
});

describe('other fields', () => {
  it('can seed a named field', () => {
    const doc = new Y.Doc();
    seedIfEmpty(doc, 'scene json', 'drawing');
    expect(doc.getText('drawing').toString()).toBe('scene json');
    expect(doc.getText('markdown').toString()).toBe('');
  });
});
