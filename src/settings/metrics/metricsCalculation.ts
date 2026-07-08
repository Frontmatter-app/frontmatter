import { useMemo } from 'react';
import { UserMetricsData } from './metricsTypes';

export function useHeatmapGrid(metrics: UserMetricsData) {
  return useMemo(() => {
    const cells: { dateStr: string; count: number; dayOfWeek: number; monthLabel: string }[] = [];
    const today = new Date();
    
    // Find the starting Sunday, 24 weeks ago
    const startSunday = new Date(today);
    startSunday.setDate(today.getDate() - (24 * 7) - today.getDay());
    
    for (let i = 0; i < 24 * 7; i++) {
      const cellDate = new Date(startSunday);
      cellDate.setDate(startSunday.getDate() + i);
      const dateStr = cellDate.toISOString().split('T')[0];
      const count = metrics.heatmap[dateStr] || 0;
      
      let monthLabel = '';
      if (cellDate.getDate() === 1 || i === 0) {
        monthLabel = cellDate.toLocaleString('default', { month: 'short' });
      }
      
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

    return { gridCells: cells, columns: cols };
  }, [metrics.heatmap]);
}

export function useActivityInsights(metrics: UserMetricsData) {
  return useMemo(() => {
    const dates = Object.keys(metrics.heatmap).sort();
    if (dates.length === 0) {
      return {
        streak: 0,
        bestStreak: 0,
        peakDay: null as string | null,
        recentEdits: 0,
        isActive: false,
        totalEdits: 0,
        activeDays: 0,
        weekendPercent: 0,
        lastActive: null as string | null,
      };
    }

    const dayOfWeek = (d: string) => new Date(d + 'T00:00:00').getDay();
    const today = new Date().toISOString().split('T')[0];

    let streak = 0;
    let bestStreak = 0;
    let currentRun = 0;
    let recentEdits = 0;
    let totalEdits = 0;
    let activeDays = 0;
    let weekendEdits = 0;
    let weekdayEdits = 0;

    const dayTotals: { [dow: number]: number } = {};

    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      const count = metrics.heatmap[d] || 0;
      totalEdits += count;

      if (count > 0) {
        activeDays++;
        if (i === dates.length - 1 && d === today) {
          streak++;
          currentRun++;
        } else if (i > 0) {
          const prev = dates[i + 1];
          const prevDate = new Date(prev + 'T00:00:00');
          const currDate = new Date(d + 'T00:00:00');
          const dayDiff = Math.round((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
          if (dayDiff === 1) {
            currentRun++;
            if (i === dates.length - 1) streak = currentRun;
          } else {
            currentRun = 1;
            if (i === dates.length - 1) streak = currentRun;
          }
        } else {
          currentRun = 1;
          if (i === dates.length - 1) streak = currentRun;
        }
        bestStreak = Math.max(bestStreak, currentRun);

        const dow = dayOfWeek(d);
        dayTotals[dow] = (dayTotals[dow] || 0) + count;

        if (dow === 0 || dow === 6) {
          weekendEdits += count;
        } else {
          weekdayEdits += count;
        }
      } else {
        currentRun = 0;
      }

      if (i >= dates.length - 7) {
        recentEdits += count;
      }
    }

    const weekendPercent = totalEdits > 0 ? Math.round((weekendEdits / totalEdits) * 100) : 0;
    const peakDayNum = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDay = peakDayNum !== undefined ? dayNames[Number(peakDayNum)] : null;
    const lastActive = dates.length > 0 ? dates[dates.length - 1] : null;

    return {
      streak,
      bestStreak,
      peakDay,
      recentEdits,
      isActive: totalEdits > 0,
      totalEdits,
      activeDays,
      weekendPercent,
      lastActive,
    };
  }, [metrics.heatmap]);
}

export function useHourlyIntensity(metrics: UserMetricsData) {
  return useMemo(() => {
    const hours: { hour: number; pct: number }[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, pct: 0 }));

    if (!metrics.hourlyBuckets) return hours;

    const today = new Date();
    const dayTotals = new Array(24).fill(0);

    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const buckets = metrics.hourlyBuckets[dateStr];
      if (buckets && buckets.length === 24) {
        for (let h = 0; h < 24; h++) {
          dayTotals[h] += buckets[h];
        }
      }
    }

    const maxTotal = Math.max(...dayTotals, 1);
    for (let h = 0; h < 24; h++) {
      hours[h].pct = Math.round((dayTotals[h] / maxTotal) * 100);
    }

    return hours;
  }, [metrics.hourlyBuckets]);
}
