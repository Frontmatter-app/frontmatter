import { describe, expect, it } from "vitest";
import { grammarLintsToIssues, type GrammarLint, type GrammarScan } from "./grammarIssues";
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

/** A check of the text on screen — the case where nothing has moved. */
const scanOf = (text: string, lints: GrammarLint[]): GrammarScan => ({ text, lints });

describe("grammarLintsToIssues", () => {
  it("uses the offsets Harper gave, untouched", () => {
    const source = "teh cat sat.";
    const [issue] = grammarLintsToIssues(source, scanOf(source, [lint()]));
    expect(source.slice(issue.from, issue.to)).toBe("teh");
    expect(issue.match).toBe("teh");
  });

  it("keeps offsets correct after a multi-byte character", () => {
    // The Rust side already converted from scalars to UTF-16, so "🎉 " is two
    // code units plus a space and "teh" starts at 3.
    const source = "🎉 teh cat";
    const [issue] = grammarLintsToIssues(source, scanOf(source, [lint({ start: 3, end: 6 })]));
    expect(source.slice(issue.from, issue.to)).toBe("teh");
  });

  it("reports line and column for the sidebar", () => {
    const source = "first line\nteh cat";
    const [issue] = grammarLintsToIssues(source, scanOf(source, [lint({ start: 11, end: 14 })]));
    expect(issue.line).toBe(2);
    expect(issue.column).toBe(1);
  });

  it("carries suggestions through as replacements", () => {
    const [issue] = grammarLintsToIssues("teh cat", scanOf("teh cat", [lint()]));
    expect(issue.replacements).toEqual(["the"]);
  });

  it("takes the severity Rust graded it with", () => {
    const [spelling] = grammarLintsToIssues("teh cat", scanOf("teh cat", [lint({ severity: "error" })]));
    const [other] = grammarLintsToIssues("teh cat", scanOf("teh cat", [lint({ severity: "suggestion" })]));
    expect(spelling.severity).toBe("error");
    expect(other.severity).toBe("suggestion");
  });

  it("falls back to a suggestion if severity is somehow absent", () => {
    const [issue] = grammarLintsToIssues("teh cat", scanOf("teh cat", [
      { ...lint(), severity: undefined } as unknown as GrammarLint,
    ]));
    expect(issue.severity).toBe("suggestion");
  });

  it("drops a lint that lands inside code", () => {
    const source = "Run `teh` now.";
    const at = source.indexOf("teh");
    const issues = grammarLintsToIssues(source, scanOf(source, [lint({ start: at, end: at + 3 })]), {
      mask: maskMarkdown(source),
    });
    expect(issues).toHaveLength(0);
  });

  it("gives repeated flags of the same word distinct ids", () => {
    const source = "teh cat and teh dog";
    const issues = grammarLintsToIssues(source, scanOf(source, [
      lint({ start: 0, end: 3 }),
      lint({ start: 12, end: 15 }),
    ]));
    expect(issues).toHaveLength(2);
    expect(issues[0].id).not.toBe(issues[1].id);
  });

  it("ignores an empty or out-of-range span rather than throwing", () => {
    expect(grammarLintsToIssues("short", scanOf("short", [lint({ start: 2, end: 2 })]))).toHaveLength(0);
    expect(grammarLintsToIssues("short", scanOf("short", [lint({ start: 900, end: 950 })]))).toHaveLength(0);
  });

  it("handles no results at all", () => {
    expect(grammarLintsToIssues("text", scanOf("text", []))).toEqual([]);
    expect(grammarLintsToIssues("text", null)).toEqual([]);
  });
});

/**
 * The reported bug, from the side that caused it.
 *
 * Harper answers about a document that is up to a second old. Every case here
 * is the writer having carried on typing in the meantime.
 */
describe("results that arrive after the writer has moved on", () => {
  const scanned = "The cat sat on teh mat and waited for supper.";
  const at = scanned.indexOf("teh");
  const scan = scanOf(scanned, [lint({ start: at, end: at + 3 })]);

  it("moves a flag when text is inserted ahead of it", () => {
    const source = `A new opening sentence goes here. ${scanned}`;
    const [issue] = grammarLintsToIssues(source, scan);
    expect(source.slice(issue.from, issue.to)).toBe("teh");
  });

  it("moves a flag when text is deleted ahead of it", () => {
    const source = scanned.replace("The cat ", "");
    const [issue] = grammarLintsToIssues(source, scan);
    expect(source.slice(issue.from, issue.to)).toBe("teh");
  });

  it("leaves a flag alone when the edit is behind it", () => {
    const source = `${scanned} And then it rained all evening.`;
    const [issue] = grammarLintsToIssues(source, scan);
    expect(source.slice(issue.from, issue.to)).toBe("teh");
  });

  it("drops a flag whose own word has been edited", () => {
    // The writer is part-way through typing the fix. There is no honest place
    // to put this highlight, and the next scan is milliseconds away.
    const source = scanned.replace("teh", "th");
    expect(grammarLintsToIssues(source, scan)).toHaveLength(0);
  });

  it("draws nothing at all on a document it never saw", () => {
    const source = "An entirely different document about gardening in autumn.";
    expect(grammarLintsToIssues(source, scan)).toHaveLength(0);
  });

  it("keeps ids stable while the flags around it come and go", () => {
    const twice = "teh cat and teh dog, but mostly teh cat.";
    const positions: number[] = [];
    for (let at = twice.indexOf("teh"); at !== -1; at = twice.indexOf("teh", at + 1)) positions.push(at);
    const scanTwice = scanOf(twice, positions.map((start) => lint({ start, end: start + 3 })));

    const before = grammarLintsToIssues(twice, scanTwice);
    expect(before.map((issue) => issue.id)).toEqual([
      "spelling|teh|1",
      "spelling|teh|2",
      "spelling|teh|3",
    ]);

    // The first one is being retyped, so it drops out. The other two must keep
    // the ids the writer's ignore and resolve choices were recorded against.
    const edited = twice.replace("teh cat and", "th cat and");
    expect(grammarLintsToIssues(edited, scanTwice).map((issue) => issue.id)).toEqual([
      "spelling|teh|2",
      "spelling|teh|3",
    ]);
  });
});

describe("proseScanStore", () => {
  it("hands out the same empty scan every time it is cleared", () => {
    const store = useProseScanStore.getState();
    store.setGrammarScan("teh cat", [lint()]);
    store.clear();
    const first = useProseScanStore.getState().grammar;
    store.clear();
    // The analysis memo compares this by identity; a fresh object each time
    // would make every clear look like new results and re-run the analysis.
    expect(useProseScanStore.getState().grammar).toBe(first);
  });

  it("holds the results, and the text they were a check of, until replaced", () => {
    const store = useProseScanStore.getState();
    store.clear();
    store.setGrammarScan("teh cat", [lint()]);
    expect(useProseScanStore.getState().grammar.lints).toHaveLength(1);
    expect(useProseScanStore.getState().grammar.text).toBe("teh cat");
  });

  it("forgets the results when the check fails", () => {
    const store = useProseScanStore.getState();
    store.setGrammarScan("teh cat", [lint()]);
    store.setGrammarError("check_grammar is not a command");
    expect(useProseScanStore.getState().grammar.lints).toHaveLength(0);
  });
});
