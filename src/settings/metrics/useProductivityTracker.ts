import { useEffect, useRef } from 'react';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useAuth } from '../../auth/AuthProvider';
import { usePlan } from '../../billing/PlanProvider';
import { registry } from '../../yjs/DocumentRegistry';
import {
  loadLocalMetrics,
  saveAndSyncMetrics,
  migrateLocalStorageToSqlite,
  recordFocusSession,
  UserMetricsData,
} from './metricsSync';
import { dayKey } from './metricsDates';
import * as Y from 'yjs';

interface ActiveBurst {
  startTime: number;
  lastTime: number;
  chars: number;
}

/** A writing stretch survives a pause this long; past it, the stretch ended. */
const FOCUS_GAP_MS = 3 * 60 * 1000;

/** Shorter than this is not deep work, it is a typo fix. */
const MIN_FOCUS_MINUTES = 10;

/**
 * A burst has to last this long before its rate means anything.
 *
 * Rate is chars over elapsed time. Over a fifth of a second — one autocomplete
 * accepting a word, one paste — the divisor is small enough that the result is
 * noise, and it was noise that set the "peak WPM" everyone saw: the old code
 * clamped anything up to 300 and kept the maximum forever, so a single paste
 * pinned the peak at the ceiling for good.
 */
const MIN_SAMPLE_MS = 5000;

/** And it needs enough text to be a rate rather than a single word. */
const MIN_SAMPLE_CHARS = 40;

export function useProductivityTracker() {
  const { currentDocumentId } = useWorkspace();
  const { user } = useAuth();
  const { teamId } = usePlan();

  const uid = user?.id || '';

  const pendingEditsRef = useRef<{ [dateStr: string]: number }>({});
  const pendingWritingTimeRef = useRef<{ [dateStr: string]: number }>({});
  const pendingWordsRef = useRef<{ [dateStr: string]: number }>({});
  const lastKeyTimeRef = useRef<number>(Date.now());
  const syncTimeoutRef = useRef<number | null>(null);
  const burstEndTimeoutRef = useRef<number | null>(null);
  const focusTimeoutRef = useRef<number | null>(null);

  const activeBurstRef = useRef<ActiveBurst | null>(null);
  const focusStartRef = useRef<number | null>(null);
  const focusLastRef = useRef<number>(0);

  /**
   * Closes an open writing stretch, and records it if it was long enough.
   *
   * `recordFocusSession` has existed since the metric was added and was never
   * called by anything, so the "Focus Sessions" card counted to zero for every
   * user who ever opened it. This is the caller.
   */
  const endFocusSession = () => {
    const start = focusStartRef.current;
    focusStartRef.current = null;
    if (!start || !uid) return;

    const minutes = Math.round((focusLastRef.current - start) / 60000);
    if (minutes >= MIN_FOCUS_MINUTES) {
      recordFocusSession(uid, teamId, minutes).catch(console.error);
    }
  };

  const flushBurst = async () => {
    const burst = activeBurstRef.current;
    activeBurstRef.current = null;

    const edits = pendingEditsRef.current;
    const times = pendingWritingTimeRef.current;
    const words = pendingWordsRef.current;
    pendingEditsRef.current = {};
    pendingWritingTimeRef.current = {};
    pendingWordsRef.current = {};

    const dirtyDates = Array.from(
      new Set([...Object.keys(edits), ...Object.keys(times), ...Object.keys(words)]),
    );
    if (!uid || dirtyDates.length === 0) return;

    // A rate is only recorded for bursts long enough to have one. Short ones
    // still count as edits and as writing time — they just do not get a vote
    // on how fast this person types.
    let sampleWpm = 0;
    if (burst) {
      const durationMs = burst.lastTime - burst.startTime;
      if (durationMs >= MIN_SAMPLE_MS && burst.chars >= MIN_SAMPLE_CHARS) {
        const raw = Math.round((burst.chars / 5) / (durationMs / 60000));
        sampleWpm = Math.max(5, Math.min(200, raw));
      }
    }

    try {
      const currentData = await loadLocalMetrics(uid);

      const updatedHeatmap = { ...currentData.heatmap };
      const updatedWritingTime = { ...currentData.writingTime };
      const updatedHourlyBuckets = { ...currentData.hourlyBuckets };
      const updatedWords = { ...(currentData.wordsWritten || {}) };

      for (const dateStr of dirtyDates) {
        updatedHeatmap[dateStr] = (updatedHeatmap[dateStr] || 0) + (edits[dateStr] || 0);
        updatedWritingTime[dateStr] = (updatedWritingTime[dateStr] || 0) + (times[dateStr] || 0);
        updatedWords[dateStr] = Math.max(0, (updatedWords[dateStr] || 0) + (words[dateStr] || 0));
      }

      // Hour buckets are the writer's local hour of the writer's local day,
      // which is the only combination that describes an actual afternoon.
      const now = new Date();
      const todayStr = dayKey(now);
      const todaySeconds = times[todayStr] || 0;
      if (todaySeconds > 0) {
        const bucket = [...(updatedHourlyBuckets[todayStr] || new Array(24).fill(0))];
        bucket[now.getHours()] = (bucket[now.getHours()] || 0) + todaySeconds;
        updatedHourlyBuckets[todayStr] = bucket;
      }

      let updatedSpeed = currentData.typingSpeed;
      if (sampleWpm > 0) {
        updatedSpeed =
          updatedSpeed.sampleCount > 0
            ? {
                // Exponential mean: recent weeks matter more than the first
                // week someone used the app.
                avgWpm: Math.round(updatedSpeed.avgWpm * 0.8 + sampleWpm * 0.2),
                peakWpm: Math.max(updatedSpeed.peakWpm, sampleWpm),
                sampleCount: updatedSpeed.sampleCount + 1,
              }
            : { avgWpm: sampleWpm, peakWpm: sampleWpm, sampleCount: 1 };
      }

      const updatedData: UserMetricsData = {
        ...currentData,
        heatmap: updatedHeatmap,
        writingTime: updatedWritingTime,
        typingSpeed: updatedSpeed,
        hourlyBuckets: updatedHourlyBuckets,
        wordsWritten: updatedWords,
        lastSync: Date.now(),
      };

      await saveAndSyncMetrics(uid, teamId, updatedData, { dirtyDates });
    } catch (e) {
      console.error('Failed to flush metrics burst:', e);
    }
  };

  const scheduleFlush = () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      flushBurst();
    }, 8000) as unknown as number;
  };

  const scheduleBurstEnd = () => {
    if (burstEndTimeoutRef.current) clearTimeout(burstEndTimeoutRef.current);
    burstEndTimeoutRef.current = window.setTimeout(() => {
      flushBurst();
    }, 15000) as unknown as number;
  };

  const scheduleFocusEnd = () => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = window.setTimeout(() => {
      endFocusSession();
    }, FOCUS_GAP_MS) as unknown as number;
  };

  // One-time migration from localStorage to SQLite
  useEffect(() => {
    if (!uid) return;
    migrateLocalStorageToSqlite(uid).catch(console.error);
  }, [uid]);

  useEffect(() => {
    if (!currentDocumentId || !uid) return;

    let active = true;
    let acquiredDoc: Y.Doc | null = null;
    let ytextMd: Y.Text | null = null;
    let ytextDraft: Y.Text | null = null;

    const handleUpdate = (event: Y.YTextEvent) => {
      if (!active) return;
      if (!event.transaction.local) return; // Only track edits by the local user

      const now = Date.now();
      const todayStr = dayKey();
      const timeDiffMs = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      let insertedCount = 0;
      event.changes.added.forEach((item) => {
        insertedCount += item.length;
      });
      let deletedCount = 0;
      event.changes.deleted.forEach((item) => {
        deletedCount += item.length;
      });

      if (insertedCount === 0 && deletedCount === 0) return;

      if (insertedCount > 0) {
        pendingEditsRef.current[todayStr] = (pendingEditsRef.current[todayStr] || 0) + 1;

        // Capped, so stepping away mid-sentence does not bank the whole break
        // as writing time.
        const timeDeltaSec = Math.min(timeDiffMs / 1000, 3);
        pendingWritingTimeRef.current[todayStr] =
          (pendingWritingTimeRef.current[todayStr] || 0) + timeDeltaSec;

        const burst = activeBurstRef.current;
        if (!burst) {
          activeBurstRef.current = { startTime: now, lastTime: now, chars: insertedCount };
        } else {
          burst.lastTime = now;
          burst.chars += insertedCount;
        }
      }

      // Net of deletions: rewriting a paragraph three times is not three
      // paragraphs of output.
      const netChars = insertedCount - deletedCount;
      pendingWordsRef.current[todayStr] =
        (pendingWordsRef.current[todayStr] || 0) + netChars / 5;

      if (focusStartRef.current === null) focusStartRef.current = now;
      focusLastRef.current = now;

      scheduleFlush();
      scheduleBurstEnd();
      scheduleFocusEnd();
    };

    registry.acquire(currentDocumentId).then((doc) => {
      if (!active) return;
      acquiredDoc = doc;

      ytextMd = doc.getText('markdown');
      ytextDraft = doc.getText('draft');

      ytextMd.observe(handleUpdate);
      ytextDraft.observe(handleUpdate);
    }).catch(console.error);

    return () => {
      active = false;
      if (burstEndTimeoutRef.current) clearTimeout(burstEndTimeoutRef.current);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
      if (ytextMd) ytextMd.unobserve(handleUpdate);
      if (ytextDraft) ytextDraft.unobserve(handleUpdate);
      if (acquiredDoc) {
        registry.release(currentDocumentId);
      }
      endFocusSession();
      flushBurst().catch(console.error);
    };
  }, [currentDocumentId, uid, teamId]);
}
