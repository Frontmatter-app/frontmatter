/**
 * The single place a document turns into review items.
 *
 * The sidebar and the editor used to run this work independently — two full
 * markdown parses, two metric passes and two filter passes per keystroke, on
 * the same text, producing two sets of ranges that could disagree. They now
 * call the same function, and the memo below means the second caller in a
 * tick pays nothing.
 */

import { analyzeReadability, type ReadabilityStats } from "./readability";
import { compareIssues, type LintIgnoreState, type LintIssue } from "./lintTypes";
import { maskMarkdown, LineIndex } from "./markdownMask";
import { grammarLintsToIssues, type GrammarScan } from "./grammarIssues";
import { analyzeInclusiveLanguage } from "./inclusiveIssues";

export interface LintAnalysis {
  /** Everything found, before the writer's ignore choices are applied. */
  all: LintIssue[];
  /** What the UI shows. */
  issues: LintIssue[];
  stats: ReadabilityStats;
}

const EMPTY_STATS: ReadabilityStats = {
  sentences: 0, words: 0, grade: 0, hardSentences: 0, veryHardSentences: 0,
  adverbs: 0, passives: 0, complexPhrases: 0, adverbBudget: 1, passiveBudget: 1,
};

export const EMPTY_ANALYSIS: LintAnalysis = { all: [], issues: [], stats: EMPTY_STATS };

/**
 * Nothing is capped here, and that is a fix rather than an oversight.
 *
 * This used to end with `.slice(0, 1000)`. Issues come out in document order,
 * so the cap did not thin the highlights out — it cut the document in half.
 * Past about fifteen pages every remaining sentence, adverb and misspelling
 * simply had no highlight and no card, with nothing on screen to say so, which
 * reads exactly like a checker that stops working half way down a long file.
 *
 * The cost it was guarding against is real, but it is the sidebar's: a card is
 * a dozen DOM nodes and the list is not virtualised. The editor's cost is not
 * comparable — decorations live in a range tree that only renders what is in
 * the viewport. So the analysis returns everything it found, the editor draws
 * all of it, and the sidebar caps its own card list and says how many it left
 * out.
 */

/**
 * Removes highlights that say the same thing twice.
 *
 * Six Vale style packages once ran at once, so a single phrase routinely drew
 * three or four overlapping underlines. Identical ranges collapse to the
 * strongest issue, and a word-level issue wholly inside another with the same
 * message is dropped.
 */
function dedupe(issues: LintIssue[]): LintIssue[] {
  const sorted = [...issues].sort(compareIssues);
  const kept: LintIssue[] = [];
  const seenRanges = new Set<string>();

  for (const issue of sorted) {
    const rangeKey = `${issue.from}:${issue.to}:${issue.category}`;
    if (seenRanges.has(rangeKey)) continue;

    // The word-level checks overlap: Harper and the inclusive-language rules
    // can both have an opinion about the same word. Where one wholly contains
    // the other and they say the same thing, keep one. The readability
    // categories are exempt — a sentence highlight is *meant* to contain the
    // adverb inside it, the way Hemingway draws them.
    if (issue.category === "inclusive" || issue.category === "grammar") {
      const swallowed = kept.some(
        (other) =>
          (other.category === "inclusive" || other.category === "grammar") &&
          other.from <= issue.from &&
          other.to >= issue.to &&
          other.message === issue.message,
      );
      if (swallowed) continue;
    }

    seenRanges.add(rangeKey);
    kept.push(issue);
  }

  return kept;
}

export function filterIgnored(issues: LintIssue[], ignore: LintIgnoreState): LintIssue[] {
  const ignoredRules = new Set(ignore.ignoredRules);
  const ignoredIds = new Set(ignore.ignoredItemIds);
  const resolvedIds = new Set(ignore.resolvedItemIds);
  if (!ignoredRules.size && !ignoredIds.size && !resolvedIds.size) return issues;

  return issues.filter(
    (issue) =>
      !ignoredRules.has(issue.rule) &&
      !ignoredIds.has(issue.id) &&
      !resolvedIds.has(issue.id),
  );
}

interface MemoEntry {
  source: string;
  grammar: unknown;
  ignore: LintIgnoreState;
  result: LintAnalysis;
}

let memo: MemoEntry | null = null;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Compared by content, not identity.
 *
 * The sidebar and the editor each hold their own copy of the ignore state,
 * read from the same Yjs map. Identity comparison would miss on every call and
 * the memo — the whole reason both can ask for the analysis without paying for
 * it twice — would never hit.
 */
function sameIgnore(a: LintIgnoreState, b: LintIgnoreState): boolean {
  return (
    a === b ||
    (sameList(a.ignoredRules, b.ignoredRules) &&
      sameList(a.ignoredItemIds, b.ignoredItemIds) &&
      sameList(a.resolvedItemIds, b.resolvedItemIds))
  );
}

export function analyzeDocument(
  source: string,
  grammar: GrammarScan | null | undefined,
  ignore: LintIgnoreState,
): LintAnalysis {
  if (
    memo &&
    memo.source === source &&
    memo.grammar === grammar &&
    sameIgnore(memo.ignore, ignore)
  ) {
    return memo.result;
  }

  if (!source) {
    const result = EMPTY_ANALYSIS;
    memo = { source, grammar, ignore, result };
    return result;
  }

  const mask = maskMarkdown(source);
  const lines = new LineIndex(source);
  const { issues: readabilityIssues, stats } = analyzeReadability(source, mask);
  const inclusiveIssues = analyzeInclusiveLanguage(source, mask, { lines });
  const grammarIssues = grammarLintsToIssues(source, grammar, { mask, lines });

  const all = dedupe([...readabilityIssues, ...inclusiveIssues, ...grammarIssues]);
  const issues = filterIgnored(all, ignore);

  const result: LintAnalysis = { all, issues, stats };
  memo = { source, grammar, ignore, result };
  return result;
}

/** Test seam. Nothing in the app needs to clear the memo. */
export function resetLintMemo(): void {
  memo = null;
}

/**
 * Locates the issue under a document offset.
 *
 * Ranges are sorted and mostly disjoint, so a binary search for the first
 * range that could contain the offset, followed by a short walk, beats the
 * linear scan the click handler used to do over every alert.
 */
export function issueAt(issues: LintIssue[], pos: number): LintIssue | null {
  if (issues.length === 0) return null;

  // First index whose range starts at or after `pos`.
  let low = 0;
  let high = issues.length - 1;
  let candidate = issues.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (issues[mid].from >= pos) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  let best: LintIssue | null = null;
  const consider = (issue: LintIssue) => {
    if (issue.from > pos || pos > issue.to) return;
    // The innermost match wins, so clicking an adverb inside a long sentence
    // selects the adverb rather than the paragraph around it.
    if (!best || issue.to - issue.from < best.to - best.from) best = issue;
  };

  // Backwards over ranges that start earlier and may still cover `pos`. A
  // sentence is the longest thing flagged, so once we are further back than
  // any sentence could reach there is nothing left to find.
  for (let i = candidate - 1; i >= 0 && pos - issues[i].from <= LONGEST_RANGE; i -= 1) {
    consider(issues[i]);
  }
  // Forwards over ranges that start exactly at `pos`.
  for (let i = candidate; i < issues.length && issues[i].from <= pos; i += 1) {
    consider(issues[i]);
  }

  return best;
}

/** Nothing flagged is longer than this, so the backwards walk can stop. */
const LONGEST_RANGE = 4000;
