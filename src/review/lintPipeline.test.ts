import { beforeEach, describe, expect, it } from "vitest";
import { analyzeDocument, filterIgnored, issueAt, resetLintMemo } from "./lintPipeline";
import { EMPTY_IGNORE_STATE, type LintIssue } from "./lintTypes";
import type { GrammarLint } from "./grammarIssues";

const issue = (from: number, to: number, over: Partial<LintIssue> = {}): LintIssue => ({
  id: `${from}-${to}`,
  from,
  to,
  line: 1,
  column: from + 1,
  severity: "suggestion",
  category: "inclusive",
  rule: "Test.Rule",
  message: "m",
  match: "x",
  replacements: [],
  ...over,
});

beforeEach(() => resetLintMemo());

describe("analyzeDocument", () => {
  const text = "The report was written by Kim and it was really quickly done for everyone involved.";

  it("returns readability issues with ranges that match the source", () => {
    const { issues } = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    expect(issues.length).toBeGreaterThan(0);
    for (const found of issues) {
      expect(text.slice(found.from, found.to)).toBe(found.match);
    }
  });

  it("returns issues in document order", () => {
    const { issues } = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    const positions = issues.map((found) => found.from);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("merges inclusive-language results with the readability ones", () => {
    const { issues } = analyzeDocument(
      "The chairman was clearly quite pleased with the whitelist he had written.",
      [],
      EMPTY_IGNORE_STATE,
    );
    expect(issues.some((found) => found.category === "inclusive")).toBe(true);
    expect(issues.some((found) => found.category === "adverb")).toBe(true);
  });

  it("reuses the last result so the sidebar and the editor analyse once", () => {
    // The grammar results are the array held in the store, so both callers pass
    // the same reference — which is why the store hands out one shared empty
    // array rather than a fresh literal. The ignore state is a separate copy in
    // each caller, and so is compared by content.
    const alerts = {};
    const grammar: GrammarLint[] = [];
    const first = analyzeDocument(text, grammar, EMPTY_IGNORE_STATE);
    const second = analyzeDocument(text, grammar, { ...EMPTY_IGNORE_STATE });
    expect(second).toBe(first);
  });

  it("recomputes when grammar results arrive", () => {
    const first = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    const second = analyzeDocument(text, [
      { start: 0, end: 3, message: "Spelling", kind: "spelling", severity: "error" as const, suggestions: ["Teh"] },
    ], EMPTY_IGNORE_STATE);
    expect(second).not.toBe(first);
    expect(second.issues.some((found) => found.category === "grammar")).toBe(true);
  });

  it("recomputes when the text changes", () => {
    const first = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    const second = analyzeDocument(`${text} More.`, [], EMPTY_IGNORE_STATE);
    expect(second).not.toBe(first);
  });

  it("recomputes when an ignore choice changes", () => {
    const first = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    const second = analyzeDocument(text, [], { ...EMPTY_IGNORE_STATE, ignoredRules: ["adverb"] });
    expect(second).not.toBe(first);
  });

  it("keeps everything in `all` while filtering `issues`", () => {
    const { all } = analyzeDocument(text, [], EMPTY_IGNORE_STATE);
    const hidden = { ...EMPTY_IGNORE_STATE, ignoredRules: [all[0].rule] };
    const result = analyzeDocument(text, [], hidden);
    expect(result.all.length).toBe(all.length);
    expect(result.issues.every((found) => found.rule !== all[0].rule)).toBe(true);
  });

  it("is empty for an empty document", () => {
    expect(analyzeDocument("", [], EMPTY_IGNORE_STATE).issues).toEqual([]);
  });
});

describe("filterIgnored", () => {
  const issues = [issue(0, 3, { id: "a", rule: "R.One" }), issue(5, 8, { id: "b", rule: "R.Two" })];

  it("drops an ignored id", () => {
    expect(filterIgnored(issues, { ...EMPTY_IGNORE_STATE, ignoredItemIds: ["a"] })).toHaveLength(1);
  });

  it("drops a resolved id", () => {
    expect(filterIgnored(issues, { ...EMPTY_IGNORE_STATE, resolvedItemIds: ["b"] })).toHaveLength(1);
  });

  it("drops a whole rule", () => {
    expect(filterIgnored(issues, { ...EMPTY_IGNORE_STATE, ignoredRules: ["R.One"] })).toHaveLength(1);
  });

  it("returns the same array when nothing is ignored", () => {
    expect(filterIgnored(issues, EMPTY_IGNORE_STATE)).toBe(issues);
  });
});

describe("issueAt", () => {
  const sentence = issue(0, 100, { id: "sentence", category: "very-hard" });
  const adverb = issue(40, 47, { id: "adverb", category: "adverb" });
  const issues = [sentence, adverb];

  it("finds the issue covering an offset", () => {
    expect(issueAt(issues, 5)?.id).toBe("sentence");
  });

  it("prefers the innermost issue", () => {
    expect(issueAt(issues, 42)?.id).toBe("adverb");
  });

  it("returns nothing outside every range", () => {
    expect(issueAt(issues, 500)).toBeNull();
    expect(issueAt([], 0)).toBeNull();
  });
});
