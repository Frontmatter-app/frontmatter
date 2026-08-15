/**
 * The one shape every prose issue takes once it reaches the UI.
 *
 * The old pipeline passed a linter's own output all the way to the
 * decorations, so every consumer had to re-derive a document range from a
 * 1-based line plus a span — and each of them did it slightly differently. An
 * issue now carries the absolute range it refers to, resolved once, so the
 * editor and the sidebar cannot disagree about where it points.
 */

export type LintSeverity = "error" | "warning" | "suggestion";

/** Adds the sidebar's own card type, which is not a lint result. */
export type ReviewKind = LintSeverity | "note";

/**
 * What kind of problem this is.
 *
 * Severity drives filtering; category drives colour, because the readability checks give
 * adverbs, passives and complex phrasing three distinct highlights even though
 * all three are equally "just a suggestion".
 */
export type LintCategory =
  | "very-hard"
  | "hard"
  | "passive"
  | "adverb"
  | "complex"
  | "inclusive"
  | "grammar";

export interface LintIssue {
  /** Stable across re-scans of unchanged text; what ignore/resolve keys off. */
  id: string;
  /** Absolute document offset, inclusive. */
  from: number;
  /** Absolute document offset, exclusive. */
  to: number;
  /** 1-based, for display only. Never used to compute a range. */
  line: number;
  /** 1-based column, for display only. */
  column: number;
  severity: LintSeverity;
  category: LintCategory;
  rule: string;
  message: string;
  description?: string;
  /** The exact source text this issue covers. */
  match: string;
  /** Concrete rewrites, best first. Empty when the fix is not mechanical. */
  replacements: string[];
  link?: string;
}

export interface LintIgnoreState {
  ignoredItemIds: string[];
  ignoredRules: string[];
  resolvedItemIds: string[];
}

export const EMPTY_IGNORE_STATE: LintIgnoreState = {
  ignoredItemIds: [],
  ignoredRules: [],
  resolvedItemIds: [],
};

const severityRank: Record<LintSeverity, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
};

export function compareIssues(a: LintIssue, b: LintIssue): number {
  return (
    a.from - b.from ||
    a.to - b.to ||
    severityRank[a.severity] - severityRank[b.severity] ||
    a.rule.localeCompare(b.rule) ||
    a.message.localeCompare(b.message)
  );
}

export function addUnique(value: string[], next: string): string[] {
  return value.includes(next) ? value : [...value, next];
}

export function getIssueLocationText(issue: LintIssue): string {
  return `Line ${issue.line}, col ${issue.column}`;
}
