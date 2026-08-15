import { describe, expect, it } from "vitest";
import { grammarLintsToIssues, type GrammarLint } from "./grammarIssues";
import { maskMarkdown } from "./markdownMask";
import { useProseScanStore } from "./proseScanStore";

const lint = (over: Partial<GrammarLint> = {}): GrammarLint => ({
  start: 0,
  end: 3,
  message: "Did you mean 'the'?",
  kind: "spelling",
  severity: "error",
  suggestions: ["the"],
  ...over,
});

describe("grammarLintsToIssues", () => {
  it("uses the offsets Harper gave, untouched", () => {
    const source = "teh cat sat.";
    const [issue] = grammarLintsToIssues(source, [lint()]);
    expect(source.slice(issue.from, issue.to)).toBe("teh");
    expect(issue.match).toBe("teh");
  });

  it("keeps offsets correct after a multi-byte character", () => {
    // The Rust side already converted from scalars to UTF-16, so "🎉 " is two
    // code units plus a space and "teh" starts at 3.
    const source = "🎉 teh cat";
    const [issue] = grammarLintsToIssues(source, [lint({ start: 3, end: 6 })]);
    expect(source.slice(issue.from, issue.to)).toBe("teh");
  });

  it("reports line and column for the sidebar", () => {
    const source = "first line\nteh cat";
    const [issue] = grammarLintsToIssues(source, [lint({ start: 11, end: 14 })]);
    expect(issue.line).toBe(2);
    expect(issue.column).toBe(1);
  });

  it("carries suggestions through as replacements", () => {
    const [issue] = grammarLintsToIssues("teh cat", [lint()]);
    expect(issue.replacements).toEqual(["the"]);
  });

  it("takes the severity Rust graded it with", () => {
    const [spelling] = grammarLintsToIssues("teh cat", [lint({ severity: "error" })]);
    const [other] = grammarLintsToIssues("teh cat", [lint({ severity: "suggestion" })]);
    expect(spelling.severity).toBe("error");
    expect(other.severity).toBe("suggestion");
  });

  it("falls back to a suggestion if severity is somehow absent", () => {
    const [issue] = grammarLintsToIssues("teh cat", [
      { ...lint(), severity: undefined } as unknown as GrammarLint,
    ]);
    expect(issue.severity).toBe("suggestion");
  });

  it("drops a lint that lands inside code", () => {
    const source = "Run `teh` now.";
    const at = source.indexOf("teh");
    const issues = grammarLintsToIssues(source, [lint({ start: at, end: at + 3 })], {
      mask: maskMarkdown(source),
    });
    expect(issues).toHaveLength(0);
  });

  it("gives repeated flags of the same word distinct ids", () => {
    const source = "teh cat and teh dog";
    const issues = grammarLintsToIssues(source, [
      lint({ start: 0, end: 3 }),
      lint({ start: 12, end: 15 }),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0].id).not.toBe(issues[1].id);
  });

  it("ignores an empty or out-of-range span rather than throwing", () => {
    expect(grammarLintsToIssues("short", [lint({ start: 2, end: 2 })])).toHaveLength(0);
    expect(grammarLintsToIssues("short", [lint({ start: 900, end: 950 })])).toHaveLength(0);
  });

  it("handles no results at all", () => {
    expect(grammarLintsToIssues("text", [])).toEqual([]);
    expect(grammarLintsToIssues("text", null)).toEqual([]);
  });
});

describe("proseScanStore", () => {
  it("hands out the same empty array every time it is cleared", () => {
    const store = useProseScanStore.getState();
    store.setGrammarLints([lint()]);
    store.clear();
    const first = useProseScanStore.getState().grammarLints;
    store.clear();
    // The analysis memo compares this by identity; a fresh [] each time would
    // make every clear look like new results and re-run the whole analysis.
    expect(useProseScanStore.getState().grammarLints).toBe(first);
  });

  it("holds the results until they are replaced", () => {
    const store = useProseScanStore.getState();
    store.clear();
    store.setGrammarLints([lint()]);
    expect(useProseScanStore.getState().grammarLints).toHaveLength(1);
  });
});
