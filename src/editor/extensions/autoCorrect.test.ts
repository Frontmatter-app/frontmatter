import { describe, expect, it } from "vitest";
import { computeAutoCorrection, startsSentence, type AutoCorrectOptions } from "./autoCorrect";

const ALL: AutoCorrectOptions = { corrections: true, smartPunctuation: true };
const ONLY_CORRECTIONS: AutoCorrectOptions = { corrections: true, smartPunctuation: false };
const ONLY_PUNCTUATION: AutoCorrectOptions = { corrections: false, smartPunctuation: true };

/**
 * Types `text` one character at a time, applying every correction as it fires,
 * and returns what the writer would be left looking at.
 */
function type(text: string, options: AutoCorrectOptions = ALL): string {
  let doc = "";
  for (const char of text) {
    doc += char;
    const correction = computeAutoCorrection(doc, doc.length, options);
    if (correction) {
      doc = doc.slice(0, correction.from) + correction.insert + doc.slice(correction.to);
    }
  }
  return doc;
}

describe("typo correction", () => {
  it("fixes a misspelling once the word is finished", () => {
    expect(type("teh cat", ONLY_CORRECTIONS)).toBe("The cat");
  });

  it("waits for a word boundary before deciding", () => {
    expect(computeAutoCorrection("teh", 3, ONLY_CORRECTIONS)).toBeNull();
  });

  it("keeps the writer's capitalization", () => {
    expect(type("I saw Teh thing. ", ONLY_CORRECTIONS)).toBe("I saw The thing. ");
  });

  it("leaves a correctly spelled word alone", () => {
    expect(computeAutoCorrection("A the ", 6, ONLY_CORRECTIONS)).toBeNull();
  });

  it("does not touch words that are genuinely ambiguous", () => {
    expect(type("its there ", ONLY_CORRECTIONS)).toBe("Its there ");
  });
});

describe("capitalization", () => {
  it("capitalizes the first word of the document", () => {
    expect(type("hello world", ONLY_CORRECTIONS)).toBe("Hello world");
  });

  it("capitalizes after a full stop", () => {
    expect(type("one thing. two things", ONLY_CORRECTIONS)).toBe("One thing. Two things");
  });

  it("does not capitalize after an abbreviation", () => {
    expect(type("Meet Dr. smith soon", ONLY_CORRECTIONS)).toBe("Meet Dr. smith soon");
  });

  it("does not capitalize mid-sentence", () => {
    expect(type("a small cat sat", ONLY_CORRECTIONS)).toBe("A small cat sat");
  });

  it("leaves deliberate lower case at the start of a word alone", () => {
    expect(computeAutoCorrection("The iPhone ", 11, ONLY_CORRECTIONS)).toBeNull();
  });

  it("raises a lone i", () => {
    expect(type("well i think", ONLY_CORRECTIONS)).toBe("Well I think");
  });
});

describe("startsSentence", () => {
  it("is true at the very beginning", () => {
    expect(startsSentence("word", 0)).toBe(true);
  });

  it("is true after a blank line", () => {
    const text = "First para.\n\nsecond";
    expect(startsSentence(text, text.indexOf("second"))).toBe(true);
  });

  it("is true at the start of a list item", () => {
    const text = "intro\n- item";
    expect(startsSentence(text, text.indexOf("item"))).toBe(true);
  });

  it("is false on a wrapped line inside a paragraph", () => {
    const text = "a sentence that\nwraps";
    expect(startsSentence(text, text.indexOf("wraps"))).toBe(false);
  });

  it("looks past an opening quote", () => {
    const text = 'He said. "then';
    expect(startsSentence(text, text.indexOf("then"))).toBe(true);
  });
});

describe("spacing", () => {
  it("collapses the typewriter double space after a full stop", () => {
    expect(type("Done.  Next", ONLY_CORRECTIONS)).toBe("Done. Next");
  });

  it("leaves a trailing double space alone, because Markdown means it", () => {
    expect(computeAutoCorrection("a line  ", 8, ONLY_CORRECTIONS)).toBeNull();
  });
});

describe("smart punctuation", () => {
  it("opens and closes double quotes", () => {
    expect(type('He said "hello" back', ONLY_PUNCTUATION)).toBe("He said “hello” back");
  });

  it("uses a right single quote for an apostrophe", () => {
    expect(type("don't", ONLY_PUNCTUATION)).toBe("don’t");
  });

  it("opens a single quote after a space", () => {
    expect(type("say 'yes'", ONLY_PUNCTUATION)).toBe("say ‘yes’");
  });

  it("turns a double hyphen into an em dash", () => {
    expect(type("wait--then go", ONLY_PUNCTUATION)).toBe("wait—then go");
  });

  it("leaves a horizontal rule alone", () => {
    expect(computeAutoCorrection("---", 3, ONLY_PUNCTUATION)).toBeNull();
  });

  it("leaves a table divider alone", () => {
    expect(computeAutoCorrection("|--", 3, ONLY_PUNCTUATION)).toBeNull();
  });

  it("turns three dots into an ellipsis", () => {
    expect(type("wait...", ONLY_PUNCTUATION)).toBe("wait…");
  });

  it("does nothing when smart punctuation is off", () => {
    expect(type('He said "hi"', ONLY_CORRECTIONS)).toBe('He said "hi"');
  });
});

describe("bounds", () => {
  it("ignores an out-of-range caret", () => {
    expect(computeAutoCorrection("text", 0, ALL)).toBeNull();
    expect(computeAutoCorrection("text", 99, ALL)).toBeNull();
  });

  it("does nothing when both switches are off", () => {
    expect(computeAutoCorrection("teh ", 4, { corrections: false, smartPunctuation: false })).toBeNull();
  });
});
