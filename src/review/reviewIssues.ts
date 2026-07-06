import type { ValeAlert } from "../types";
import type { IssueLocation, ParsedDocMetrics } from "../settings/metrics/metricsParser";

export type ReviewKind = "error" | "warning" | "suggestion" | "note";

export interface LintIgnoreState {
  ignoredItemIds: string[];
  ignoredRules: string[];
  resolvedItemIds: string[];
}

interface LineRange {
  line: number;
  from: number;
  to: number;
}

const normalizeSeverity = (severity: string): Exclude<ReviewKind, "note"> => {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "suggestion";
};

const severityOrder: Record<Exclude<ReviewKind, "note">, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
};

const nonActionableRulePrefixes = ["Readability."];

function isActionableLintAlert(alert: ValeAlert): boolean {
  return !nonActionableRulePrefixes.some((prefix) => alert.rule.startsWith(prefix));
}

const alertFromIssue = (
  issue: IssueLocation,
  rule: string,
  message: string,
  severity: "error" | "warning" | "suggestion" = "warning",
): ValeAlert => {
  const match = issue.text || message;
  const start = issue.offset !== undefined ? issue.offset + 1 : 1;
  return {
    line: issue.line + 1,
    span: [start, start + Math.max(1, match.length)],
    message,
    description: match,
    severity,
    match,
    rule,
  };
};

export function buildMetricLintAlerts(metrics: ParsedDocMetrics): ValeAlert[] {
  return [
    ...metrics.longSentences.map((issue) =>
      alertFromIssue(issue, "WriteGood.LongSentence", "Consider shortening this sentence."),
    ),
    ...metrics.passiveVoice.map((issue) =>
      alertFromIssue(issue, "WriteGood.PassiveVoice", "Consider using active voice."),
    ),
    ...metrics.emptySections.map((issue) =>
      alertFromIssue(issue, "Markdown.EmptySection", "Add content to this section.", "suggestion"),
    ),
    ...metrics.unclosedCodeFenceLines.map((issue) =>
      alertFromIssue(issue, "Markdown.UnclosedCodeFence", "Close this code fence.", "error"),
    ),
  ];
}

export function getLintAlertId(alert: ValeAlert): string {
  return [
    alert.rule || "unknown-rule",
    alert.line,
    alert.span?.[0] ?? 0,
    alert.span?.[1] ?? 0,
    alert.match || alert.message,
  ].join("|");
}

export function isLintAlertHidden(alert: ValeAlert, ignoreState: LintIgnoreState): boolean {
  const id = getLintAlertId(alert);
  return (
    ignoreState.ignoredRules.includes(alert.rule) ||
    ignoreState.ignoredItemIds.includes(id) ||
    ignoreState.resolvedItemIds.includes(id)
  );
}

function getIgnoredMarkdownRanges(text: string): LineRange[] {
  const ranges: LineRange[] = [];
  const lines = text.split("\n");
  let inFence = false;

  lines.forEach((lineText, index) => {
    const line = index + 1;
    const fenceMatch = lineText.match(/^\s*(```|~~~)/);

    if (inFence || fenceMatch) {
      ranges.push({ line, from: 1, to: Math.max(2, lineText.length + 1) });
      if (fenceMatch) inFence = !inFence;
      return;
    }

    const inlinePatterns = [
      /`[^`]*`/g,
      /!?\[[^\]]*]\([^)]*\)/g,
    ];

    inlinePatterns.forEach((pattern) => {
      for (const match of lineText.matchAll(pattern)) {
        if (match.index === undefined) continue;
        ranges.push({
          line,
          from: match.index + 1,
          to: match.index + match[0].length + 1,
        });
      }
    });
  });

  return ranges;
}

function alertTouchesRanges(alert: ValeAlert, ranges: LineRange[]): boolean {
  if (ranges.length === 0) return false;

  const start = alert.span?.[0] ?? 1;
  const end = Math.max(start + 1, alert.span?.[1] ?? start + Math.max(1, alert.match?.length || alert.message.length));
  return ranges.some((range) =>
    range.line === alert.line && start < range.to && end > range.from
  );
}

export function sanitizeMarkdownForLint(text: string): string {
  const ignored = getIgnoredMarkdownRanges(text);
  const lines = text.split("\n");

  ignored.forEach((range) => {
    const index = range.line - 1;
    const line = lines[index];
    if (line === undefined) return;
    const from = Math.max(0, range.from - 1);
    const to = Math.min(line.length, range.to - 1);
    lines[index] = `${line.slice(0, from)}${" ".repeat(Math.max(0, to - from))}${line.slice(to)}`;
  });

  return lines.join("\n");
}

export function filterLintAlerts(
  alerts: ValeAlert[],
  ignoreState: LintIgnoreState,
  sourceText = "",
): ValeAlert[] {
  const seen = new Set<string>();
  const ignoredMarkdownRanges = sourceText ? getIgnoredMarkdownRanges(sourceText) : [];

  return alerts.filter((alert) => {
    if (
      !isActionableLintAlert(alert) ||
      isLintAlertHidden(alert, ignoreState) ||
      alertTouchesRanges(alert, ignoredMarkdownRanges)
    ) return false;
    const id = getLintAlertId(alert);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort(compareLintAlerts);
}

export function compareLintAlerts(a: ValeAlert, b: ValeAlert): number {
  const aKind = getLintReviewKind(a);
  const bKind = getLintReviewKind(b);
  return (
    a.line - b.line ||
    (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0) ||
    (a.span?.[1] ?? 0) - (b.span?.[1] ?? 0) ||
    severityOrder[aKind] - severityOrder[bKind] ||
    a.rule.localeCompare(b.rule) ||
    a.message.localeCompare(b.message) ||
    (a.match || "").localeCompare(b.match || "")
  );
}

export function getLintReviewKind(alert: ValeAlert): Exclude<ReviewKind, "note"> {
  return normalizeSeverity(alert.severity);
}

export function addUnique(value: string[], next: string): string[] {
  return value.includes(next) ? value : [...value, next];
}

export function getValeActionText(alert: ValeAlert): string | null {
  const action = alert.action;
  if (!action) return null;

  if (typeof action === "string") return action;
  if (typeof action !== "object") return null;

  const value = action as Record<string, unknown>;
  const name = typeof value.name === "string"
    ? value.name
    : typeof value.Name === "string"
      ? value.Name
      : "Suggestion";
  const params = Array.isArray(value.params)
    ? value.params
    : Array.isArray(value.Params)
      ? value.Params
      : [];
  const paramText = params
    .filter((param): param is string | number => typeof param === "string" || typeof param === "number")
    .map(String)
    .join(", ");

  return paramText ? `${name}: ${paramText}` : name;
}

export function getValeLocationText(alert: ValeAlert): string {
  const start = alert.span?.[0];
  const end = alert.span?.[1];
  return start && end ? `Line ${alert.line}, chars ${start}-${end}` : `Line ${alert.line}`;
}
