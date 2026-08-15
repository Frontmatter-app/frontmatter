import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useSettingsStore } from '../settingsStore';
import { loadLocalMetrics, loadLocalMetricsSync, UserMetricsData } from './metricsSync';
import {
  useHeatmapGrid,
  useActivityInsights,
  useHourlyIntensity,
  heatmapGeometry,
  HEATMAP_WEEKS,
  GRID_LEFT_OFFSET,
} from './metricsCalculation';
import { useElementWidth } from '../../lib/useElementWidth';
import { StatsPanel } from './StatsPanel';
import { DocHealthPanel } from './DocHealthPanel';
import { useDocHealth, type DocHealthState } from './useDocHealth';
import { dayKey, shiftDayKey } from './metricsDates';
import { Calendar, Clock, Flame, Activity } from 'lucide-react';

interface RecentActivityDashboardProps {
  metricsOverride?: UserMetricsData;
  displayNameOverride?: string;
  /**
   * Documentation health describes the workspace, not a person, so it is shown
   * once — on your own dashboard — rather than repeated identically under every
   * teammate's name.
   */
  showDocHealth?: boolean;
  /**
   * A scan the caller already ran. The workspace is the same whichever tab is
   * open, so the modal scans once and hands the result to whoever renders it;
   * without this the team tab and your own tab would each parse every document
   * separately.
   */
  docHealth?: DocHealthState;
  onOpenDocument?: (id: string) => void;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function RecentActivityDashboard({
  metricsOverride,
  displayNameOverride,
  showDocHealth = false,
  docHealth,
  onOpenDocument,
}: RecentActivityDashboardProps) {
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const isDark = settings.themeType.startsWith('github_dark');

  const uid = user?.id || 'guest';

  const [metrics, setMetrics] = useState<UserMetricsData>(() =>
    metricsOverride || loadLocalMetricsSync(uid)
  );

  useEffect(() => {
    if (metricsOverride) {
      setMetrics(metricsOverride);
      return;
    }
    let active = true;
    loadLocalMetrics(uid).then((data) => {
      if (active) setMetrics(data);
    });
    return () => { active = false; };
  }, [uid, metricsOverride]);

  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number; x: number; y: number } | null>(null);

  const { gridCells, columns, monthLabels } = useHeatmapGrid(metrics);

  // Measured on the card, so the grid fills whatever room the modal gives it.
  // Before the first measurement lands, lay out at the widest cell rather than
  // the narrowest — a grid that starts cramped and snaps wider is a visible
  // jump, one that starts wide and settles is not.
  const [heatmapRef, heatmapWidth] = useElementWidth<HTMLDivElement>();
  const geometry = heatmapGeometry(heatmapWidth || 800, columns.length);
  const insights = useActivityInsights(metrics);
  const hourlyIntensity = useHourlyIntensity(metrics);
  // Disabled when the caller supplied a scan, so the hook is still called
  // unconditionally but does no work.
  const ownHealth = useDocHealth(showDocHealth && !docHealth);
  const health = docHealth ?? ownHealth;

  // Sequential ramp: one hue, more-is-darker. Identity plays no part here —
  // a busier day is not a different kind of day.
  const getCellColor = (count: number) => {
    if (count === 0) return isDark ? 'bg-white/5 border border-white/2' : 'bg-black/5 border border-black/2';

    if (isDark) {
      if (count < 3) return 'bg-emerald-950 border border-emerald-900';
      if (count < 6) return 'bg-emerald-800 border border-emerald-700';
      if (count < 10) return 'bg-emerald-600 border border-emerald-500';
      return 'bg-emerald-400 border border-emerald-300';
    }
    if (count < 3) return 'bg-emerald-100 border border-emerald-200';
    if (count < 6) return 'bg-emerald-300 border border-emerald-400';
    if (count < 10) return 'bg-emerald-500 border border-emerald-600';
    return 'bg-emerald-600 border border-emerald-700';
  };

  const todayStr = dayKey();
  const timeTodayStr = formatDuration(metrics.writingTime[todayStr] || 0);

  const weeklyWritingTimeSeconds = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += metrics.writingTime[shiftDayKey(todayStr, -i)] || 0;
    return sum;
  }, [metrics.writingTime, todayStr]);

  const focusSessionsThisWeek = useMemo(() => {
    const daily = metrics.focusSessionsDaily || {};
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += daily[shiftDayKey(todayStr, -i)]?.totalCount || 0;
    return sum;
  }, [metrics.focusSessionsDaily, todayStr]);

  const peakHour = useMemo(() => {
    const best = [...hourlyIntensity].sort((a, b) => b.seconds - a.seconds)[0];
    if (!best || best.seconds === 0) return null;
    const hour12 = best.hour % 12 === 0 ? 12 : best.hour % 12;
    return `${hour12}${best.hour < 12 ? 'am' : 'pm'}`;
  }, [hourlyIntensity]);

  return (
    <div className="flex flex-col gap-6 text-[var(--editor-text-color)] select-none">

      {/* HEADER */}
      <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {displayNameOverride ? `${displayNameOverride}'s writing activity` : 'My writing activity'}
          </h3>
          <p className="text-[11px] opacity-60">
            {displayNameOverride
              ? `Effort and output for ${displayNameOverride} over the last 24 weeks`
              : 'What you wrote, and the condition of what you wrote it into'}
          </p>
        </div>
        {insights.streak > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold">
            <Flame className="w-3 h-3" aria-hidden />
            {insights.streak} day streak
          </div>
        )}
      </div>

      {/* KPI ROW */}
      <StatsPanel
        metrics={metrics}
        timeTodayStr={timeTodayStr}
        weeklyTimeStr={formatDuration(weeklyWritingTimeSeconds)}
        wordsThisWeek={insights.wordsThisWeek}
        wordsLastWeek={insights.wordsLastWeek}
        focusSessionsThisWeek={focusSessionsThisWeek}
      />

      {/* CONSISTENCY HEATMAP */}
      <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl relative overflow-visible">
        <div className="flex items-baseline justify-between mb-3">
          <h4 className="text-xs font-bold flex items-center gap-1.5 opacity-80">
            <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Writing days, last {HEATMAP_WEEKS} weeks
          </h4>
          <span className="text-[9px] opacity-55">
            {insights.activeDays} active days · longest run {insights.bestStreak}
          </span>
        </div>

        <div ref={heatmapRef} className="relative flex flex-col items-start overflow-x-auto py-2">
          {/*
            Absolutely positioned off the same pitch the grid below uses, so a
            label sits over the week it names. Laying this row out as its own
            flex track is what let the two drift apart in the first place.
          */}
          <div
            className="relative h-4 text-[9px] opacity-50 font-medium select-none flex-shrink-0"
            style={{ width: geometry.width }}
            aria-hidden
          >
            {monthLabels.map(({ index, label }) => (
              <span
                key={`${label}-${index}`}
                className="absolute top-0 whitespace-nowrap"
                style={{ left: GRID_LEFT_OFFSET + index * geometry.pitch }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex items-start gap-1">
            <div
              className="flex flex-col text-[9px] opacity-50 font-mono w-5 justify-between pt-0.5 pr-1.5"
              style={{ height: 7 * geometry.pitch - geometry.gap }}
            >
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>

            <div className="flex" style={{ gap: geometry.gap }}>
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col" style={{ gap: geometry.gap }}>
                  {col.map((cell, rowIdx) => (
                    <div
                      key={rowIdx}
                      style={{ width: geometry.cellSize, height: geometry.cellSize }}
                      className={`rounded-[1.5px] transition-colors cursor-pointer ${getCellColor(cell.count)}`}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredCell({
                          date: cell.dateStr,
                          count: cell.count,
                          x: rect.left + window.scrollX - 50,
                          y: rect.top + window.scrollY - 38
                        });
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mt-3 text-[9px] opacity-50 font-medium pt-2 border-t border-black/5 dark:border-white/5">
          {/* The last column runs to the end of the current week, so the range
              is reported up to today rather than to a Saturday still to come. */}
          <span>{gridCells[0]?.dateStr} to {todayStr}</span>
          <div className="flex items-center gap-1">
            <span>Less</span>
            <div className="w-2 h-2 rounded-[1px] bg-black/5 dark:bg-white/5 border border-black/10" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/20" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/50" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/80" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-400" />
            <span>More</span>
          </div>
        </div>

        {hoveredCell && (
          <div
            className="fixed z-50 px-2.5 py-1.5 bg-black/90 dark:bg-white/95 text-white dark:text-black rounded-lg text-[10px] font-bold shadow-md pointer-events-none flex flex-col items-center border border-white/10 dark:border-black/10"
            style={{ left: hoveredCell.x, top: hoveredCell.y }}
          >
            <span>{hoveredCell.count === 0 ? 'No writing' : `${hoveredCell.count} edit bursts`}</span>
            <span className="opacity-70 font-medium text-[8px]">{hoveredCell.date}</span>
          </div>
        )}
      </div>

      {/* WHEN THE WORK HAPPENS */}
      <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl">
        <div className="flex items-baseline justify-between mb-3.5">
          <h4 className="text-xs font-bold flex items-center gap-1.5 opacity-80">
            <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            When you write, last 7 days
          </h4>
          {peakHour && <span className="text-[9px] opacity-55">Most writing around {peakHour}</span>}
        </div>

        <div className="flex items-end h-28 gap-1.5 px-2 pb-1 bg-black/5 dark:bg-white/2 rounded-xl border border-black/5 dark:border-white/5">
          {hourlyIntensity.map(({ hour, pct, seconds }) => {
            const hour12 = hour % 12 === 0 ? 12 : hour % 12;
            return (
              <div
                key={hour}
                className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
                title={`${hour12}${hour < 12 ? 'am' : 'pm'} — ${formatDuration(seconds)}`}
              >
                <div
                  className={`w-full rounded-t-[4px] transition-all duration-300 ${
                    pct > 0
                      ? 'bg-emerald-500 group-hover:bg-emerald-400'
                      : 'bg-black/10 dark:bg-white/10'
                  }`}
                  style={{ height: `${Math.max(pct, 2)}%` }}
                />
              </div>
            );
          })}
        </div>

        <div className="flex justify-between px-2.5 mt-2 text-[9px] opacity-50 font-mono">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>11 PM</span>
        </div>
      </div>

      {/* DOCUMENTATION HEALTH */}
      {showDocHealth && (
        <DocHealthPanel
          snapshot={health.snapshot}
          offenders={health.offenders}
          baseline={health.baseline}
          isDark={isDark}
          loading={health.loading}
          onOpenDocument={onOpenDocument}
        />
      )}
    </div>
  );
}
