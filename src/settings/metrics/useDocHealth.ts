/**
 * Runs the documentation scan, and only when someone is looking.
 *
 * A full scan is a markdown parse, a readability pass and an inclusive-language
 * pass per document. That is cheap for one document on a keystroke — the
 * editor already does it — and not cheap for four hundred on a timer. So the
 * scan is gated on the dashboard actually being open, and today's snapshot is
 * written once at the end of it rather than per document.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { analyzeWorkspace, summarizeDocHealth, worstOffenders } from "./docHealth";
import {
  baselineFor,
  loadDocHealthHistory,
  loadReviewBacklog,
  saveDocHealthSnapshot,
  type DatedDocHealth,
} from "./docHealthStorage";
import { getEmptyDocHealth, type DocHealthSnapshot, type DocumentHealth } from "./metricsTypes";

export interface DocHealthState {
  loading: boolean;
  snapshot: DocHealthSnapshot;
  reports: DocumentHealth[];
  offenders: DocumentHealth[];
  history: DatedDocHealth[];
  /** The oldest snapshot in the trailing window, or null before there is one. */
  baseline: DatedDocHealth | null;
}

const EMPTY_STATE: DocHealthState = {
  loading: true,
  snapshot: getEmptyDocHealth(),
  reports: [],
  offenders: [],
  history: [],
  baseline: null,
};

export function useDocHealth(enabled: boolean, trendDays = 30): DocHealthState {
  const { documents } = useWorkspace();
  const [backlog, setBacklog] = useState({ open: 0, resolved: 0, oldestOpenDays: 0 });
  const [history, setHistory] = useState<DatedDocHealth[]>([]);
  const [loading, setLoading] = useState(true);

  // The scan itself. Keyed on the documents array, so reopening the dashboard
  // without touching a file re-uses the previous result.
  const reports = useMemo(
    () => (enabled ? analyzeWorkspace(documents || []) : []),
    [enabled, documents],
  );

  const snapshot = useMemo(
    () => summarizeDocHealth(reports, backlog),
    [reports, backlog],
  );

  const offenders = useMemo(() => worstOffenders(reports), [reports]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);

    Promise.all([loadReviewBacklog(), loadDocHealthHistory(trendDays)])
      .then(([nextBacklog, nextHistory]) => {
        if (!active) return;
        setBacklog(nextBacklog);
        setHistory(nextHistory);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, trendDays]);

  // Record today's roll-up once the backlog has landed, so the stored row is
  // the complete picture rather than the scan with a zeroed review queue.
  //
  // Compared by value, not by identity. A document refresh hands back a fresh
  // array even when nothing in it changed, which re-runs the scan and produces
  // an equal-but-new snapshot object; writing on identity alone would put a
  // row through SQLite every time the workspace polled.
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || loading || snapshot.documents === 0) return;
    const serialized = JSON.stringify(snapshot);
    if (lastWritten.current === serialized) return;
    lastWritten.current = serialized;
    saveDocHealthSnapshot(snapshot);
  }, [enabled, loading, snapshot]);

  const baseline = useMemo(() => baselineFor(history, trendDays), [history, trendDays]);

  if (!enabled) return EMPTY_STATE;

  return { loading, snapshot, reports, offenders, history, baseline };
}
