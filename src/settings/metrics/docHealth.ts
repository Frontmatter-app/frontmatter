/**
 * What the documentation set is actually like, right now.
 *
 * The activity metrics next door measure a person: how long they typed, how
 * fast, how many days in a row. They cannot tell you whether the docs are any
 * good, and a docs team is judged on the docs. This module answers the other
 * half — how much of the set is stale, what is broken in it, and how hard it
 * is to read.
 *
 * None of the analysis here is new. `metricsParser` has been able to find
 * broken links, missing alt text, empty sections and unclosed fences since it
 * was written, and `review/readability` grades prose for the editor on every
 * keystroke. Neither had ever been pointed at the whole workspace.
 */

import type { DocumentMeta } from "../../types";
import { parseDocumentMetrics } from "./metricsParser";
import { analyzeReadability } from "../../review/readability";
import { analyzeInclusiveLanguage } from "../../review/inclusiveIssues";
import { maskMarkdown, LineIndex } from "../../review/markdownMask";
import { daysSince } from "./metricsDates";
import {
  getEmptyDocHealth,
  GRADE_TARGET,
  STALE_AFTER_DAYS,
  type DocHealthSnapshot,
  type DocumentHealth,
} from "./metricsTypes";

/**
 * Grammar is missing from this on purpose.
 *
 * Harper is a Rust library reached over IPC one document at a time. Scanning a
 * whole workspace through it would take a round trip per document on every
 * open of the dashboard, so the roll-up covers only the checks that are pure
 * functions of the text. A zero would have been cheaper to render and would
 * have read as "no grammar problems", which is not what it would have meant.
 */
export function analyzeDocumentHealth(doc: DocumentMeta, now: Date = new Date()): DocumentHealth {
  const content = doc.content || "";
  const parsed = parseDocumentMetrics(content);

  const mask = maskMarkdown(content);
  const lines = new LineIndex(content);
  const { stats } = analyzeReadability(content, mask);
  const inclusive = analyzeInclusiveLanguage(content, mask, { lines });

  const days = daysSince(doc.updated_at, now);

  const defects =
    parsed.brokenLinksCount +
    parsed.missingAltTextCount +
    parsed.emptySectionsCount +
    parsed.unclosedCodeFences +
    inclusive.length +
    stats.veryHardSentences;

  // An empty `content` means one of two different things: a document that is
  // genuinely blank, or a cloud document whose body has not been fetched into
  // this workspace. Only the second should fall back to the stored count —
  // `parsed.wordCount || doc.word_count` treated them alike, so a blank page
  // reported however many words it used to have, and the roll-up then scored
  // it as a real document with no defects in it.
  const hasText = content.trim().length > 0;
  const words = hasText ? parsed.wordCount : doc.is_cloud ? doc.word_count || 0 : 0;

  return {
    id: doc.id,
    title: doc.title,
    words,
    stage: doc.stage,
    updatedAt: doc.updated_at,
    daysSinceUpdate: days,
    isStale: days >= STALE_AFTER_DAYS,
    readabilityGrade: stats.grade,
    brokenLinks: parsed.brokenLinksCount,
    missingAltText: parsed.missingAltTextCount,
    emptySections: parsed.emptySectionsCount,
    unclosedFences: parsed.unclosedCodeFences,
    undefinedAcronyms: parsed.undefinedAcronyms,
    hardSentences: stats.hardSentences,
    veryHardSentences: stats.veryHardSentences,
    passives: stats.passives,
    adverbs: stats.adverbs,
    inclusiveIssues: inclusive.length,
    completeness: {
      installation: parsed.completeness.installation,
      usage: parsed.completeness.usage,
      contributing: parsed.completeness.contributing,
      faq: parsed.completeness.faq,
      license: parsed.completeness.license,
    },
    defects,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export interface ReviewBacklog {
  open: number;
  resolved: number;
  oldestOpenDays: number;
}

export const EMPTY_BACKLOG: ReviewBacklog = { open: 0, resolved: 0, oldestOpenDays: 0 };

/**
 * Rolls the per-document reports into one snapshot.
 *
 * Empty documents are dropped rather than counted as perfect ones. A workspace
 * of forty stubs would otherwise report a spotless median grade and no
 * defects, which is the most flattering possible reading of having written
 * nothing.
 */
export function summarizeDocHealth(
  reports: DocumentHealth[],
  backlog: ReviewBacklog = EMPTY_BACKLOG,
): DocHealthSnapshot {
  const scored = reports.filter((report) => report.words > 0);
  if (scored.length === 0) {
    return { ...getEmptyDocHealth(), reviewOpen: backlog.open, reviewResolved: backlog.resolved };
  }

  const snapshot = getEmptyDocHealth();
  snapshot.documents = scored.length;

  const acronyms = new Set<string>();
  for (const report of scored) {
    snapshot.words += report.words;
    if (report.isStale) snapshot.staleDocs += 1;
    snapshot.brokenLinks += report.brokenLinks;
    snapshot.missingAltText += report.missingAltText;
    snapshot.emptySections += report.emptySections;
    snapshot.unclosedFences += report.unclosedFences;
    snapshot.hardSentences += report.hardSentences;
    snapshot.passives += report.passives;
    snapshot.inclusiveIssues += report.inclusiveIssues;
    snapshot.defects += report.defects;
    if (report.readabilityGrade > GRADE_TARGET) snapshot.docsOverGradeTarget += 1;
    for (const acronym of report.undefinedAcronyms) acronyms.add(acronym);
  }

  snapshot.undefinedAcronyms = acronyms.size;
  snapshot.medianGrade = median(scored.map((report) => report.readabilityGrade));
  snapshot.reviewOpen = backlog.open;
  snapshot.reviewResolved = backlog.resolved;
  snapshot.oldestOpenReviewDays = backlog.oldestOpenDays;

  return snapshot;
}

/** The documents most worth someone's afternoon, worst first. */
export function worstOffenders(reports: DocumentHealth[], limit = 5): DocumentHealth[] {
  return [...reports]
    .filter((report) => report.words > 0 && (report.defects > 0 || report.isStale))
    .sort((a, b) => b.defects - a.defects || b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, limit);
}

export function analyzeWorkspace(docs: DocumentMeta[], now: Date = new Date()): DocumentHealth[] {
  return docs.map((doc) => analyzeDocumentHealth(doc, now));
}
