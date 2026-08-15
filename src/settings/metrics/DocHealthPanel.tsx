import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileWarning,
  Link2Off,
  ImageOff,
  FileQuestion,
  MessageSquare,
  BookOpen,
} from 'lucide-react';
import {
  GRADE_TARGET,
  STALE_AFTER_DAYS,
  type DocHealthSnapshot,
  type DocumentHealth,
} from './metricsTypes';
import { gradeDefects, gradeReadability, gradeStaleness, statusInk, STATUS, type HealthStatus } from './metricsStatus';
import type { DatedDocHealth } from './docHealthStorage';

/**
 * The half of the dashboard that is about the documentation rather than the
 * person writing it.
 *
 * Every row here is something a reader would hit or a maintainer would have to
 * fix, and every one is actionable — a broken link has a document it is in.
 * That is the difference between this panel and a streak counter.
 */

const StatusIcon: Record<HealthStatus, typeof CheckCircle2> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
};

interface HealthRowProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  status: HealthStatus;
  detail: string;
  isDark: boolean;
  delta?: number;
}

function HealthRow({ icon, label, value, status, detail, isDark, delta }: HealthRowProps) {
  const Icon = StatusIcon[status];
  const ink = statusInk(status, isDark);

  return (
    <div className="flex items-center gap-3 py-2 border-b border-black/5 dark:border-white/5 last:border-b-0">
      <span className="opacity-60 flex-shrink-0">{icon}</span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[11px] font-semibold truncate">{label}</span>
        <span className="text-[9px] opacity-60 truncate">{detail}</span>
      </div>
      {delta !== undefined && delta !== 0 && (
        <span className="text-[9px] font-bold opacity-60 flex-shrink-0 tabular-nums">
          {delta > 0 ? '+' : '−'}
          {Math.abs(delta)}
        </span>
      )}
      <span className="text-sm font-bold flex-shrink-0 tabular-nums">{value}</span>
      {/* Icon + written label, so the state never rests on colour alone. */}
      <span
        className="flex items-center gap-1 text-[9px] font-bold flex-shrink-0 w-[92px] justify-end"
        style={{ color: ink }}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden />
        {STATUS[status].label}
      </span>
    </div>
  );
}

interface DocHealthPanelProps {
  snapshot: DocHealthSnapshot;
  offenders: DocumentHealth[];
  baseline: DatedDocHealth | null;
  isDark: boolean;
  loading: boolean;
  onOpenDocument?: (id: string) => void;
}

export function DocHealthPanel({
  snapshot,
  offenders,
  baseline,
  isDark,
  loading,
  onOpenDocument,
}: DocHealthPanelProps) {
  if (loading) {
    return (
      <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl text-center text-xs opacity-60">
        Scanning documents…
      </div>
    );
  }

  if (snapshot.documents === 0) {
    return (
      <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col items-center gap-2">
        <BookOpen className="w-6 h-6 opacity-40" aria-hidden />
        <p className="text-xs font-bold opacity-80">No documents to analyse yet</p>
        <p className="text-[11px] opacity-60 text-center max-w-xs">
          Once this workspace has written pages, this panel reports what is stale, what is broken,
          and how hard the prose is to read.
        </p>
      </div>
    );
  }

  const delta = (current: number, previous: number | undefined) =>
    baseline && previous !== undefined ? current - previous : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl">
        <div className="flex items-baseline justify-between mb-1">
          <h4 className="text-xs font-bold flex items-center gap-1.5 opacity-80">
            <FileWarning className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Documentation health
          </h4>
          <span className="text-[9px] opacity-55">
            {snapshot.documents} documents · {snapshot.words.toLocaleString()} words
            {baseline ? ` · change vs ${baseline.date}` : ''}
          </span>
        </div>

        <div className="flex flex-col">
          <HealthRow
            isDark={isDark}
            icon={<FileQuestion className="w-3.5 h-3.5" aria-hidden />}
            label="Stale documents"
            detail={`Untouched for ${STALE_AFTER_DAYS}+ days`}
            value={snapshot.staleDocs}
            delta={delta(snapshot.staleDocs, baseline?.staleDocs)}
            status={gradeStaleness(snapshot.staleDocs, snapshot.documents)}
          />
          <HealthRow
            isDark={isDark}
            icon={<Link2Off className="w-3.5 h-3.5" aria-hidden />}
            label="Broken links"
            detail="Empty, placeholder or localhost targets"
            value={snapshot.brokenLinks}
            delta={delta(snapshot.brokenLinks, baseline?.brokenLinks)}
            status={gradeDefects(snapshot.brokenLinks, 1, 10)}
          />
          <HealthRow
            isDark={isDark}
            icon={<ImageOff className="w-3.5 h-3.5" aria-hidden />}
            label="Images without alt text"
            detail="Unreadable to screen readers"
            value={snapshot.missingAltText}
            delta={delta(snapshot.missingAltText, baseline?.missingAltText)}
            status={gradeDefects(snapshot.missingAltText, 1, 10)}
          />
          <HealthRow
            isDark={isDark}
            icon={<FileQuestion className="w-3.5 h-3.5" aria-hidden />}
            label="Empty sections"
            detail="Headings with nothing under them"
            value={snapshot.emptySections}
            delta={delta(snapshot.emptySections, baseline?.emptySections)}
            status={gradeDefects(snapshot.emptySections, 1, 8)}
          />
          <HealthRow
            isDark={isDark}
            icon={<BookOpen className="w-3.5 h-3.5" aria-hidden />}
            label="Median reading grade"
            detail={`Target is grade ${GRADE_TARGET} or below · ${snapshot.docsOverGradeTarget} over`}
            value={snapshot.medianGrade || '—'}
            status={gradeReadability(snapshot.medianGrade, GRADE_TARGET)}
          />
          <HealthRow
            isDark={isDark}
            icon={<FileQuestion className="w-3.5 h-3.5" aria-hidden />}
            label="Undefined acronyms"
            detail="Used without being expanded anywhere"
            value={snapshot.undefinedAcronyms}
            status={gradeDefects(snapshot.undefinedAcronyms, 3, 15)}
          />
          <HealthRow
            isDark={isDark}
            icon={<MessageSquare className="w-3.5 h-3.5" aria-hidden />}
            label="Open review comments"
            detail={
              snapshot.oldestOpenReviewDays > 0
                ? `Oldest waiting ${snapshot.oldestOpenReviewDays} days · ${snapshot.reviewResolved} resolved`
                : `${snapshot.reviewResolved} resolved`
            }
            value={snapshot.reviewOpen}
            status={gradeDefects(snapshot.reviewOpen, 1, 15)}
          />
        </div>
      </div>

      {offenders.length > 0 && (
        <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl">
          <h4 className="text-xs font-bold mb-2.5 flex items-center gap-1.5 opacity-80">
            <AlertTriangle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Worth an afternoon
          </h4>
          <div className="flex flex-col gap-1">
            {offenders.map((doc) => {
              const status = gradeDefects(doc.defects, 1, 8);
              const Icon = StatusIcon[status];
              const parts = [
                doc.brokenLinks > 0 && `${doc.brokenLinks} broken`,
                doc.missingAltText > 0 && `${doc.missingAltText} no alt`,
                doc.emptySections > 0 && `${doc.emptySections} empty`,
                doc.unclosedFences > 0 && `${doc.unclosedFences} unclosed fence`,
                doc.inclusiveIssues > 0 && `${doc.inclusiveIssues} inclusive`,
                doc.veryHardSentences > 0 && `${doc.veryHardSentences} very hard`,
                doc.isStale && `stale ${doc.daysSinceUpdate}d`,
              ].filter(Boolean);

              return (
                <button
                  key={doc.id}
                  onClick={() => onOpenDocument?.(doc.id)}
                  disabled={!onOpenDocument}
                  className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-lg text-left transition enabled:hover:bg-black/5 enabled:dark:hover:bg-white/5 enabled:cursor-pointer disabled:cursor-default"
                >
                  <Icon
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: statusInk(status, isDark) }}
                    aria-hidden
                  />
                  <span className="text-[11px] font-semibold truncate flex-1">{doc.title}</span>
                  <span className="text-[9px] opacity-60 truncate hidden sm:block">
                    {parts.join(' · ')}
                  </span>
                  <span className="text-[10px] font-bold tabular-nums flex-shrink-0">
                    {doc.defects}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[9px] opacity-50 mt-2">
            Ranked by defect count, then by how long since anyone touched the page.
          </p>
        </div>
      )}
    </div>
  );
}
