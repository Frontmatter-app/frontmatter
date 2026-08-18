/**
 * Filling an empty room without filling it twice.
 *
 * The failure this exists to prevent is specific and unrecoverable. Two people
 * open a file whose room the server has never held. Each has the text locally —
 * from their own clone — and each syncs it up. A CRDT does not deduplicate text
 * by reading it: every character one client inserts is a distinct item,
 * identified by *who* authored it and when. Two clients inserting the same
 * paragraph author two paragraphs, and the room converges on both, one after
 * the other. Nobody typed anything wrong, and the document is now doubled.
 *
 * The fix is to make the two clients author the *same* items. Yjs identifies an
 * item by `(clientID, clock)`, so a document built with a fixed clientID from
 * fixed content produces byte-identical updates on every machine that builds
 * it. Applying the same update twice is a no-op. The seed stops being a race
 * and becomes a constant.
 *
 * What gets seeded is the **committed** text, never the local working copy:
 * the working copy legitimately differs per machine, and seeding from it would
 * put one person's unpushed edits into the shared base as though everyone had
 * agreed to them. Local differences are merged in afterwards, as ordinary edits
 * by their real author — which is what `gitReconcile` is for.
 */
import * as Y from 'yjs';

/**
 * The author id every seed is written under.
 *
 * Zero is never used by a real client: Yjs assigns random 32-bit client ids,
 * and treats 0 as unset. Reserving it means seeded content can always be told
 * apart from something a person typed.
 */
export const SEED_CLIENT_ID = 0;

/** Marks the transaction that applies a seed, so listeners can ignore it. */
export const ROOM_SEED_ORIGIN = 'room-seed';

/**
 * Builds the update that seeds a room with `text`.
 *
 * Deterministic: the same text produces the same bytes on every machine, every
 * time. That property is the whole point, and it is what `roomSeed.test.ts`
 * pins.
 */
export function deterministicSeed(text: string, field = 'markdown'): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = SEED_CLIENT_ID;
  seed.getText(field).insert(0, text);
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

/**
 * Seeds a room document, if it is genuinely empty.
 *
 * Returns whether the seed was applied. An already-populated document is left
 * alone: the room has content, so either somebody seeded it or somebody wrote
 * it, and in both cases the branch text belongs in through reconciliation
 * rather than as a second base.
 */
export function seedIfEmpty(doc: Y.Doc, text: string, field = 'markdown'): boolean {
  if (!text) return false;
  if (doc.getText(field).length > 0) return false;

  Y.applyUpdate(doc, deterministicSeed(text, field), ROOM_SEED_ORIGIN);
  return true;
}
