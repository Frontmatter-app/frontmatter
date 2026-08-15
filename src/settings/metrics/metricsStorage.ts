import { invoke, isWebPreview } from '../../filesystem/tauriCommands';
import { UserMetricsData, getEmptyMetrics } from './metricsTypes';
import { dayKey, shiftDayKey } from './metricsDates';
import { HEATMAP_WEEKS } from './metricsCalculation';

// Load from localStorage (synchronous fallback used for instant renders)
export function loadMetricsFromLocalStorage(uid: string): UserMetricsData {
  try {
    const raw = localStorage.getItem(`frontmatter_metrics_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserMetricsData>;
      return {
        heatmap: parsed.heatmap || {},
        writingTime: parsed.writingTime || {},
        focusSessions: {
          totalCount: parsed.focusSessions?.totalCount || 0,
          avgDurationMin: parsed.focusSessions?.avgDurationMin || 0,
        },
        focusSessionsDaily: parsed.focusSessionsDaily || {},
        typingSpeed: {
          avgWpm: parsed.typingSpeed?.avgWpm || 0,
          peakWpm: parsed.typingSpeed?.peakWpm || 0,
          sampleCount: parsed.typingSpeed?.sampleCount || 0,
        },
        hourlyBuckets: parsed.hourlyBuckets || {},
        wordsWritten: parsed.wordsWritten || {},
        issuesResolved: parsed.issuesResolved || {},
      };
    }
  } catch (e) {
    console.error('Failed to load metrics from localStorage:', e);
  }
  return getEmptyMetrics();
}

// Persist metrics to localStorage (synchronous cache for instant UI)
export function persistToLocalStorage(uid: string, data: UserMetricsData) {
  try {
    localStorage.setItem(`frontmatter_metrics_${uid}`, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to write metrics to localStorage cache:', e);
  }
}

// Load metrics from SQLite via Tauri backend (primary source of truth)
export async function loadMetricsFromSqlite(uid: string): Promise<UserMetricsData> {
  // Wide enough to cover every cell the heatmap draws, plus the partial week
  // at each end. This was 169 days against a 24-week grid; once the grid shows
  // a year, a short window would render the older half as blanks that look
  // exactly like days nobody wrote on.
  const today = new Date();
  const startStr = shiftDayKey(dayKey(today), -(HEATMAP_WEEKS * 7 + 7));
  const endStr = dayKey(today);

  try {
    const rows = await invoke<
      {
        date: string;
        edits: number;
        writing_time_seconds: number;
        hourly_buckets: string;
        focus_sessions_total: number;
        focus_sessions_avg_min: number;
        avg_wpm: number;
        peak_wpm: number;
        wpm_sample_count: number;
        words_written: number;
        issues_resolved: number;
      }[]
    >('get_metrics_date_range', {
      args: {
        uid,
        start_date: startStr,
        end_date: endStr,
      },
    });

    if (!rows || rows.length === 0) {
      return getEmptyMetrics();
    }

    const heatmap: { [dateStr: string]: number } = {};
    const writingTime: { [dateStr: string]: number } = {};
    const hourlyBuckets: { [dateStr: string]: number[] } = {};
    const wordsWritten: { [dateStr: string]: number } = {};
    const issuesResolved: { [dateStr: string]: number } = {};
    const focusSessionsDaily: { [dateStr: string]: { totalCount: number; avgDurationMin: number } } = {};
    let totalFocus = 0;
    let focusCnt = 0;
    let totalWpmNumerator = 0;
    let peakWpm = 0;

    for (const row of rows) {
      heatmap[row.date] = row.edits;
      writingTime[row.date] = row.writing_time_seconds;
      hourlyBuckets[row.date] = JSON.parse(row.hourly_buckets || '[]');
      wordsWritten[row.date] = row.words_written || 0;
      issuesResolved[row.date] = row.issues_resolved || 0;

      if (row.focus_sessions_total > 0) {
        focusSessionsDaily[row.date] = {
          totalCount: row.focus_sessions_total,
          avgDurationMin: row.focus_sessions_avg_min,
        };
        totalFocus += row.focus_sessions_avg_min * row.focus_sessions_total;
        focusCnt += row.focus_sessions_total;
      }
      totalWpmNumerator += row.avg_wpm * row.wpm_sample_count;
      if (row.peak_wpm > peakWpm) peakWpm = row.peak_wpm;
    }

    const totalSampleCount = rows.reduce((sum, r) => sum + r.wpm_sample_count, 0);
    const avgWpm = totalSampleCount > 0 ? Math.round(totalWpmNumerator / totalSampleCount) : 0;

    return {
      heatmap,
      writingTime,
      focusSessions: {
        totalCount: focusCnt,
        avgDurationMin: focusCnt > 0 ? Math.round(totalFocus / focusCnt) : 0,
      },
      focusSessionsDaily,
      typingSpeed: { avgWpm, peakWpm, sampleCount: totalSampleCount },
      hourlyBuckets,
      wordsWritten,
      issuesResolved,
    };
  } catch (e) {
    console.error('Failed to load metrics from SQLite:', e);
    return getEmptyMetrics();
  }
}

// Fix hourly buckets that were stored with buggy dateStr-hour keys (e.g. "2024-01-15-14")
export function fixHourlyBuckets(data: UserMetricsData): UserMetricsData {
  const { hourlyBuckets } = data;
  const fixed: { [dateStr: string]: number[] } = {};

  for (const key of Object.keys(hourlyBuckets)) {
    const match = key.match(/^(\d{4}-\d{2}-\d{2})-\d{1,2}$/);
    if (match) {
      const dateStr = match[1];
      const arr = hourlyBuckets[key];
      if (!Array.isArray(arr)) continue;
      if (!fixed[dateStr]) fixed[dateStr] = new Array(24).fill(0);
      for (let i = 0; i < Math.min(arr.length, 24); i++) {
        fixed[dateStr][i] += (arr[i] || 0);
      }
    } else {
      fixed[key] = hourlyBuckets[key];
    }
  }

  return { ...data, hourlyBuckets: fixed };
}

let _migrated = false;

// One-time migration from localStorage to SQLite (fixes the hourly bucket key bug)
export async function migrateLocalStorageToSqlite(uid: string): Promise<void> {
  if (_migrated || isWebPreview || !uid) return;
  _migrated = true;

  try {
    const raw = localStorage.getItem(`frontmatter_metrics_${uid}`);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Partial<UserMetricsData>;
    if (!parsed.heatmap || Object.keys(parsed.heatmap).length === 0) return;

    const needsFix = Object.keys(parsed.hourlyBuckets || {}).some(
      k => /^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(k)
    );
    const data = needsFix ? fixHourlyBuckets(parsed as UserMetricsData) : (parsed as UserMetricsData);

    const sqliteData = await loadMetricsFromSqlite(uid);
    if (Object.keys(data.heatmap).length > Object.keys(sqliteData.heatmap).length) {
      console.log(`[Metrics] Migrating ${Object.keys(data.heatmap).length} days from localStorage`);
      if (!isWebPreview) {
        const dates = Object.keys(data.heatmap);
        const promises = dates.map((dateStr) => {
          const dailyFocus = data.focusSessionsDaily?.[dateStr] || { totalCount: 0, avgDurationMin: 0 };
          return invoke<void>('save_daily_metrics', {
            args: {
              uid,
              date: dateStr,
              edits: data.heatmap[dateStr] || 0,
              writing_time_seconds: data.writingTime[dateStr] || 0,
              hourly_buckets: JSON.stringify(data.hourlyBuckets[dateStr] || []),
              focus_sessions_total: dailyFocus.totalCount,
              focus_sessions_avg_min: dailyFocus.avgDurationMin,
              avg_wpm: data.typingSpeed.avgWpm,
              peak_wpm: data.typingSpeed.peakWpm,
              wpm_sample_count: data.typingSpeed.sampleCount,
              words_written: Math.round(data.wordsWritten?.[dateStr] || 0),
              issues_resolved: Math.round(data.issuesResolved?.[dateStr] || 0),
            },
          });
        });
        await Promise.all(promises);
      }
      persistToLocalStorage(uid, data);
      console.log('[Metrics] Migration complete');
    }
  } catch (e) {
    console.error('[Metrics] Migration failed:', e);
  }
}
