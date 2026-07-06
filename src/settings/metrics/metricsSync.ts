import { db } from '../../auth/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { invoke, isWebPreview } from '../../filesystem/tauriCommands';

export interface UserMetricsData {
  heatmap: { [dateStr: string]: number };
  writingTime: { [dateStr: string]: number };
  focusSessions: {
    totalCount: number;
    avgDurationMin: number;
  };
  typingSpeed: {
    avgWpm: number;
    peakWpm: number;
    sampleCount: number;
  };
  hourlyBuckets: { [dateStr: string]: number[] };
  lastSync?: number;
}

function getEmptyMetrics(): UserMetricsData {
  return {
    heatmap: {},
    writingTime: {},
    focusSessions: { totalCount: 0, avgDurationMin: 0 },
    typingSpeed: { avgWpm: 0, peakWpm: 0, sampleCount: 0 },
    hourlyBuckets: {},
  };
}

// Load from localStorage (synchronous fallback used for instant renders)
function loadMetricsFromLocalStorage(uid: string): UserMetricsData {
  try {
    const raw = localStorage.getItem(`marktype_metrics_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserMetricsData>;
      return {
        heatmap: parsed.heatmap || {},
        writingTime: parsed.writingTime || {},
        focusSessions: {
          totalCount: parsed.focusSessions?.totalCount || 0,
          avgDurationMin: parsed.focusSessions?.avgDurationMin || 0,
        },
        typingSpeed: {
          avgWpm: parsed.typingSpeed?.avgWpm || 0,
          peakWpm: parsed.typingSpeed?.peakWpm || 0,
          sampleCount: parsed.typingSpeed?.sampleCount || 0,
        },
        hourlyBuckets: parsed.hourlyBuckets || {},
      };
    }
  } catch (e) {
    console.error('Failed to load metrics from localStorage:', e);
  }
  return getEmptyMetrics();
}

// Load metrics from SQLite via Tauri backend (primary source of truth)
export async function loadMetricsFromSqlite(uid: string): Promise<UserMetricsData> {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 169);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = today.toISOString().split('T')[0];

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
    let totalFocus = 0;
    let focusCnt = 0;
    let totalWpmNumerator = 0;
    let peakWpm = 0;

    for (const row of rows) {
      heatmap[row.date] = row.edits;
      writingTime[row.date] = row.writing_time_seconds;
      hourlyBuckets[row.date] = JSON.parse(row.hourly_buckets || '[]');
      if (row.focus_sessions_total > 0) {
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
      typingSpeed: { avgWpm, peakWpm, sampleCount: totalSampleCount },
      hourlyBuckets,
    };
  } catch (e) {
    console.error('Failed to load metrics from SQLite:', e);
    return getEmptyMetrics();
  }
}

// Primary loader: SQLite first, fallback to localStorage
export async function loadLocalMetrics(uid: string): Promise<UserMetricsData> {
  if (isWebPreview) {
    return loadMetricsFromLocalStorage(uid);
  }
  try {
    return await loadMetricsFromSqlite(uid);
  } catch {
    return loadMetricsFromLocalStorage(uid);
  }
}

// Sync loader (synchronous) for React renders: localStorage only
export function loadLocalMetricsSync(uid: string): UserMetricsData {
  return loadMetricsFromLocalStorage(uid);
}

// Merge two metrics objects; overlay wins per-key
export function mergeMetrics(base: UserMetricsData, overlay: Partial<UserMetricsData>): UserMetricsData {
  const mergedHeatmap = { ...base.heatmap, ...(overlay.heatmap || {}) };
  const mergedWritingTime = { ...base.writingTime, ...(overlay.writingTime || {}) };
  const mergedHourlyBuckets = { ...base.hourlyBuckets, ...(overlay.hourlyBuckets || {}) };

  const baseSpeed = base.typingSpeed;
  const overlaySpeed = overlay.typingSpeed || { avgWpm: 0, peakWpm: 0, sampleCount: 0 };

  let mergedAvgWpm = baseSpeed.avgWpm;
  let mergedPeakWpm = baseSpeed.peakWpm;
  let mergedSampleCount = baseSpeed.sampleCount;

  if (overlaySpeed.sampleCount && overlaySpeed.sampleCount > 0) {
    if (baseSpeed.sampleCount > 0) {
      const totalSamples = baseSpeed.sampleCount + overlaySpeed.sampleCount;
      mergedAvgWpm = Math.round(
        (baseSpeed.avgWpm * baseSpeed.sampleCount + overlaySpeed.avgWpm * overlaySpeed.sampleCount) /
          totalSamples
      );
      mergedPeakWpm = Math.max(baseSpeed.peakWpm, overlaySpeed.peakWpm || 0);
      mergedSampleCount = totalSamples;
    } else {
      mergedAvgWpm = overlaySpeed.avgWpm;
      mergedPeakWpm = overlaySpeed.peakWpm || 0;
      mergedSampleCount = overlaySpeed.sampleCount;
    }
  }

  return {
    heatmap: mergedHeatmap,
    writingTime: mergedWritingTime,
    focusSessions: {
      totalCount: Math.max(base.focusSessions.totalCount, overlay.focusSessions?.totalCount || 0),
      avgDurationMin: overlay.focusSessions?.avgDurationMin || base.focusSessions.avgDurationMin,
    },
    typingSpeed: {
      avgWpm: mergedAvgWpm,
      peakWpm: mergedPeakWpm,
      sampleCount: mergedSampleCount,
    },
    hourlyBuckets: mergedHourlyBuckets,
    lastSync: overlay.lastSync || base.lastSync,
  };
}

// Persist metrics to localStorage (synchronous cache for instant UI)
function persistToLocalStorage(uid: string, data: UserMetricsData) {
  try {
    localStorage.setItem(`marktype_metrics_${uid}`, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to write metrics to localStorage cache:', e);
  }
}

// Save metrics to SQLite via Tauri backend, and sync to Firestore when applicable
export async function saveAndSyncMetrics(
  uid: string,
  teamId: string | null,
  data: UserMetricsData,
  forceCloudSync: boolean = false
): Promise<void> {
  if (!uid) return;

  // Keep the localStorage cache fresh for instant load next time
  persistToLocalStorage(uid, data);

  // Persist to SQLite (primary durable store)
  if (!isWebPreview) {
    const dates = Object.keys(data.heatmap);
    if (dates.length > 0) {
      try {
        const promises = dates.map((dateStr) =>
          invoke<void>('save_daily_metrics', {
            args: {
              uid,
              date: dateStr,
              edits: data.heatmap[dateStr] || 0,
              writing_time_seconds: data.writingTime[dateStr] || 0,
              hourly_buckets: JSON.stringify(data.hourlyBuckets[dateStr] || []),
              focus_sessions_total: data.focusSessions.totalCount,
              focus_sessions_avg_min: data.focusSessions.avgDurationMin,
              avg_wpm: data.typingSpeed.avgWpm,
              peak_wpm: data.typingSpeed.peakWpm,
              wpm_sample_count: data.typingSpeed.sampleCount,
            },
          })
        );
        await Promise.all(promises);
      } catch (e) {
        console.error('Failed to persist metrics to SQLite:', e);
      }
    }
  }

  // Cloud sync: always sync for authenticated users when their data is important
  if (!uid || (!teamId && !forceCloudSync)) return;

  try {
    const payload = {
      ...data,
      lastSync: Date.now(),
    };
    const userDocRef = doc(db, 'users', uid);
    await updateDoc(userDocRef, {
      metrics: payload,
    });
  } catch (e) {
    console.warn('Failed to sync metrics to Firestore:', e);
  }
}

// Fix hourly buckets that were stored with buggy dateStr-hour keys (e.g. "2024-01-15-14")
function fixHourlyBuckets(data: UserMetricsData): UserMetricsData {
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
    const raw = localStorage.getItem(`marktype_metrics_${uid}`);
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
      // Only persist to SQLite, skip cloud sync
      if (!isWebPreview) {
        const dates = Object.keys(data.heatmap);
        const promises = dates.map((dateStr) =>
          invoke<void>('save_daily_metrics', {
            args: {
              uid,
              date: dateStr,
              edits: data.heatmap[dateStr] || 0,
              writing_time_seconds: data.writingTime[dateStr] || 0,
              hourly_buckets: JSON.stringify(data.hourlyBuckets[dateStr] || []),
              focus_sessions_total: data.focusSessions.totalCount,
              focus_sessions_avg_min: data.focusSessions.avgDurationMin,
              avg_wpm: data.typingSpeed.avgWpm,
              peak_wpm: data.typingSpeed.peakWpm,
              wpm_sample_count: data.typingSpeed.sampleCount,
            },
          })
        );
        await Promise.all(promises);
      }
      // Fix the localStorage copy too
      persistToLocalStorage(uid, data);
      console.log('[Metrics] Migration complete');
    }
  } catch (e) {
    console.error('[Metrics] Migration failed:', e);
  }
}

// Record a completed Focus Session
export function recordFocusSession(uid: string, teamId: string | null, durationMinutes: number) {
  if (!uid || durationMinutes <= 0) return;

  const todayStr = new Date().toISOString().split('T')[0];

  const currentData: UserMetricsData = {
    heatmap: { [todayStr]: 0 },
    writingTime: { [todayStr]: 0 },
    focusSessions: { totalCount: 1, avgDurationMin: durationMinutes },
    typingSpeed: { avgWpm: 0, peakWpm: 0, sampleCount: 0 },
    hourlyBuckets: { [todayStr]: new Array(24).fill(0) },
  };

  saveAndSyncMetrics(uid, teamId, currentData).catch(console.error);
}
