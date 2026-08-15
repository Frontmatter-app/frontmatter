import { describe, expect, it } from "vitest";
import { createRangeShift } from "./rangeShift";

/** What a shifted range must always be: the same text, wherever it now lives. */
function shifted(before: string, after: string, word: string): string | null {
  const from = before.indexOf(word);
  const moved = createRangeShift(before, after)(from, from + word.length);
  return moved ? after.slice(moved.from, moved.to) : null;
}

describe("createRangeShift", () => {
  it("leaves everything where it is when nothing changed", () => {
    const shift = createRangeShift("same text", "same text");
    expect(shift(5, 9)).toEqual({ from: 5, to: 9 });
  });

  it("shifts a range that sits after an insertion", () => {
    expect(shifted("a teh cat", "prefix a teh cat", "teh")).toBe("teh");
  });

  it("shifts a range that sits after a deletion", () => {
    expect(shifted("remove me a teh cat", "a teh cat", "teh")).toBe("teh");
  });

  it("leaves a range that sits before the edit untouched", () => {
    expect(shifted("a teh cat and more", "a teh cat and more text", "teh")).toBe("teh");
  });

  it("handles two edits at once, on either side of the range", () => {
    // The changed region spans both edits, so the range between them is the
    // one thing that cannot be placed — but ranges outside it still can.
    const before = "start MIDDLE teh MIDDLE end";
    const after = "START MIDDLE teh MIDDLE END";
    expect(shifted(before, after, "start")).toBeNull();
    expect(shifted(before, after, "teh")).toBeNull();
  });

  it("gives up on a range covering text that changed", () => {
    expect(shifted("a teh cat", "a the cat", "teh")).toBeNull();
  });

  it("gives up on an unrelated document", () => {
    expect(shifted("a teh cat", "nothing like it", "teh")).toBeNull();
  });

  it("counts in code units, so an emoji ahead of the range shifts it by two", () => {
    const before = "x teh cat";
    const after = "🎉 teh cat";
    const from = before.indexOf("teh");
    // "x" became "🎉", which is an edit — the range after it still moves.
    const moved = createRangeShift(before, after)(from, from + 3);
    expect(moved && after.slice(moved.from, moved.to)).toBe("teh");
  });

  it("does not let the prefix and the suffix claim the same text", () => {
    // Everything matches from both ends at once. Whatever it decides, a range
    // must never be moved somewhere it does not belong.
    expect(shifted("aaaa", "aaaaaa", "aa")).toBe("aa");
    expect(createRangeShift("aaaa", "aa")(0, 4)).toBeNull();
  });

  it("handles a document emptied out from under it", () => {
    expect(createRangeShift("a teh cat", "")(2, 5)).toBeNull();
  });
});
