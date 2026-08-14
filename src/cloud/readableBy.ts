/**
 * The `readableBy` index on a cloud document.
 *
 * Firestore cannot express "documents visible to me" — visibility depends on
 * per-document group lists crossed with the groups I belong to. The client used
 * to approximate it with four-plus concurrent listeners per member: one for
 * documents they own, one for `visibleTo == null`, one for `visibleTo == []`,
 * and a batch of `array-contains-any` queries over their group ids.
 *
 * `readableBy` collapses that into one array a single query can match. It is a
 * *narrowing* device, not an authorization one: the security rules still decide
 * access from `filePermissions` and team membership, so a document with a wrong
 * or forged `readableBy` cannot be read by someone who should not see it.
 */

/** Present when a document is readable by every member of its team. */
export const UNRESTRICTED = '*';

/**
 * Firestore caps `array-contains-any` at 30 values. Group ids are batched below
 * that to leave room for the sentinel and the user's own id.
 */
export const READABLE_BY_BATCH_SIZE = 28;

/**
 * Builds the index for a document.
 *
 * The owner is always included so that restricting a document to a group the
 * owner is not in does not hide it from them.
 */
export function deriveReadableBy(
  ownerId: string | null | undefined,
  visibleTo?: string[] | null,
): string[] {
  const groups = (visibleTo ?? []).filter(Boolean);
  const base = groups.length === 0 ? [UNRESTRICTED] : groups;
  const tokens = ownerId ? [...base, ownerId] : base;
  return Array.from(new Set(tokens));
}

/** The tokens a reader matches against, newest-first is irrelevant here. */
export function readerTokens(uid: string, groupIds: string[]): string[] {
  return Array.from(new Set([UNRESTRICTED, uid, ...groupIds.filter(Boolean)]));
}

/** Splits reader tokens into query-sized batches, keeping the sentinel in each. */
export function batchReaderTokens(uid: string, groupIds: string[]): string[][] {
  const groups = Array.from(new Set(groupIds.filter(Boolean)));
  if (groups.length <= READABLE_BY_BATCH_SIZE) {
    return [readerTokens(uid, groups)];
  }

  const batches: string[][] = [];
  for (let i = 0; i < groups.length; i += READABLE_BY_BATCH_SIZE) {
    batches.push(readerTokens(uid, groups.slice(i, i + READABLE_BY_BATCH_SIZE)));
  }
  return batches;
}
