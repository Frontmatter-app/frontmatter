export interface UserMetricsData {
  heatmap: { [dateStr: string]: number };
  writingTime: { [dateStr: string]: number };
  focusSessions: {
    totalCount: number;
    avgDurationMin: number;
  };
  focusSessionsDaily?: {
    [dateStr: string]: {
      totalCount: number;
      avgDurationMin: number;
    };
  };
  typingSpeed: {
    avgWpm: number;
    peakWpm: number;
    sampleCount: number;
  };
  hourlyBuckets: { [dateStr: string]: number[] };
  /** Net words added per day, from document word counts. The honest output number. */
  wordsWritten?: { [dateStr: string]: number };
  /** Prose issues the writer actually fixed, per day. */
  issuesResolved?: { [dateStr: string]: number };
  lastSync?: number;
}

export function getEmptyMetrics(): UserMetricsData {
  return {
    heatmap: {},
    writingTime: {},
    focusSessions: { totalCount: 0, avgDurationMin: 0 },
    focusSessionsDaily: {},
    typingSpeed: { avgWpm: 0, peakWpm: 0, sampleCount: 0 },
    hourlyBuckets: {},
    wordsWritten: {},
    issuesResolved: {},
  };
}

/**
 * A document's condition, as a technical writer would grade it.
 *
 * Everything here is a defect a reader would hit or a maintainer would have to
 * fix — not a measure of how hard someone typed. `metricsParser` already knew
 * how to find most of it and had no callers; this is where its output lands.
 */
export interface DocumentHealth {
  id: string;
  title: string;
  words: number;
  stage: string;
  updatedAt: string;
  daysSinceUpdate: number;
  isStale: boolean;
  readabilityGrade: number;
  brokenLinks: number;
  missingAltText: number;
  emptySections: number;
  unclosedFences: number;
  undefinedAcronyms: string[];
  hardSentences: number;
  veryHardSentences: number;
  passives: number;
  adverbs: number;
  inclusiveIssues: number;
  /** Sections a reference doc is expected to carry. */
  completeness: {
    installation: boolean;
    usage: boolean;
    contributing: boolean;
    faq: boolean;
    license: boolean;
  };
  /** Every defect above, summed. What the queue counts. */
  defects: number;
}

/** The whole documentation set, rolled up. */
export interface DocHealthSnapshot {
  documents: number;
  words: number;
  staleDocs: number;
  brokenLinks: number;
  missingAltText: number;
  emptySections: number;
  unclosedFences: number;
  undefinedAcronyms: number;
  hardSentences: number;
  passives: number;
  inclusiveIssues: number;
  /** Median across documents, which a long outlier cannot drag. */
  medianGrade: number;
  docsOverGradeTarget: number;
  reviewOpen: number;
  reviewResolved: number;
  /** Days the oldest unresolved review comment has been waiting. */
  oldestOpenReviewDays: number;
  defects: number;
}

export function getEmptyDocHealth(): DocHealthSnapshot {
  return {
    documents: 0,
    words: 0,
    staleDocs: 0,
    brokenLinks: 0,
    missingAltText: 0,
    emptySections: 0,
    unclosedFences: 0,
    undefinedAcronyms: 0,
    hardSentences: 0,
    passives: 0,
    inclusiveIssues: 0,
    medianGrade: 0,
    docsOverGradeTarget: 0,
    reviewOpen: 0,
    reviewResolved: 0,
    oldestOpenReviewDays: 0,
    defects: 0,
  };
}

/** A document untouched this long is treated as stale. */
export const STALE_AFTER_DAYS = 90;

/**
 * Above this reading grade a doc is flagged.
 *
 * Ten is the usual target for developer documentation: past it, sentence
 * length rather than subject matter is what makes the page hard.
 */
export const GRADE_TARGET = 10;
