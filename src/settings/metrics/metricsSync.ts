/**
 * Productivity metrics, stored locally.
 *
 * Metrics used to be mirrored into the signed-in user's Firestore document so a
 * team owner could read them. Both halves of that are gone: there is no
 * Firestore, and reading a colleague's typing statistics is not something this
 * project should offer to reinstate without asking first.
 *
 * Everything here is now SQLite on the user's own machine, with localStorage as
 * the web-preview fallback.
 */
import { invoke, isWebPreview } from '../../filesystem/tauriCommands';
import { UserMetricsData } from './metricsTypes';
import { loadMetricsFromLocalStorage, persistToLocalStorage, loadMetricsFromSqlite } from './metricsStorage';
import { dayKey } from './metricsDates';

export type { UserMetricsData } from './metricsTypes';
export { migrateLocalStorageToSqlite } from './metricsStorage';

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

export interface SaveOptions {
  /**
   * The days this write actually changed. Everything else in `data` is left
   * alone.
   *
   * Without this the function wrote every day it held — up to 170 rows, each
   * its own IPC round trip and its own upsert — on a timer that fires every
   * eight seconds while someone is typing. The rows were also rewritten with
   * whatever the current WPM average happened to be, so a burst of typing this
   * afternoon silently restamped last March's typing speed.
   */
  dirtyDates?: string[];
  forceCloudSync?: boolean;
}

// Save metrics to SQLite via Tauri backend, and sync to Firestore when applicable
export async function saveAndSyncMetrics(
  uid: string,
  teamId: string | null,
  data: UserMetricsData,
  options: SaveOptions = {},
): Promise<void> {
  if (!uid) return;

  const { dirtyDates, forceCloudSync = false } = options;

  // Keep the localStorage cache fresh for instant load next time
  persistToLocalStorage(uid, data);

  // Persist to SQLite (primary durable store)
  if (!isWebPreview) {
    const dates = dirtyDates ?? Object.keys(data.heatmap);
    try {
      await Promise.all(
        dates.map((dateStr) => {
          const dailyFocus = data.focusSessionsDaily?.[dateStr] || { totalCount: 0, avgDurationMin: 0 };
          return invoke<void>('save_daily_metrics', {
            args: {
              uid,
              date: dateStr,
              edits: data.heatmap[dateStr] || 0,
              writing_time_seconds: Math.round(data.writingTime[dateStr] || 0),
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
        }),
      );
    } catch (e) {
      console.error('Failed to persist metrics to SQLite:', e);
    }
  }

  // Metrics stay on this machine. `forceCloudSync` and `teamId` are still in
  // the signature because roughly a dozen call sites pass them; both are now
  // inert rather than worth threading a removal through all of them.
  void forceCloudSync;
  void teamId;
}

// Record a completed Focus Session
export async function recordFocusSession(uid: string, teamId: string | null, durationMinutes: number) {
  if (!uid || durationMinutes <= 0) return;

  const todayStr = dayKey();

  try {
    const currentData = await loadLocalMetrics(uid);

    const updatedHeatmap = { ...currentData.heatmap };
    if (updatedHeatmap[todayStr] === undefined) updatedHeatmap[todayStr] = 0;

    const updatedWritingTime = { ...currentData.writingTime };
    if (updatedWritingTime[todayStr] === undefined) updatedWritingTime[todayStr] = 0;

    const updatedHourlyBuckets = { ...currentData.hourlyBuckets };
    if (updatedHourlyBuckets[todayStr] === undefined) updatedHourlyBuckets[todayStr] = new Array(24).fill(0);

    const dailyFocus = currentData.focusSessionsDaily?.[todayStr] || { totalCount: 0, avgDurationMin: 0 };
    const newDailyCount = dailyFocus.totalCount + 1;
    const newDailyAvg = Math.round(
      (dailyFocus.avgDurationMin * dailyFocus.totalCount + durationMinutes) / newDailyCount
    );

    const updatedFocusSessionsDaily = {
      ...(currentData.focusSessionsDaily || {}),
      [todayStr]: { totalCount: newDailyCount, avgDurationMin: newDailyAvg },
    };

    // Calculate updated global focus sessions
    let totalFocusCount = 0;
    let totalFocusDuration = 0;
    Object.values(updatedFocusSessionsDaily).forEach((val) => {
      totalFocusCount += val.totalCount;
      totalFocusDuration += val.avgDurationMin * val.totalCount;
    });
    const globalAvgDuration = totalFocusCount > 0 ? Math.round(totalFocusDuration / totalFocusCount) : 0;

    const updatedData: UserMetricsData = {
      ...currentData,
      heatmap: updatedHeatmap,
      writingTime: updatedWritingTime,
      focusSessions: { totalCount: totalFocusCount, avgDurationMin: globalAvgDuration },
      focusSessionsDaily: updatedFocusSessionsDaily,
      hourlyBuckets: updatedHourlyBuckets,
      lastSync: Date.now(),
    };

    await saveAndSyncMetrics(uid, teamId, updatedData, { dirtyDates: [todayStr] });
  } catch (e) {
    console.error('Failed to record focus session:', e);
  }
}
