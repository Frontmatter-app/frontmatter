/**
 * Daily snapshots of the documentation set, so health has a trend and not just
 * a current value.
 *
 * "Seven broken links" on its own does not tell a writer whether the week went
 * well. "Seven, down from nineteen" does, and the difference between those two
 * dashboards is one row per day.
 *
 * Snapshots are per workspace, not per user, and live only in SQLite. They are
 * deliberately not synced to Firestore: the roll-up describes files a
 * teammate may not be able to read, and the cloud copy would be a second
 * source of truth for something the workspace database already knows.
 */

import { invoke, isWebPreview } from "../../filesystem/tauriCommands";
import type { DocHealthRow } from "../../ipc/generated";
import { dayKey, shiftDayKey } from "./metricsDates";
import { getEmptyDocHealth, type DocHealthSnapshot } from "./metricsTypes";

export interface DatedDocHealth extends DocHealthSnapshot {
  date: string;
}

function toRow(date: string, snapshot: DocHealthSnapshot): DocHealthRow {
  return {
    date,
    documents: snapshot.documents,
    words: snapshot.words,
    stale_docs: snapshot.staleDocs,
    broken_links: snapshot.brokenLinks,
    missing_alt_text: snapshot.missingAltText,
    empty_sections: snapshot.emptySections,
    unclosed_fences: snapshot.unclosedFences,
    undefined_acronyms: snapshot.undefinedAcronyms,
    hard_sentences: snapshot.hardSentences,
    passives: snapshot.passives,
    inclusive_issues: snapshot.inclusiveIssues,
    median_grade: snapshot.medianGrade,
    docs_over_grade_target: snapshot.docsOverGradeTarget,
    review_open: snapshot.reviewOpen,
    review_resolved: snapshot.reviewResolved,
    oldest_open_review_days: snapshot.oldestOpenReviewDays,
    defects: snapshot.defects,
  };
}

function fromRow(row: DocHealthRow): DatedDocHealth {
  return {
    date: row.date,
    documents: row.documents,
    words: row.words,
    staleDocs: row.stale_docs,
    brokenLinks: row.broken_links,
    missingAltText: row.missing_alt_text,
    emptySections: row.empty_sections,
    unclosedFences: row.unclosed_fences,
    undefinedAcronyms: row.undefined_acronyms,
    hardSentences: row.hard_sentences,
    passives: row.passives,
    inclusiveIssues: row.inclusive_issues,
    medianGrade: row.median_grade,
    docsOverGradeTarget: row.docs_over_grade_target,
    reviewOpen: row.review_open,
    reviewResolved: row.review_resolved,
    oldestOpenReviewDays: row.oldest_open_review_days,
    defects: row.defects,
  };
}

/** Overwrites today's row. Scanning twice in a day is not two days of history. */
export async function saveDocHealthSnapshot(snapshot: DocHealthSnapshot): Promise<void> {
  if (isWebPreview) return;
  try {
    await invoke<void>("save_doc_health_daily", { args: { snapshot: toRow(dayKey(), snapshot) } });
  } catch (e) {
    console.error("[Metrics] Failed to save doc health snapshot:", e);
  }
}

export async function loadDocHealthHistory(days = 90): Promise<DatedDocHealth[]> {
  if (isWebPreview) return [];
  const today = dayKey();
  try {
    const rows = await invoke<DocHealthRow[]>("get_doc_health_range", {
      args: { start_date: shiftDayKey(today, -(days - 1)), end_date: today },
    });
    return (rows || []).map(fromRow);
  } catch (e) {
    console.error("[Metrics] Failed to load doc health history:", e);
    return [];
  }
}

export async function loadReviewBacklog(): Promise<{
  open: number;
  resolved: number;
  oldestOpenDays: number;
}> {
  if (isWebPreview) return { open: 0, resolved: 0, oldestOpenDays: 0 };
  try {
    const row = await invoke<{ open: number; resolved: number; oldest_open_days: number }>(
      "get_review_backlog",
    );
    return {
      open: row?.open ?? 0,
      resolved: row?.resolved ?? 0,
      oldestOpenDays: row?.oldest_open_days ?? 0,
    };
  } catch (e) {
    console.error("[Metrics] Failed to load review backlog:", e);
    return { open: 0, resolved: 0, oldestOpenDays: 0 };
  }
}

/**
 * The same snapshot as of `days` ago, for a change figure.
 *
 * Returns the oldest row within the window rather than the row on the exact
 * day, because a workspace nobody opened on that date has no row and a missing
 * comparison would silently render as "no change".
 */
export function baselineFor(history: DatedDocHealth[], days: number): DatedDocHealth | null {
  if (history.length === 0) return null;
  const cutoff = shiftDayKey(dayKey(), -days);
  const withinWindow = history.filter((entry) => entry.date >= cutoff);
  const candidates = withinWindow.length > 0 ? withinWindow : history;
  return candidates[0] ?? null;
}

export function emptyDatedHealth(): DatedDocHealth {
  return { date: dayKey(), ...getEmptyDocHealth() };
}
