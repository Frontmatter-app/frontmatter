import { useMemo } from 'react';
import { UserMetricsData } from './metricsTypes';
import { dayKey, dayOfWeek, fromDayKey, shiftDayKey } from './metricsDates';

/**
 * A year, so the grid can fill the width it is given.
 *
 * It was 24 weeks. At a readable cell size that is about 315px of grid inside
 * an 800px card — 39% of the width, with the rest blank. The shortfall is not
 * fixable by scaling the cells: filling 800px with 24 columns needs a 33px
 * pitch, at which point the squares are large enough to read as a calendar
 * rather than a density plot. Fifty-two columns fill the same space at a 14px
 * pitch, and a year is the range everyone already expects from this chart.
 */
export const HEATMAP_WEEKS = 52;

/** Constant regardless of cell size; the gap is a separator, not a proportion. */
export const CELL_GAP = 3;

/** The day-name gutter: `w-5` + `pr-1.5`, then the `gap-1` before the grid. */
export const GRID_LEFT_OFFSET = 30;

/** Below this the cells stop reading as distinct; above it they stop reading as a heatmap. */
export const MIN_CELL_SIZE = 7;
export const MAX_CELL_SIZE = 13;

export interface HeatmapGeometry {
  cellSize: number;
  gap: number;
  pitch: number;
  width: number;
}

/**
 * Picks a cell size that fills the available width, and the pitch that follows
 * from it.
 *
 * One function, so the month labels above the grid and the grid itself cannot
 * disagree about how wide a week is. They did disagree: the labels were laid
 * out at a 23.5px pitch (a 12px box plus an 11.5px gap) over a grid with a
 * 12px pitch, so the label strip came out nearly twice the width of the thing
 * it labelled and the last label standing over the heatmap was three months
 * behind its right edge.
 *
 * Returns a width larger than `availableWidth` when the container is too
 * narrow even at the minimum cell size. That is deliberate — the grid scrolls
 * rather than dropping weeks, so the range on screen always means the same
 * thing.
 */
export function heatmapGeometry(
  availableWidth: number,
  weeks: number = HEATMAP_WEEKS,
): HeatmapGeometry {
  const usable = Math.max(0, availableWidth - GRID_LEFT_OFFSET);
  // `weeks` columns of (cell + gap), less the gap that would trail the last one.
  const exact = (usable + CELL_GAP) / weeks - CELL_GAP;
  const cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Math.floor(exact)));
  const pitch = cellSize + CELL_GAP;
  return {
    cellSize,
    gap: CELL_GAP,
    pitch,
    width: GRID_LEFT_OFFSET + weeks * pitch - CELL_GAP,
  };
}

export function useHeatmapGrid(metrics: UserMetricsData) {
  return useMemo(() => {
    const cells: { dateStr: string; count: number; dayOfWeek: number; monthLabel: string }[] = [];
    const today = new Date();

    // The Sunday that starts the current week, then back to the first week
    // shown. Counting back a full 24 weeks *and* the current day-of-week left
    // the last column a week in the past, so the grid stopped before today and
    // this week's writing had nowhere to appear.
    const startSunday = new Date(today);
    startSunday.setDate(today.getDate() - today.getDay() - (HEATMAP_WEEKS - 1) * 7);

    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
      const cellDate = new Date(startSunday);
      cellDate.setDate(startSunday.getDate() + i);
      const dateStr = dayKey(cellDate);
      const count = metrics.heatmap[dateStr] || 0;

      const monthLabel =
        cellDate.getDate() === 1 ? cellDate.toLocaleString('default', { month: 'short' }) : '';

      cells.push({
        dateStr,
        count,
        dayOfWeek: cellDate.getDay(),
        monthLabel
      });
    }

    // Group cells by column (week)
    const cols: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      cols.push(cells.slice(i, i + 7));
    }

    // One label per column, positioned by column index. A label is drawn where
    // a month actually starts; the first column no longer gets one just for
    // being first, because when the range opened a few days before the 1st the
    // two labels landed side by side and overlapped — a month name is wider
    // than the column it sits on.
    const monthLabels = cols
      .map((col, index) => ({ index, label: col.find((cell) => cell.monthLabel)?.monthLabel ?? '' }))
      .filter((entry) => entry.label !== '');

    return { gridCells: cells, columns: cols, monthLabels };
  }, [metrics.heatmap]);
}

export interface ActivityInsights {
  streak: number;
  bestStreak: number;
  peakDay: string | null;
  recentEdits: number;
  isActive: boolean;
  totalEdits: number;
  activeDays: number;
  lastActive: string | null;
  wordsThisWeek: number;
  wordsLastWeek: number;
  issuesResolvedThisWeek: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Walks calendar days, not stored days.
 *
 * The previous version iterated the keys that happened to be in the map and
 * compared each to its neighbour, which meant a gap in the data and a gap in
 * the writing were indistinguishable. It also assigned `streak` only when the
 * loop index was the last one — the first iteration — so the current streak
 * was whatever the most recent day alone implied, and never grew past one.
 *
 * Counting backwards from today over real dates removes both problems, and it
 * lets today be forgiven: a streak is still alive until the day it was last
 * fed has passed, or nobody could look at the dashboard on a morning before
 * they had started writing without watching it read zero.
 */
export function computeStreaks(
  heatmap: { [dateStr: string]: number },
  today: string = dayKey(),
): { streak: number; bestStreak: number } {
  const keys = Object.keys(heatmap).filter((key) => (heatmap[key] || 0) > 0).sort();
  if (keys.length === 0) return { streak: 0, bestStreak: 0 };

  const active = new Set(keys);

  let streak = 0;
  let cursor = active.has(today) ? today : shiftDayKey(today, -1);
  while (active.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  let bestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of keys) {
    const consecutive =
      previous !== null &&
      Math.round((fromDayKey(key).getTime() - fromDayKey(previous).getTime()) / 86_400_000) === 1;
    run = consecutive ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    previous = key;
  }

  return { streak, bestStreak: Math.max(bestStreak, streak) };
}

function sumWindow(series: { [dateStr: string]: number } | undefined, from: string, to: string): number {
  if (!series) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(series)) {
    if (key >= from && key <= to) total += value || 0;
  }
  return total;
}

export function useActivityInsights(metrics: UserMetricsData): ActivityInsights {
  return useMemo(() => {
    const today = dayKey();
    const dates = Object.keys(metrics.heatmap).sort();

    const thisWeekStart = shiftDayKey(today, -6);
    const lastWeekStart = shiftDayKey(today, -13);
    const lastWeekEnd = shiftDayKey(today, -7);

    const wordsThisWeek = sumWindow(metrics.wordsWritten, thisWeekStart, today);
    const wordsLastWeek = sumWindow(metrics.wordsWritten, lastWeekStart, lastWeekEnd);
    const issuesResolvedThisWeek = sumWindow(metrics.issuesResolved, thisWeekStart, today);

    if (dates.length === 0) {
      return {
        streak: 0,
        bestStreak: 0,
        peakDay: null,
        recentEdits: 0,
        isActive: false,
        totalEdits: 0,
        activeDays: 0,
        lastActive: null,
        wordsThisWeek,
        wordsLastWeek,
        issuesResolvedThisWeek,
      };
    }

    let totalEdits = 0;
    let activeDays = 0;
    let recentEdits = 0;
    let lastActive: string | null = null;
    const dayTotals: { [dow: number]: number } = {};

    for (const date of dates) {
      const count = metrics.heatmap[date] || 0;
      totalEdits += count;
      if (count > 0) {
        activeDays += 1;
        lastActive = date;
        const dow = dayOfWeek(date);
        dayTotals[dow] = (dayTotals[dow] || 0) + count;
      }
      if (date >= thisWeekStart && date <= today) recentEdits += count;
    }

    const { streak, bestStreak } = computeStreaks(metrics.heatmap, today);

    const peakDayNum = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
    const peakDay = peakDayNum !== undefined ? DAY_NAMES[Number(peakDayNum)] : null;

    return {
      streak,
      bestStreak,
      peakDay,
      recentEdits,
      isActive: totalEdits > 0,
      totalEdits,
      activeDays,
      lastActive,
      wordsThisWeek,
      wordsLastWeek,
      issuesResolvedThisWeek,
    };
  }, [metrics.heatmap, metrics.wordsWritten, metrics.issuesResolved]);
}

export function useHourlyIntensity(metrics: UserMetricsData) {
  return useMemo(() => {
    const hours: { hour: number; pct: number; seconds: number }[] = Array.from(
      { length: 24 },
      (_, h) => ({ hour: h, pct: 0, seconds: 0 }),
    );

    if (!metrics.hourlyBuckets) return hours;

    const today = dayKey();
    const dayTotals = new Array(24).fill(0);

    for (let d = 0; d < 7; d++) {
      const buckets = metrics.hourlyBuckets[shiftDayKey(today, -d)];
      if (buckets && buckets.length === 24) {
        for (let h = 0; h < 24; h++) dayTotals[h] += buckets[h];
      }
    }

    const maxTotal = Math.max(...dayTotals, 1);
    for (let h = 0; h < 24; h++) {
      hours[h].seconds = Math.round(dayTotals[h]);
      hours[h].pct = Math.round((dayTotals[h] / maxTotal) * 100);
    }

    return hours;
  }, [metrics.hourlyBuckets]);
}
