/**
 * Harper's grammar results, in the shape the rest of the review uses.
 *
 * There is almost nothing to do here, and that is the point: Harper reports
 * absolute UTF-16 offsets because the Rust side converts them from Unicode
 * scalars before they cross the boundary. A checker that reports 1-based rune
 * spans relative to a line needs a document, a line index and a rune
 * conversion before its output means anything.
 */

import type { LintIssue, LintSeverity } from "./lintTypes";
import { LineIndex, type MaskedMarkdown } from "./markdownMask";
import { createRangeShift } from "./rangeShift";

export interface GrammarLint {
  /** Absolute UTF-16 offset, inclusive. */
  start: number;
  /** Absolute UTF-16 offset, exclusive. */
  end: number;
  message: string;
  /** Harper's category, lower-cased. */
  kind: string;
  /** "error" | "warning" | "suggestion", graded on the Rust side. */
  severity: LintSeverity;
  suggestions: string[];
}

/**
 * Severity comes from Rust, decided by an exhaustive match on Harper's own
 * category enum. It used to be a lookup table here with a default, and three
 * categories were missing from it — so "could of gone" was filed as a gentle
 * suggestion rather than the plain error it is. A table in TypeScript cannot be
 * checked against an enum that lives in another language; a `match` can.
 */

/**
 * A finished grammar check, together with the text it was a check *of*.
 *
 * The text is not bookkeeping. Grammar is the only analysis in the app whose
 * results arrive later than the document they describe, so the text is the only
 * thing that says which document an offset means.
 */
export interface GrammarScan {
  /** Exactly what Harper was given. */
  text: string;
  lints: GrammarLint[];
}

export const EMPTY_GRAMMAR_SCAN: GrammarScan = { text: "", lints: [] };

export interface GrammarConversionOptions {
  /** Drops lints that land on code, links or other non-prose. */
  mask?: MaskedMarkdown;
  lines?: LineIndex;
}

export function grammarLintsToIssues(
  source: string,
  scan: GrammarScan | null | undefined,
  options: GrammarConversionOptions = {},
): LintIssue[] {
  if (!scan || scan.lints.length === 0) return [];

  const scanned = scan.text;
  const lines = options.lines ?? new LineIndex(source);
  const mask = options.mask;
  const shift = createRangeShift(scanned, source);
  const counts = new Map<string, number>();
  const issues: LintIssue[] = [];

  for (const lint of scan.lints) {
    // Clamped against the scanned text, because that is the text these offsets
    // are offsets into.
    const start = Math.max(0, Math.min(lint.start, scanned.length));
    const end = Math.max(start, Math.min(lint.end, scanned.length));
    if (end <= start) continue;

    const match = scanned.slice(start, end);
    const key = `${lint.kind}|${match.toLowerCase()}`;

    // Counted before anything is dropped, so an id names the same flag whether
    // or not the ones around it survived. Ignoring the second "teh" must not
    // start meaning the third one the moment an edit lands on the first.
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);

    const moved = shift(start, end);
    if (!moved) continue;

    // The invariant the whole review depends on: a highlight covers the text
    // that was judged. If the shift ever disagrees, drawing nothing is right
    // and drawing it anyway is the bug this replaces.
    if (source.slice(moved.from, moved.to) !== match) continue;

    // Harper parses Markdown and skips code itself, but the mask is the one
    // place that decides what counts as prose in this app, so it has the final
    // say for every source of issues alike.
    if (mask && (mask.ignored[moved.from] === 1 || mask.ignored[moved.to - 1] === 1)) continue;

    issues.push({
      id: `${key}|${nth}`,
      from: moved.from,
      to: moved.to,
      line: lines.lineAt(moved.from),
      column: lines.columnAt(moved.from),
      severity: lint.severity ?? "suggestion",
      category: "grammar",
      rule: lint.kind,
      message: lint.message,
      match,
      replacements: lint.suggestions.filter((suggestion) => typeof suggestion === "string"),
    });
  }

  return issues;
}
