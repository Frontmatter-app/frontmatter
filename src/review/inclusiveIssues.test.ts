import { describe, expect, it } from "vitest";
import { analyzeInclusiveLanguage } from "./inclusiveIssues";
import { maskMarkdown } from "./markdownMask";

const analyze = (source: string) => analyzeInclusiveLanguage(source, maskMarkdown(source));

describe("analyzeInclusiveLanguage", () => {
  it("flags a loaded word and points at exactly that word", () => {
    const source = "The chairman opened the meeting.";
    const [issue] = analyze(source);
    expect(source.slice(issue.from, issue.to)).toBe("chairman");
    expect(issue.match).toBe("chairman");
  });

  it("offers the alternatives as replacements", () => {
    const [issue] = analyze("The chairman opened the meeting.");
    expect(issue.replacements).toContain("chair");
    expect(issue.replacements.length).toBeGreaterThan(1);
  });

  it("writes its own message rather than passing the library's through", () => {
    const [issue] = analyze("The whitelist is short.");
    // The library's own wording is long and contains a typo ("in somes cases").
    expect(issue.message).not.toContain("somes cases");
    expect(issue.message).toContain("whitelist");
  });

  it("stays advisory", () => {
    for (const issue of analyze("The chairman is crazy about the whitelist.")) {
      expect(issue.severity).toBe("suggestion");
      expect(issue.category).toBe("inclusive");
    }
  });

  it("names the rule that fired", () => {
    const [issue] = analyze("The whitelist is short.");
    expect(issue.rule).toBe("whitelist");
  });

  it("finds each occurrence separately", () => {
    const source = "One whitelist here, another whitelist there.";
    const issues = analyze(source).filter((issue) => issue.rule === "whitelist");
    expect(issues).toHaveLength(2);
    expect(issues[0].from).not.toBe(issues[1].from);
    expect(issues[0].id).not.toBe(issues[1].id);
  });

  it("reports line and column for the sidebar", () => {
    const source = "First line is fine.\nThe chairman spoke.";
    const [issue] = analyze(source);
    expect(issue.line).toBe(2);
    expect(source.slice(issue.from, issue.to)).toBe("chairman");
  });

  it("never flags anything inside code", () => {
    // The mask blanks the fence, and offsets are preserved, so nothing here
    // reaches the checker in the first place.
    expect(analyze("```\nconst whitelist = [];\n```\n")).toEqual([]);
    expect(analyze("Use the `whitelist` option.")).toEqual([]);
  });

  it("never flags a URL", () => {
    expect(analyze("See [docs](https://example.com/whitelist/chairman).")).toEqual([]);
  });

  it("leaves ordinary prose alone", () => {
    expect(analyze("The committee opened the meeting and agreed the plan.")).toEqual([]);
  });

  it("handles an empty document", () => {
    expect(analyze("")).toEqual([]);
  });

  it("skips a document too large to parse on the render path", () => {
    // Well past the guard: the check is skipped rather than stuttering the
    // editor for a suggestion about word choice.
    const huge = "The chairman spoke. ".repeat(20_000);
    expect(huge.length).toBeGreaterThan(200_000);
    expect(analyze(huge)).toEqual([]);
  });
});
