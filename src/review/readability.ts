/**
 * Frontmatter's readability analysis.
 *
 * Five checks, the same five the Hemingway editor draws:
 *
 *   red    very hard to read sentence
 *   yellow hard to read sentence
 *   green  passive voice
 *   blue   adverb or qualifier
 *   purple word or phrase with a simpler alternative
 *
 * Everything here works in absolute document offsets taken straight from the
 * mask, which is length-preserving. There is no line/column arithmetic and so
 * no opportunity for the editor and the sidebar to disagree about where an
 * issue lives — the previous long-sentence check reported a column of 1 and a
 * length of "first 60 characters plus an ellipsis", which is why long
 * sentences highlighted the wrong text or nothing at all.
 */

import type { LintCategory, LintIssue, LintSeverity } from "./lintTypes";
import { LineIndex, maskMarkdown, type MaskedMarkdown } from "./markdownMask";
import {
  BE_VERBS,
  COMPLEX_PHRASES,
  COMPLEX_PHRASE_KEYS,
  IRREGULAR_PARTICIPLES,
  NON_ADVERBS,
  QUALIFIERS,
} from "./readabilityRules";

export interface Sentence {
  from: number;
  to: number;
  text: string;
  words: number;
  letters: number;
  /** Automated-readability level for this sentence alone. */
  level: number;
}

export interface ReadabilityStats {
  sentences: number;
  words: number;
  /** Whole-document reading grade, rounded, as Hemingway reports it. */
  grade: number;
  hardSentences: number;
  veryHardSentences: number;
  adverbs: number;
  passives: number;
  complexPhrases: number;
  /** Hemingway's targets: adverbs and passives allowed for this length. */
  adverbBudget: number;
  passiveBudget: number;
}

export interface ReadabilityResult {
  issues: LintIssue[];
  stats: ReadabilityStats;
}

/**
 * Sentences shorter than this are never flagged, however dense.
 * Hemingway does the same: a short sentence is by definition readable.
 */
const MIN_WORDS_FOR_GRADING = 14;
const HARD_LEVEL = 10;
const VERY_HARD_LEVEL = 14;

/** A guard against pathological input, not a design limit. */
const MAX_ISSUES = 2000;

const ABBREVIATIONS = new Set([
  "al", "approx", "apr", "aug", "ave", "cf", "ch", "co", "col", "dec", "dept",
  "dr", "e.g", "ed", "eg", "est", "etc", "feb", "fig", "gen", "gov", "i.e",
  "ie", "inc", "jan", "jr", "jul", "jun", "lt", "ltd", "mar", "max", "min",
  "mr", "mrs", "ms", "mt", "no", "nov", "oct", "p", "pp", "prof", "rev",
  "sec", "sen", "sep", "sept", "sgt", "sr", "st", "vol", "vs",
]);

const CLOSERS = new Set(['"', "'", ")", "]", "”", "’", "*", "_"]);

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Built once. Rebuilding these per call showed up as ~15% of a scan. */
const QUALIFIER_RE = new RegExp(
  `\\b(?:${QUALIFIERS.map(escapeForRegex).join("|")})\\b`,
  "gi",
);
const COMPLEX_RE = new RegExp(
  `\\b(?:${COMPLEX_PHRASE_KEYS.map(escapeForRegex).join("|")})\\b`,
  "gi",
);
const ADVERB_RE = /\b[a-z]{4,}ly\b/gi;
const PASSIVE_RE = new RegExp(
  `\\b(?:${BE_VERBS.join("|")})\\b(?:\\s+\\w+ly)?\\s+(\\w+)\\b`,
  "gi",
);

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/**
 * Decides whether a period ends a sentence or belongs to an abbreviation.
 *
 * Handles the two cases that matter in prose: a known abbreviation ("Dr."),
 * and a single-letter initial ("J. R. R. Tolkien").
 */
function isSentenceEnd(text: string, dotIndex: number): boolean {
  let wordStart = dotIndex;
  while (wordStart > 0 && /[A-Za-z0-9.]/.test(text[wordStart - 1])) wordStart -= 1;
  const word = text.slice(wordStart, dotIndex).toLowerCase();
  if (word.length === 1 && /[a-z]/.test(word)) return false;
  return !ABBREVIATIONS.has(word);
}

function measure(text: string): { words: number; letters: number } {
  let words = 0;
  let letters = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const isLetter = /[A-Za-z]/.test(char);
    if (isLetter) letters += 1;
    if (isLetter || /[0-9'’-]/.test(char)) {
      if (!inWord) {
        words += 1;
        inWord = true;
      }
    } else {
      inWord = false;
    }
  }
  return { words, letters };
}

/**
 * Automated Readability Index applied to a single sentence.
 *
 * `0.5 * words` is the words-per-sentence term with the sentence count fixed
 * at one, which is what makes this a per-sentence score rather than a
 * document one.
 */
export function readingLevel(letters: number, words: number): number {
  if (words === 0) return 0;
  return 4.71 * (letters / words) + 0.5 * words - 21.43;
}

export function splitSentences(mask: MaskedMarkdown): Sentence[] {
  const { text } = mask;
  const hardBreaks = new Set(mask.blockStarts);
  const sentences: Sentence[] = [];
  let start = -1;

  const emit = (from: number, to: number) => {
    let f = from;
    let t = to;
    while (f < t && /\s/.test(text[f])) f += 1;
    while (t > f && /\s/.test(text[t - 1])) t -= 1;
    if (t - f < 2) return;
    const body = text.slice(f, t);
    if (!/[A-Za-z]/.test(body)) return;
    const { words, letters } = measure(body);
    sentences.push({ from: f, to: t, text: body, words, letters, level: readingLevel(letters, words) });
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (start >= 0 && hardBreaks.has(i)) {
      emit(start, i);
      start = -1;
    }

    if (start < 0) {
      if (/\s/.test(char)) continue;
      start = i;
    }

    // A blank line always closes a sentence, whatever the punctuation says.
    if (char === "\n") {
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j += 1;
      if (j >= text.length || text[j] === "\n") {
        emit(start, i);
        start = -1;
        i = j - 1;
      }
      continue;
    }

    if (char !== "." && char !== "!" && char !== "?") continue;

    let last = i;
    while (last + 1 < text.length && ".!?".includes(text[last + 1])) last += 1;
    let end = last + 1;
    while (end < text.length && CLOSERS.has(text[end])) end += 1;

    const next = text[end];
    if (next !== undefined && !/\s/.test(next)) {
      i = last;
      continue;
    }
    if (char === "." && last === i && !isSentenceEnd(text, i)) {
      i = last;
      continue;
    }

    emit(start, end);
    start = -1;
    i = end - 1;
  }

  if (start >= 0) emit(start, text.length);
  return sentences;
}

/**
 * Stable identity for an issue.
 *
 * Deliberately not offset-based: typing a word at the top of the document
 * would otherwise renumber every id below it and lose every "hide this one"
 * the writer had chosen. Keyed instead on the rule, the flagged text, and
 * which occurrence of that pair this is.
 */
function makeIdFactory() {
  const counts = new Map<string, number>();
  return (rule: string, match: string): string => {
    const key = `${rule}|${match.toLowerCase().replace(/\s+/g, " ")}`;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);
    return `${key}|${nth}`;
  };
}

const SEVERITY_BY_CATEGORY: Record<LintCategory, LintSeverity> = {
  "very-hard": "error",
  hard: "warning",
  passive: "suggestion",
  adverb: "suggestion",
  complex: "suggestion",
  inclusive: "suggestion",
  grammar: "error",
};

export function analyzeReadability(source: string, mask?: MaskedMarkdown): ReadabilityResult {
  const masked = mask ?? maskMarkdown(source);
  const lines = new LineIndex(source);
  const nextId = makeIdFactory();
  const issues: LintIssue[] = [];

  const add = (
    from: number,
    to: number,
    category: LintCategory,
    rule: string,
    message: string,
    replacements: string[] = [],
    description?: string,
  ) => {
    if (issues.length >= MAX_ISSUES) return;
    if (to <= from) return;
    const match = source.slice(from, to);
    issues.push({
      id: nextId(rule, match),
      from,
      to,
      line: lines.lineAt(from),
      column: lines.columnAt(from),
      severity: SEVERITY_BY_CATEGORY[category],
      category,
      rule,
      message,
      description,
      match,
      replacements,
    });
  };

  const sentences = splitSentences(masked);

  let hardSentences = 0;
  let veryHardSentences = 0;
  let totalWords = 0;
  let totalLetters = 0;

  for (const sentence of sentences) {
    totalWords += sentence.words;
    totalLetters += sentence.letters;
    if (sentence.words < MIN_WORDS_FOR_GRADING) continue;

    if (sentence.level >= VERY_HARD_LEVEL) {
      veryHardSentences += 1;
      add(
        sentence.from,
        sentence.to,
        "very-hard",
        "very-hard-sentence",
        `Very hard to read (${sentence.words} words). Split it in two.`,
        [],
        "Readers have to hold too much at once. Cut it where the thought turns.",
      );
    } else if (sentence.level >= HARD_LEVEL) {
      hardSentences += 1;
      add(
        sentence.from,
        sentence.to,
        "hard",
        "hard-sentence",
        `Hard to read (${sentence.words} words). Shorten or split it.`,
        [],
        "Aim for one idea per sentence.",
      );
    }
  }

  const scan = (
    re: RegExp,
    handle: (match: RegExpExecArray) => void,
  ) => {
    re.lastIndex = 0;
    let match = re.exec(masked.text);
    while (match) {
      handle(match);
      if (match[0].length === 0) re.lastIndex += 1;
      match = re.exec(masked.text);
    }
  };

  let adverbs = 0;
  scan(ADVERB_RE, (match) => {
    if (NON_ADVERBS.has(match[0].toLowerCase())) return;
    adverbs += 1;
    add(
      match.index,
      match.index + match[0].length,
      "adverb",
      "adverb",
      `"${match[0]}" is an adverb. A stronger verb usually says it better.`,
      [],
    );
  });

  scan(QUALIFIER_RE, (match) => {
    adverbs += 1;
    add(
      match.index,
      match.index + match[0].length,
      "adverb",
      "qualifier",
      `"${match[0]}" weakens the sentence. Cut it.`,
      [""],
    );
  });

  let passives = 0;
  scan(PASSIVE_RE, (match) => {
    const participle = match[1].toLowerCase();
    const looksPast =
      IRREGULAR_PARTICIPLES.has(participle) ||
      (participle.endsWith("ed") && participle.length > 3);
    if (!looksPast) return;
    passives += 1;
    add(
      match.index,
      match.index + match[0].length,
      "passive",
      "passive",
      `Passive voice: "${match[0]}". Say who does it.`,
      [],
    );
  });

  let complexPhrases = 0;
  scan(COMPLEX_RE, (match) => {
    const key = match[0].toLowerCase();
    const options = COMPLEX_PHRASES[key];
    if (!options) return;
    complexPhrases += 1;
    add(
      match.index,
      match.index + match[0].length,
      "complex",
      "wordy",
      `"${match[0]}" has a simpler alternative.`,
      options,
      `Try ${options.map((option) => `"${option}"`).join(" or ")}.`,
    );
  });

  const sentenceCount = Math.max(1, sentences.length);
  const grade = totalWords
    ? Math.max(
        1,
        Math.round(
          4.71 * (totalLetters / totalWords) + 0.5 * (totalWords / sentenceCount) - 21.43,
        ),
      )
    : 0;

  return {
    issues,
    stats: {
      sentences: sentences.length,
      words: totalWords,
      grade,
      hardSentences,
      veryHardSentences,
      adverbs,
      passives,
      complexPhrases,
      // Hemingway's own targets: one adverb per 80 words, one passive per five
      // sentences.
      adverbBudget: Math.max(1, Math.round(totalWords / 80)),
      passiveBudget: Math.max(1, Math.round(sentences.length / 5)),
    },
  };
}
