import { db } from '../../auth/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { invoke, isWebPreview } from '../../filesystem/tauriCommands';
import { UserMetricsData } from './metricsTypes';
import { loadMetricsFromLocalStorage, persistToLocalStorage, loadMetricsFromSqlite } from './metricsStorage';

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

// Merge two metrics objects; overlay wins per-key
export function mergeMetrics(base: UserMetricsData, overlay: Partial<UserMetricsData>): UserMetricsData {
  const mergedHeatmap = { ...base.heatmap, ...(overlay.heatmap || {}) };
  const mergedWritingTime = { ...base.writingTime, ...(overlay.writingTime || {}) };
  const mergedHourlyBuckets = { ...base.hourlyBuckets, ...(overlay.hourlyBuckets || {}) };
  const mergedFocusDaily = { ...(base.focusSessionsDaily || {}), ...(overlay.focusSessionsDaily || {}) };

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

  // Aggregate focus sessions
  let totalFocusCount = 0;
  let totalFocusDuration = 0;
  Object.values(mergedFocusDaily).forEach((val) => {
    totalFocusCount += val.totalCount;
    totalFocusDuration += val.avgDurationMin * val.totalCount;
  });
  const mergedFocusAvg = totalFocusCount > 0 ? Math.round(totalFocusDuration / totalFocusCount) : 0;

  return {
    heatmap: mergedHeatmap,
    writingTime: mergedWritingTime,
    focusSessions: {
      totalCount: totalFocusCount,
      avgDurationMin: mergedFocusAvg,
    },
    focusSessionsDaily: mergedFocusDaily,
    typingSpeed: {
      avgWpm: mergedAvgWpm,
      peakWpm: mergedPeakWpm,
      sampleCount: mergedSampleCount,
    },
    hourlyBuckets: mergedHourlyBuckets,
    lastSync: overlay.lastSync || base.lastSync,
  };
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
            },
          });
        });
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

// Record a completed Focus Session
export async function recordFocusSession(uid: string, teamId: string | null, durationMinutes: number) {
  if (!uid || durationMinutes <= 0) return;

  const todayStr = new Date().toISOString().split('T')[0];

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
      heatmap: updatedHeatmap,
      writingTime: updatedWritingTime,
      focusSessions: { totalCount: totalFocusCount, avgDurationMin: globalAvgDuration },
      focusSessionsDaily: updatedFocusSessionsDaily,
      typingSpeed: currentData.typingSpeed,
      hourlyBuckets: updatedHourlyBuckets,
      lastSync: Date.now(),
    };

    await saveAndSyncMetrics(uid, teamId, updatedData);
  } catch (e) {
    console.error('Failed to record focus session:', e);
  }
}
