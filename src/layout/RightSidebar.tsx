import React, { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useAuth } from "../auth/AuthProvider";
import { Stage } from "../types";
import { cn } from "../lib/utils";
import * as Y from "yjs";
import { useWordCount } from "../hooks/useWordCount";
import { useOutline } from "../hooks/useOutline";
import { AnnotationManager, Annotation } from "../yjs/annotations";
import { SuggestionManager, Suggestion } from "../yjs/suggestions";
import { useValeLintStore } from "../settings/valeLintStore";
import { parseDocumentMetrics } from "../settings/metrics/metricsParser";
import { buildMetricLintAlerts, filterLintAlerts, sanitizeMarkdownForLint } from "../review/reviewIssues";
import type { LintIgnoreState, ReviewKind } from "../review/reviewIssues";
import { StageSwitcher } from "./rightSidebar/StageSwitcher";
import { HistoryPanel } from "./rightSidebar/HistoryPanel";
import { SectionNotes } from "./rightSidebar/SectionNotes";
import { ReviseView, SuggestionCard } from "./rightSidebar/ReviseView";
import { FocusModeToggle } from "./rightSidebar/FocusModeToggle";
import { useYjsDocument } from "./rightSidebar/useYjsDocument";
import { useFocusSession } from "./rightSidebar/useFocusSession";
import { useSnapshotHistory } from "./rightSidebar/useSnapshotHistory";
import { useGitHistory } from "../git/useGitHistory";

export function RightSidebar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { currentDocumentId, activeHeading, activeVersionId, setActiveVersionId, activeAnnotationId, activeSuggestionId, documents, workspacePath } = useWorkspace();
  const { user } = useAuth();
  const currentUserName = user?.display_name || user?.email?.split('@')[0] || 'Teammate';
  const { ydoc, stage, setStage, docText, focusMode, setFocusMode, lintIgnoreState, updateLintIgnoreState } = useYjsDocument(currentDocumentId);
  const wordCount = useWordCount(ydoc);
  const outline = useOutline(ydoc ? ydoc.getText("draft") : null);
  const { focusSessionWords, toggleFocusMode } = useFocusSession({ wordCount, focusMode, setFocusMode, ydoc });
  const { snapshots, fetchSnapshots, createSnapshot, handleRestoreSnap, handleDeleteSnap, handleClearHistory } = useSnapshotHistory({ currentDocumentId, activeVersionId, setActiveVersionId, ydoc, currentUserName });
  const currentDoc = documents.find(d => d.id === currentDocumentId);
  const currentDocPath = currentDoc?.file_path || null;
  const { commits: gitCommits, restoreFromCommit } = useGitHistory(workspacePath, currentDocPath);

  const handleRestoreFromGit = async (commitHash: string) => {
    const content = await restoreFromCommit(commitHash);
    if (content !== null && ydoc) {
      ydoc.transact(() => {
        const ytext = ydoc.getText('markdown');
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
      }, 'git-restore');
    }
  };

  const annotationManagerRef = useRef<AnnotationManager | null>(null);
  const sugManagerRef = useRef<SuggestionManager | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewKind | "all">("all");
  const cardRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const metrics = useMemo(
    () => parseDocumentMetrics(sanitizeMarkdownForLint(docText)),
    [docText],
  );
  const valeAlerts = useValeLintStore((s) => s.alerts);
  const lintAlerts = useMemo(() => {
    return filterLintAlerts([...Object.values(valeAlerts).flat(), ...buildMetricLintAlerts(metrics)], lintIgnoreState, docText);
  }, [docText, lintIgnoreState, metrics, valeAlerts]);

  useEffect(() => { if (currentDocumentId) fetchSnapshots(); }, [currentDocumentId]);

  useEffect(() => {
    setAnnotations([]); setSuggestions([]);
    annotationManagerRef.current = null; sugManagerRef.current = null;
    if ((stage !== "write" && stage !== "revise") || !ydoc || !currentDocumentId) return;

    const sugMgr = new SuggestionManager(ydoc, currentDocumentId);
    sugManagerRef.current = sugMgr;
    const updateSugs = () => setSuggestions(sugMgr.getSuggestions().filter((s) => !s.resolved));
    sugMgr.observe(updateSugs); updateSugs();

    let annMgr: AnnotationManager | null = null;
    let updateAnns: (() => void) | null = null;
    if (stage === "revise") {
      annMgr = new AnnotationManager(ydoc, currentDocumentId);
      annotationManagerRef.current = annMgr;
      updateAnns = () => setAnnotations(annMgr!.getAnnotations().filter((a) => !a.resolved));
      annMgr.observe(updateAnns); updateAnns();
    }

    return () => {
      if (annMgr && updateAnns) annMgr.unobserve(updateAnns);
      sugMgr.unobserve(updateSugs);
      annotationManagerRef.current = null;
      sugManagerRef.current = null;
    };
  }, [stage, ydoc, currentDocumentId]);

  useEffect(() => {
    const activeId = activeAnnotationId || activeSuggestionId;
    if (activeId) { const el = cardRefs.current[activeId]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }, [activeAnnotationId, activeSuggestionId]);

  if (!currentDocumentId || !ydoc) {
    return <div className={cn("flex flex-col h-full", className)} style={style} />;
  }

  const switchStage = (s: Stage) => { setStage(s); ydoc.getMap("meta").set("stage", s); };
  const reprCounter = lintAlerts.length + suggestions.length + annotations.length;

  const handleCardClick = (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => {
    const startAbs = Y.createAbsolutePositionFromRelativePosition(item.start_pos, ydoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(item.end_pos, ydoc);
    if (startAbs && endAbs) window.dispatchEvent(new CustomEvent('editor-select-range', { detail: { from: startAbs.index, to: endAbs.index } }));
  };

  const handleAcceptSuggestion = (sug: Suggestion) => {
    if (!sugManagerRef.current) return;
    const ytext = ydoc.getText('markdown');
    const startAbs = Y.createAbsolutePositionFromRelativePosition(sug.start_pos, ydoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(sug.end_pos, ydoc);
    if (sug.type === 'delete' && startAbs && endAbs && startAbs.index < endAbs.index) {
      ydoc.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
    }
    sugManagerRef.current.resolveSuggestion(sug.id, 'accepted');
  };

  const handleRejectSuggestion = (sug: Suggestion) => {
    if (!sugManagerRef.current) return;
    const ytext = ydoc.getText('markdown');
    const startAbs = Y.createAbsolutePositionFromRelativePosition(sug.start_pos, ydoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(sug.end_pos, ydoc);
    if (sug.type === 'insert' && startAbs && endAbs && startAbs.index < endAbs.index) {
      ydoc.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
    }
    sugManagerRef.current.resolveSuggestion(sug.id, 'rejected');
  };

  return (
    <div className={cn("relative h-full flex flex-col", className)} style={style}>
      <div className="px-4 pb-5 flex-1 flex flex-col relative overflow-hidden">
        <StageSwitcher stage={stage} reprCounter={reprCounter} onSwitch={switchStage} />

        {(stage === "write" || stage === "revise") && (
          <HistoryPanel
            stage={stage} activeVersionId={activeVersionId} snapshots={snapshots}
            onSetActiveVersion={setActiveVersionId} onRestore={handleRestoreSnap}
            onDelete={handleDeleteSnap} onClearHistory={handleClearHistory}
            onCreateSnapshot={createSnapshot}
            gitCommits={gitCommits}
            onRestoreFromGit={handleRestoreFromGit}
          />
        )}

        {stage === "write" && (
          <div className="flex-1 overflow-y-auto pt-4 flex flex-col gap-4 pb-24">
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[10px] font-bold text-gray-400 tracking-wider text-right uppercase">Suggestions</h4>
                  <span className="text-[10px] text-gray-400 font-semibold">
                    {suggestions.length}
                  </span>
                </div>
                {suggestions.map((sug) => (
                  <SuggestionCard
                    key={sug.id}
                    suggestion={sug}
                    active={sug.id === activeSuggestionId}
                    cardRef={(el) => { cardRefs.current[sug.id] = el; }}
                    onCardClick={handleCardClick}
                    onAcceptSuggestion={handleAcceptSuggestion}
                    onRejectSuggestion={handleRejectSuggestion}
                    onAddSuggestionReply={(sugId, text) => sugManagerRef.current?.addReply(sugId, text, currentUserName)}
                  />
                ))}
              </div>
            )}
            <SectionNotes activeHeading={activeHeading} outline={outline} />
          </div>
        )}

        {stage === "revise" && (
          <ReviseView
            lintAlerts={lintAlerts} suggestions={suggestions} annotations={annotations}
            reviewFilter={reviewFilter} onSetReviewFilter={setReviewFilter}
            lintIgnoreState={lintIgnoreState} onUpdateLintIgnore={updateLintIgnoreState}
            onJumpToLint={(alert) => window.dispatchEvent(new CustomEvent("editor-scroll-to-line", { detail: { lineIndex: Math.max(0, alert.line - 1) } }))}
            onCardClick={handleCardClick}
            onAcceptSuggestion={handleAcceptSuggestion} onRejectSuggestion={handleRejectSuggestion}
            onResolveAnnotation={(id) => annotationManagerRef.current?.resolveAnnotation(id)}
            onAddSuggestionReply={(sugId, text) => sugManagerRef.current?.addReply(sugId, text, currentUserName)}
            onAddAnnotationReply={(annId, text) => annotationManagerRef.current?.addReply(annId, text, currentUserName)}
            activeSuggestionId={activeSuggestionId} activeAnnotationId={activeAnnotationId}
            cardRefs={cardRefs}
          />
        )}
      </div>

      <FocusModeToggle focusMode={focusMode} focusSessionWords={focusSessionWords} wordCount={wordCount} onToggle={toggleFocusMode} />
    </div>
  );
}
