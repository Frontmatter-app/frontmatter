import React from 'react';
import { Users, Award, ArrowRight, Info } from 'lucide-react';
import { DocHealthPanel } from './DocHealthPanel';
import type { DocHealthState } from './useDocHealth';
import type { UserMetricsData } from './metricsTypes';
import { dayKey, shiftDayKey } from './metricsDates';

export interface TeamMemberSummary {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  metrics: UserMetricsData | null;
}

/**
 * The team tab, which is about the documentation set first.
 *
 * It used to be a roster of people with typing speed, deep-work session counts
 * and a fourteen-day activity grid each. Read by an owner, that is a
 * productivity ranking built from numbers that do not measure productivity —
 * a fast typist with a stale, broken page outranked a careful writer who fixed
 * one. Worse, the numbers it ranked on were the two least meaningful ones
 * available: keystroke rate and a session count that was always zero.
 *
 * So the shared docs come first, and contributors appear underneath in
 * alphabetical order, described by what they contributed rather than by how
 * hard they worked. There is no sort control; nothing here is a leaderboard.
 */

function contributionSummary(metrics: UserMetricsData | null): {
  activeDays: number;
  words: number;
  lastActive: string | null;
} {
  if (!metrics) return { activeDays: 0, words: 0, lastActive: null };

  const today = dayKey();
  const windowStart = shiftDayKey(today, -29);

  let activeDays = 0;
  let lastActive: string | null = null;
  for (const [date, count] of Object.entries(metrics.heatmap || {})) {
    if (date < windowStart || date > today) continue;
    if ((count || 0) > 0) {
      activeDays += 1;
      if (!lastActive || date > lastActive) lastActive = date;
    }
  }

  let words = 0;
  for (const [date, value] of Object.entries(metrics.wordsWritten || {})) {
    if (date >= windowStart && date <= today) words += value || 0;
  }

  return { activeDays, words: Math.max(0, Math.round(words)), lastActive };
}

function relativeDay(dateStr: string | null): string {
  if (!dateStr) return 'No activity in 30 days';
  const today = dayKey();
  if (dateStr === today) return 'Active today';
  if (dateStr === shiftDayKey(today, -1)) return 'Active yesterday';
  const days = Math.round(
    (new Date(today).getTime() - new Date(dateStr).getTime()) / 86_400_000,
  );
  return `Active ${days} days ago`;
}

interface TeamHealthViewProps {
  health: DocHealthState;
  members: TeamMemberSummary[];
  loadingMembers: boolean;
  isDark: boolean;
  onInspectMember: (member: TeamMemberSummary) => void;
  onOpenDocument?: (id: string) => void;
}

export function TeamHealthView({
  health,
  members,
  loadingMembers,
  isDark,
  onInspectMember,
  onOpenDocument,
}: TeamHealthViewProps) {
  const roster = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="flex flex-col gap-6">
      <div className="pb-2 border-b border-black/5 dark:border-white/5">
        <h3 className="text-sm font-bold opacity-80">Team documentation</h3>
        <p className="text-[11px] opacity-60">
          The condition of the shared docs, and who has been working on them.
        </p>
      </div>

      <DocHealthPanel
        snapshot={health.snapshot}
        offenders={health.offenders}
        baseline={health.baseline}
        isDark={isDark}
        loading={health.loading}
        onOpenDocument={onOpenDocument}
      />

      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-xs font-bold opacity-80 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Contributors, last 30 days
          </h4>
          <p className="text-[10px] opacity-55 mt-0.5 flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden />
            Listed alphabetically. These figures describe contribution, not performance — a
            quiet month on a finished doc set is a good month.
          </p>
        </div>

        {loadingMembers ? (
          <div className="text-center py-10 text-xs opacity-60">Loading team…</div>
        ) : roster.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
            </div>
            <div className="text-center">
              <p className="text-xs font-bold opacity-80">No team members to display</p>
              <p className="text-[11px] opacity-60 mt-1">
                Create or join a team to see who is working on these docs.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {roster.map((member) => {
              const summary = contributionSummary(member.metrics);
              return (
                <div
                  key={member.uid}
                  className="p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  style={{
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
                  }}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold flex items-center gap-1.5 truncate">
                        {member.displayName}
                        {member.role.toLowerCase().includes('owner') && (
                          <Award className="w-3.5 h-3.5 opacity-60 flex-shrink-0" aria-hidden />
                        )}
                      </span>
                      <span className="text-[9px] opacity-55 truncate">{member.email}</span>
                      <span className="text-[9px] opacity-70 mt-0.5">
                        {relativeDay(summary.lastActive)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-5">
                    <div className="flex flex-col">
                      <span className="opacity-55 text-[8px] uppercase font-bold tracking-wider">
                        Words written
                      </span>
                      <span className="font-bold text-sm tabular-nums">
                        {summary.words > 0 ? summary.words.toLocaleString() : '—'}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="opacity-55 text-[8px] uppercase font-bold tracking-wider">
                        Days active
                      </span>
                      <span className="font-bold text-sm tabular-nums">{summary.activeDays}</span>
                    </div>

                    <button
                      onClick={() => onInspectMember(member)}
                      className="cursor-pointer p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center transition border border-black/5 dark:border-white/10"
                      title={`Open ${member.displayName}'s activity`}
                    >
                      <ArrowRight className="w-4 h-4 opacity-70" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
