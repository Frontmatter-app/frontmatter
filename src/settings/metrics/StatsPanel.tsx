import React from 'react';
import { Clock, Zap, PenLine, Gauge, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { UserMetricsData } from './metricsTypes';

/**
 * The stat tile contract: a label, a value, and a delta against a *named*
 * period.
 *
 * The old tiles had a label and a value and a second number underneath with no
 * stated period — "Average: 24 mins", "Peak Speed: 180 WPM" — so there was no
 * way to tell a good week from a bad one. A number with nothing to compare it
 * to is decoration.
 *
 * Values wear text tokens rather than the tile's hue. The icon beside the
 * label carries whatever colour identity the tile needs; a coloured number
 * beside a coloured label beside a coloured icon just makes the panel loud.
 */

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Signed change, already computed. Omit when there is nothing to compare to. */
  delta?: { value: number; unit: string; period: string; upIsGood: boolean };
  footnote?: string;
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  if (Math.abs(value) >= 1_000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

function StatTile({ icon, label, value, delta, footnote }: StatTileProps) {
  const direction = !delta || delta.value === 0 ? 'flat' : delta.value > 0 ? 'up' : 'down';
  const isGood = direction === 'flat' ? null : (direction === 'up') === delta!.upIsGood;

  const deltaClass =
    isGood === null
      ? 'opacity-55'
      : isGood
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-red-700 dark:text-red-400';

  const DeltaIcon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;

  return (
    <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 opacity-70">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {delta ? (
        <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium flex items-center gap-1">
          <DeltaIcon className={`w-3 h-3 flex-shrink-0 ${deltaClass}`} aria-hidden />
          <span className={`font-bold ${deltaClass}`}>
            {direction === 'flat'
              ? 'No change'
              : `${delta.value > 0 ? '+' : '−'}${formatCompact(Math.abs(delta.value))}${delta.unit}`}
          </span>
          <span className="opacity-60">{delta.period}</span>
        </div>
      ) : (
        <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium opacity-60">
          {footnote || 'No comparison yet'}
        </div>
      )}
    </div>
  );
}

interface StatsPanelProps {
  metrics: UserMetricsData;
  timeTodayStr: string;
  weeklyTimeStr: string;
  wordsThisWeek: number;
  wordsLastWeek: number;
  focusSessionsThisWeek: number;
}

export function StatsPanel({
  metrics,
  timeTodayStr,
  weeklyTimeStr,
  wordsThisWeek,
  wordsLastWeek,
  focusSessionsThisWeek,
}: StatsPanelProps) {
  const hasSpeedSample = metrics.typingSpeed.sampleCount > 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
      <StatTile
        icon={<PenLine className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        label="Words written"
        value={formatCompact(wordsThisWeek)}
        delta={
          wordsLastWeek > 0
            ? {
                value: wordsThisWeek - wordsLastWeek,
                unit: '',
                period: 'vs last week',
                upIsGood: true,
              }
            : undefined
        }
        footnote="Net of deletions, last 7 days"
      />

      <StatTile
        icon={<Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        label="Writing time"
        value={timeTodayStr}
        footnote={`${weeklyTimeStr} in the last 7 days`}
      />

      <StatTile
        icon={<Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        label="Focus sessions"
        value={String(focusSessionsThisWeek)}
        footnote={
          metrics.focusSessions.totalCount > 0
            ? `${metrics.focusSessions.avgDurationMin} min average · ${metrics.focusSessions.totalCount} all time`
            : 'Blocks of 10+ minutes, last 7 days'
        }
      />

      <StatTile
        icon={<Gauge className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        label="Typing speed"
        value={hasSpeedSample ? `${metrics.typingSpeed.avgWpm} WPM` : '—'}
        footnote={
          hasSpeedSample
            ? `Peak ${metrics.typingSpeed.peakWpm} · ${metrics.typingSpeed.sampleCount} sustained bursts`
            : 'Needs a sustained burst to measure'
        }
      />
    </div>
  );
}
