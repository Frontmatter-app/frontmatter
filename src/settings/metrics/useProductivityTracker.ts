import { useEffect, useRef } from 'react';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useAuth } from '../../auth/AuthProvider';
import { usePlan } from '../../billing/PlanProvider';
import { registry } from '../../yjs/DocumentRegistry';
import { loadLocalMetrics, saveAndSyncMetrics, migrateLocalStorageToSqlite, UserMetricsData } from './metricsSync';
import * as Y from 'yjs';

interface ActiveBurst {
  startTime: number;
  lastTime: number;
  chars: number;
}

export function useProductivityTracker() {
  const { currentDocumentId } = useWorkspace();
  const { user } = useAuth();
  const { teamId } = usePlan();

  const uid = user?.uid || '';

  const pendingEditsRef = useRef<{ [dateStr: string]: number }>({});
  const pendingWritingTimeRef = useRef<{ [dateStr: string]: number }>({});
  const lastKeyTimeRef = useRef<number>(Date.now());
  const syncTimeoutRef = useRef<number | null>(null);
  const burstEndTimeoutRef = useRef<number | null>(null);

  const activeBurstRef = useRef<ActiveBurst | null>(null);

  const flushBurst = async () => {
    const burst = activeBurstRef.current;
    if (!burst || !uid) return;

    const durationMs = burst.lastTime - burst.startTime;
    const durationSec = durationMs / 1000;

    if (durationSec <= 0 || burst.chars <= 0) {
      activeBurstRef.current = null;
      return;
    }

    const wpm = Math.round((burst.chars / 5) / (durationSec / 60));
    const clampedWpm = Math.max(5, Math.min(300, wpm));

    const today = new Date(burst.startTime);
    const todayStr = today.toISOString().split('T')[0];

    const editsInBurst = pendingEditsRef.current[todayStr] || 1;
    const timeInBurst = pendingWritingTimeRef.current[todayStr] || Math.round(durationSec);

    try {
      const currentData = await loadLocalMetrics(uid);

      const prevEdits = currentData.heatmap[todayStr] || 0;
      const prevTime = currentData.writingTime[todayStr] || 0;

      const updatedHeatmap = { ...currentData.heatmap };
      updatedHeatmap[todayStr] = prevEdits + editsInBurst;

      const updatedWritingTime = { ...currentData.writingTime };
      updatedWritingTime[todayStr] = prevTime + timeInBurst;

      const updatedHourlyBuckets = { ...currentData.hourlyBuckets };
      const currentBucket = updatedHourlyBuckets[todayStr] || new Array(24).fill(0);
      updatedHourlyBuckets[todayStr] = [...currentBucket];
      updatedHourlyBuckets[todayStr]![today.getHours()] =
        (updatedHourlyBuckets[todayStr]![today.getHours()] || 0) + timeInBurst;

      let updatedSpeed = currentData.typingSpeed;
      if (clampedWpm > 0) {
        if (updatedSpeed.sampleCount > 0) {
          const alpha = 0.2;
          const newAvg = Math.round(updatedSpeed.avgWpm * (1 - alpha) + clampedWpm * alpha);
          updatedSpeed = {
            avgWpm: newAvg,
            peakWpm: Math.max(updatedSpeed.peakWpm, clampedWpm),
            sampleCount: updatedSpeed.sampleCount + 1,
          };
        } else {
          updatedSpeed = {
            avgWpm: clampedWpm,
            peakWpm: clampedWpm,
            sampleCount: 1,
          };
        }
      }

      const updatedData: UserMetricsData = {
        heatmap: updatedHeatmap,
        writingTime: updatedWritingTime,
        focusSessions: currentData.focusSessions,
        typingSpeed: updatedSpeed,
        hourlyBuckets: updatedHourlyBuckets,
        lastSync: Date.now(),
      };

      await saveAndSyncMetrics(uid, teamId, updatedData);
    } catch (e) {
      console.error('Failed to flush metrics burst:', e);
    } finally {
      pendingEditsRef.current = {};
      pendingWritingTimeRef.current = {};
      activeBurstRef.current = null;
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

      const now = Date.now();
      const todayStr = new Date().toISOString().split('T')[0];
      const timeDiffMs = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      let insertedCount = 0;
      event.changes.added.forEach((item) => {
        insertedCount += item.length;
      });

      if (insertedCount > 0) {
        pendingEditsRef.current[todayStr] = (pendingEditsRef.current[todayStr] || 0) + 1;

        const timeDeltaSec = Math.min(timeDiffMs / 1000, 3);
        pendingWritingTimeRef.current[todayStr] =
          (pendingWritingTimeRef.current[todayStr] || 0) + timeDeltaSec;

        const burst = activeBurstRef.current;
        if (!burst) {
          activeBurstRef.current = {
            startTime: now,
            lastTime: now,
            chars: insertedCount,
          };
        } else {
          burst.lastTime = now;
          burst.chars += insertedCount;
        }

        scheduleFlush();
        scheduleBurstEnd();
      }
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
      if (ytextMd) ytextMd.unobserve(handleUpdate);
      if (ytextDraft) ytextDraft.unobserve(handleUpdate);
      if (acquiredDoc) {
        registry.release(currentDocumentId);
      }
      flushBurst().catch(console.error);
    };
  }, [currentDocumentId, uid, teamId]);
}
