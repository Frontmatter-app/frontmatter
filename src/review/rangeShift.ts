/**
 * Moves a range from the version of a document it was computed against onto
 * the version on screen now.
 *
 * Every checker that runs in the renderer sees the current text, so its ranges
 * are current by construction. Grammar does not: Harper runs in Rust behind a
 * debounce and an IPC round trip, so its results describe the document as it
 * was up to a second ago. Drawing those offsets on the text as it is now is how
 * a spelling warning for "teh" ends up underlining the middle of another word
 * entirely.
 *
 * The rule is the only one that is safe without a full diff: whatever the edits
 * were, everything before the first differing code unit and everything after
 * the last is untouched. A range wholly inside either region maps exactly — by
 * itself before the change, shifted by the length difference after it. A range
 * that overlaps the region between them covers text that has actually been
 * edited, and there is no honest answer for where it went, so it is dropped
 * until the next scan replaces it.
 */

export interface ShiftedRange {
  from: number;
  to: number;
}

/** Returns null when the range covers text that changed. */
export type RangeShift = (from: number, to: number) => ShiftedRange | null;

export function createRangeShift(before: string, after: string): RangeShift {
  if (before === after) return (from, to) => ({ from, to });

  const shortest = Math.min(before.length, after.length);

  let prefix = 0;
  while (prefix < shortest && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
    prefix += 1;
  }

  // Bounded by what the prefix already claimed, so the two never overlap on a
  // document that is entirely repeated characters.
  let suffix = 0;
  const suffixLimit = shortest - prefix;
  while (
    suffix < suffixLimit &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  /** First offset in `before` that is past everything the edits could reach. */
  const tail = before.length - suffix;
  const delta = after.length - before.length;

  return (from, to) => {
    if (to <= prefix) return { from, to };
    if (from >= tail) return { from: from + delta, to: to + delta };
    return null;
  };
}
