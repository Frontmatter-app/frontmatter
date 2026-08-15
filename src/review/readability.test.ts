import { describe, expect, it } from "vitest";
import { analyzeReadability, readingLevel, splitSentences } from "./readability";
import { maskMarkdown } from "./markdownMask";

const sentencesOf = (text: string) => splitSentences(maskMarkdown(text)).map((s) => s.text);
const issuesFor = (text: string, rule: string) =>
  analyzeReadability(text).issues.filter((issue) => issue.rule === rule);

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(sentencesOf("One thing. Two things! Three?")).toEqual([
      "One thing.",
      "Two things!",
      "Three?",
    ]);
  });

  it("does not split inside an abbreviation", () => {
    expect(sentencesOf("Dr. Smith arrived at 9. Then he left.")).toEqual([
      "Dr. Smith arrived at 9.",
      "Then he left.",
    ]);
  });

  it("does not split on initials", () => {
    expect(sentencesOf("J. R. R. Tolkien wrote it.")).toEqual(["J. R. R. Tolkien wrote it."]);
  });

  it("treats a blank line as the end of a sentence", () => {
    expect(sentencesOf("No full stop here\n\nNext paragraph")).toEqual([
      "No full stop here",
      "Next paragraph",
    ]);
  });

  it("keeps list items apart even without punctuation", () => {
    expect(sentencesOf("- first item\n- second item\n")).toEqual(["first item", "second item"]);
  });

  it("reports offsets that point at the sentence in the source", () => {
    const source = "Short one. A rather longer second sentence here.";
    const [, second] = splitSentences(maskMarkdown(source));
    expect(source.slice(second.from, second.to)).toBe("A rather longer second sentence here.");
  });
});

describe("readability grading", () => {
  it("leaves short sentences alone however dense", () => {
    expect(issuesFor("Antidisestablishmentarianism prevailed.", "hard-sentence")).toHaveLength(0);
    expect(issuesFor("Antidisestablishmentarianism prevailed.", "very-hard-sentence")).toHaveLength(0);
  });

  it("flags a long sentence as hard to read", () => {
    const text =
      "The committee decided that the report should be revised before the meeting so that everyone could read it.";
    expect(issuesFor(text, "hard-sentence")).toHaveLength(1);
  });

  it("flags a very long sentence as very hard to read", () => {
    const text =
      "The committee decided that the report should be revised before the meeting so that everyone " +
      "could read it and prepare their comments in advance of the discussion which had already been " +
      "postponed twice for reasons nobody could explain to anybody else.";
    expect(issuesFor(text, "very-hard-sentence")).toHaveLength(1);
    expect(issuesFor(text, "hard-sentence")).toHaveLength(0);
  });

  it("highlights the whole sentence, not a fixed-length prefix", () => {
    const text =
      "The committee decided that the report should be revised before the meeting so that everyone could read it.";
    const [issue] = issuesFor(text, "hard-sentence");
    expect(text.slice(issue.from, issue.to)).toBe(text);
  });

  it("rises with both sentence length and word length", () => {
    expect(readingLevel(0, 0)).toBe(0);
    // Same words per sentence, longer words.
    expect(readingLevel(200, 20)).toBeGreaterThan(readingLevel(100, 20));
    // Same word length, more of them.
    expect(readingLevel(150, 30)).toBeGreaterThan(readingLevel(100, 20));
  });
});

describe("adverbs and qualifiers", () => {
  it("flags an -ly adverb", () => {
    const [issue] = issuesFor("She quickly agreed.", "adverb");
    expect(issue.match).toBe("quickly");
  });

  it("ignores words that merely end in ly", () => {
    expect(issuesFor("The family reply was only a supply problem.", "adverb")).toHaveLength(0);
  });

  it("flags each occurrence separately, at its own offset", () => {
    const text = "He quietly left, then quietly returned.";
    const issues = issuesFor(text, "adverb");
    expect(issues).toHaveLength(2);
    expect(issues[0].from).not.toBe(issues[1].from);
    for (const issue of issues) expect(text.slice(issue.from, issue.to)).toBe("quietly");
  });

  it("flags hedges as well as adverbs", () => {
    const [issue] = issuesFor("It was just a draft.", "qualifier");
    expect(issue.match).toBe("just");
  });
});

describe("passive voice", () => {
  it("flags a be-verb with a past participle", () => {
    const [issue] = issuesFor("The report was written by Kim.", "passive");
    expect(issue.match).toBe("was written");
  });

  it("flags an irregular participle", () => {
    expect(issuesFor("The window was broken overnight.", "passive")).toHaveLength(1);
  });

  it("leaves an active sentence alone", () => {
    expect(issuesFor("Kim wrote the report.", "passive")).toHaveLength(0);
  });
});

describe("complex phrasing", () => {
  it("offers the simpler alternative as a replacement", () => {
    const [issue] = issuesFor("We met in order to decide.", "wordy");
    expect(issue.match).toBe("in order to");
    expect(issue.replacements).toContain("to");
  });

  it("prefers the longest phrase over a word inside it", () => {
    const [issue] = issuesFor("It failed due to the fact that nobody checked.", "wordy");
    expect(issue.match).toBe("due to the fact that");
  });
});

describe("scope", () => {
  it("never flags anything inside code", () => {
    const source = "```\nThe report was written by Kim and it was really quickly done.\n```\n";
    expect(analyzeReadability(source).issues).toHaveLength(0);
  });

  it("never flags a URL", () => {
    const source = "See [docs](https://example.com/really/quickly/written).";
    expect(analyzeReadability(source).issues).toHaveLength(0);
  });
});

describe("stats", () => {
  it("reports counts and budgets for the summary", () => {
    const { stats } = analyzeReadability("Kim quickly wrote it. The draft was reviewed by Sam.");
    expect(stats.sentences).toBe(2);
    expect(stats.adverbs).toBe(1);
    expect(stats.passives).toBe(1);
    expect(stats.adverbBudget).toBeGreaterThan(0);
  });
});

describe("issue identity", () => {
  it("survives an edit made elsewhere in the document", () => {
    const before = analyzeReadability("Kim quickly wrote it.\n\nSam quickly read it.");
    const after = analyzeReadability("A new opening line.\n\nKim quickly wrote it.\n\nSam quickly read it.");
    const ids = (result: typeof before) => result.issues.map((issue) => issue.id);
    for (const id of ids(before)) expect(ids(after)).toContain(id);
  });
});
