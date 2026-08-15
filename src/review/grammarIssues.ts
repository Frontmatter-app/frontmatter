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

export interface GrammarConversionOptions {
  /** Drops lints that land on code, links or other non-prose. */
  mask?: MaskedMarkdown;
  lines?: LineIndex;
}

export function grammarLintsToIssues(
  source: string,
  lints: GrammarLint[] | null | undefined,
  options: GrammarConversionOptions = {},
): LintIssue[] {
  if (!lints || lints.length === 0) return [];

  const lines = options.lines ?? new LineIndex(source);
  const mask = options.mask;
  const counts = new Map<string, number>();
  const issues: LintIssue[] = [];

  for (const lint of lints) {
    const from = Math.max(0, Math.min(lint.start, source.length));
    const to = Math.max(from, Math.min(lint.end, source.length));
    if (to <= from) continue;

    // Harper parses Markdown and skips code itself, but the mask is the one
    // place that decides what counts as prose in this app, so it has the final
    // say for every source of issues alike.
    if (mask && (mask.ignored[from] === 1 || mask.ignored[to - 1] === 1)) continue;

    const match = source.slice(from, to);
    const key = `${lint.kind}|${match.toLowerCase()}`;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);

    issues.push({
      id: `${key}|${nth}`,
      from,
      to,
      line: lines.lineAt(from),
      column: lines.columnAt(from),
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
