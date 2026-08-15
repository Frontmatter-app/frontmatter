import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  computeStreaks,
  useHeatmapGrid,
  heatmapGeometry,
  HEATMAP_WEEKS,
  CELL_GAP,
  GRID_LEFT_OFFSET,
  MIN_CELL_SIZE,
  MAX_CELL_SIZE,
} from './metricsCalculation';
import { getEmptyMetrics } from './metricsTypes';
import { dayKey, daysBetween, fromDayKey, shiftDayKey, recentDayKeys } from './metricsDates';

describe('dayKey', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 11pm on the 15th in a zone behind UTC is already the 16th in UTC. The
    // day key has to say the 15th, because that is the evening the writer had.
    const lateEvening = new Date(2026, 7, 15, 23, 30);
    expect(dayKey(lateEvening)).toBe('2026-08-15');
  });

  it('pads single-digit months and days', () => {
    expect(dayKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('round-trips through fromDayKey at local midnight', () => {
    const parsed = fromDayKey('2026-08-15');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(15);
    expect(parsed.getHours()).toBe(0);
  });
});

describe('shiftDayKey', () => {
  it('crosses a month boundary', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses a leap day', () => {
    expect(shiftDayKey('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('agrees with daysBetween', () => {
    expect(daysBetween('2026-08-01', shiftDayKey('2026-08-01', 30))).toBe(30);
  });
});

describe('recentDayKeys', () => {
  it('returns the window oldest first, ending today', () => {
    const keys = recentDayKeys(3, '2026-08-15');
    expect(keys).toEqual(['2026-08-13', '2026-08-14', '2026-08-15']);
  });
});

describe('computeStreaks', () => {
  const today = '2026-08-15';

  it('counts a run ending today', () => {
    const heatmap = {
      '2026-08-13': 4,
      '2026-08-14': 2,
      '2026-08-15': 7,
    };
    expect(computeStreaks(heatmap, today).streak).toBe(3);
  });

  /**
   * The regression this whole rewrite exists for. The old implementation only
   * ever assigned `streak` on the first loop iteration, so a run of any length
   * reported as 1.
   */
  it('counts a long run rather than stopping at one', () => {
    const heatmap: Record<string, number> = {};
    for (let i = 0; i < 12; i += 1) heatmap[shiftDayKey(today, -i)] = 3;
    expect(computeStreaks(heatmap, today).streak).toBe(12);
  });

  it('keeps the streak alive on a morning before any writing', () => {
    // Nothing today yet, but yesterday and the day before count. A dashboard
    // opened over coffee should not claim the streak is already broken.
    const heatmap = {
      '2026-08-13': 5,
      '2026-08-14': 5,
    };
    expect(computeStreaks(heatmap, today).streak).toBe(2);
  });

  it('breaks the streak once a whole day has been missed', () => {
    const heatmap = {
      '2026-08-11': 5,
      '2026-08-12': 5,
      // 13th and 14th missed
    };
    expect(computeStreaks(heatmap, today).streak).toBe(0);
  });

  it('ignores days that are present but empty', () => {
    const heatmap = {
      '2026-08-13': 0,
      '2026-08-14': 4,
      '2026-08-15': 4,
    };
    expect(computeStreaks(heatmap, today).streak).toBe(2);
  });

  it('finds the best run even when it is not the current one', () => {
    const heatmap = {
      '2026-07-01': 1,
      '2026-07-02': 1,
      '2026-07-03': 1,
      '2026-07-04': 1,
      '2026-08-15': 1,
    };
    const { streak, bestStreak } = computeStreaks(heatmap, today);
    expect(streak).toBe(1);
    expect(bestStreak).toBe(4);
  });

  it('reports nothing for an empty heatmap', () => {
    expect(computeStreaks({}, today)).toEqual({ streak: 0, bestStreak: 0 });
  });

  it('never reports a best streak shorter than the current one', () => {
    const heatmap: Record<string, number> = {};
    for (let i = 0; i < 5; i += 1) heatmap[shiftDayKey(today, -i)] = 1;
    const { streak, bestStreak } = computeStreaks(heatmap, today);
    expect(bestStreak).toBeGreaterThanOrEqual(streak);
  });
});

describe('useHeatmapGrid', () => {
  const grid = () => renderHook(() => useHeatmapGrid(getEmptyMetrics())).result.current;

  it('covers the requested number of weeks', () => {
    const { columns, gridCells } = grid();
    expect(columns).toHaveLength(HEATMAP_WEEKS);
    expect(gridCells).toHaveLength(HEATMAP_WEEKS * 7);
  });

  /**
   * The grid used to count back a full 24 weeks *and* the current day-of-week,
   * which left its last column a week in the past — today had no cell, so the
   * current week's writing could not appear anywhere on it.
   */
  it('includes today', () => {
    const { gridCells } = grid();
    expect(gridCells.some((cell) => cell.dateStr === dayKey())).toBe(true);
  });

  it('ends on the Saturday that closes the current week', () => {
    const { gridCells } = grid();
    const last = gridCells[gridCells.length - 1];
    expect(last.dayOfWeek).toBe(6);
    expect(daysBetween(dayKey(), last.dateStr)).toBeLessThan(7);
  });

  it('starts on a Sunday', () => {
    expect(grid().gridCells[0].dayOfWeek).toBe(0);
  });

  it('gives every column exactly seven days', () => {
    for (const col of grid().columns) expect(col).toHaveLength(7);
  });

  /**
   * The label strip and the grid encoded the column pitch separately — 23.5px
   * against 12px — so labels drifted right at nearly double speed and the last
   * one standing over the heatmap was three months behind its right edge.
   * Labels are now placed by column index at this shared pitch.
   */
  it('anchors each month label to a column index inside the grid', () => {
    const { monthLabels, columns } = grid();
    expect(monthLabels.length).toBeGreaterThan(0);
    for (const { index } of monthLabels) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(columns.length);
    }
  });

  it('labels the column that actually contains the first of the month', () => {
    const { monthLabels, columns } = grid();
    for (const { index, label } of monthLabels) {
      const first = columns[index].find((cell) => cell.dateStr.endsWith('-01'));
      expect(first).toBeDefined();
      expect(fromDayKey(first!.dateStr).toLocaleString('default', { month: 'short' })).toBe(label);
    }
  });

  it('never places two labels on the same column', () => {
    const indices = grid().monthLabels.map((entry) => entry.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('spaces labels far enough apart not to overlap', () => {
    // A month name needs roughly 20px. Checked at the narrowest cell the grid
    // will ever use, which is the worst case for collisions.
    const { pitch } = heatmapGeometry(0);
    const { monthLabels } = grid();
    for (let i = 1; i < monthLabels.length; i += 1) {
      const gap = (monthLabels[i].index - monthLabels[i - 1].index) * pitch;
      expect(gap).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('heatmapGeometry', () => {
  /**
   * The grid was a fixed 315px inside an 800px card — 39% of the width, the
   * rest blank — because the cell size was hardcoded and nothing ever asked
   * how much room there was.
   */
  it('fills the width it is given', () => {
    const { width } = heatmapGeometry(800);
    expect(width).toBeLessThanOrEqual(800);
    expect(width).toBeGreaterThan(800 * 0.9);
  });

  it('fills a range of container widths without overflowing', () => {
    // Only above the point where a year of columns fits at the minimum cell
    // size; below it the grid scrolls, which the overflow test covers.
    const narrowest = GRID_LEFT_OFFSET + HEATMAP_WEEKS * (MIN_CELL_SIZE + CELL_GAP) - CELL_GAP;
    for (const available of [narrowest, 640, 700, 800, 900]) {
      const { width } = heatmapGeometry(available);
      expect(width).toBeLessThanOrEqual(available);
    }
  });

  it('keeps the pitch consistent with the cell size and gap', () => {
    const geometry = heatmapGeometry(800);
    expect(geometry.pitch).toBe(geometry.cellSize + geometry.gap);
    expect(geometry.gap).toBe(CELL_GAP);
  });

  it('derives its width from the pitch, less the trailing gap', () => {
    const geometry = heatmapGeometry(800);
    expect(geometry.width).toBe(
      GRID_LEFT_OFFSET + HEATMAP_WEEKS * geometry.pitch - geometry.gap,
    );
  });

  it('never shrinks cells below the legible minimum', () => {
    expect(heatmapGeometry(0).cellSize).toBe(MIN_CELL_SIZE);
    expect(heatmapGeometry(120).cellSize).toBe(MIN_CELL_SIZE);
  });

  it('never grows cells into a calendar', () => {
    expect(heatmapGeometry(4000).cellSize).toBe(MAX_CELL_SIZE);
  });

  it('overflows rather than dropping weeks when the container is too narrow', () => {
    // Scrolling keeps the range on screen meaning the same thing at every size.
    const geometry = heatmapGeometry(200);
    expect(geometry.width).toBeGreaterThan(200);
  });

  it('grows the cell size as the container grows, up to the cap', () => {
    expect(heatmapGeometry(900).cellSize).toBeGreaterThanOrEqual(
      heatmapGeometry(500).cellSize,
    );
  });

  it('honours an explicit column count', () => {
    const geometry = heatmapGeometry(800, 24);
    expect(geometry.width).toBe(GRID_LEFT_OFFSET + 24 * geometry.pitch - geometry.gap);
  });
});
