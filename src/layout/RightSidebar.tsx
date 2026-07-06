import React, { useEffect, useCallback } from "react";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { Stage } from "../types";
import { cn } from "../lib/utils";
import { useWordCount } from "../hooks/useWordCount";
import { useOutline } from "../hooks/useOutline";
import { SuggestionCard, ReviseView } from "./rightSidebar/ReviseView";
import { useSidebarContext } from "./SidebarContext";
import { guardTeamAuth, guardTeamPermission } from "../auth/permissionGuards";
import { showAlertDialog } from "../lib/tauriDialog";
import { StageSwitcher } from "./rightSidebar/StageSwitcher";
import { HistoryPanel } from "./rightSidebar/HistoryPanel";
import { SectionNotes } from "./rightSidebar/SectionNotes";
import { FocusModeToggle } from "./rightSidebar/FocusModeToggle";
import { useYjsDocument } from "./rightSidebar/useYjsDocument";
import { useFocusSession } from "./rightSidebar/useFocusSession";
import { useSnapshotHistory } from "./rightSidebar/useSnapshotHistory";
import { useReviewState } from "./rightSidebar/useReviewState";
import { useGitHistory } from "../git/useGitHistory";

export function RightSidebar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { currentDocumentId, activeHeading, activeVersionId, setActiveVersionId, documents, workspacePath } = useWorkspace();
  const { user, isTeamContext, isTeamOwner, currentUserName, teamPerms } = useSidebarContext();
  const { ydoc, stage, setStage, docText, focusMode, setFocusMode, lintIgnoreState, updateLintIgnoreState } = useYjsDocument(currentDocumentId);
  const wordCount = useWordCount(ydoc);
  const outline = useOutline(ydoc ? ydoc.getText("draft") : null);
  const { focusSessionWords, toggleFocusMode } = useFocusSession({ wordCount, focusMode, setFocusMode, ydoc });
  const { snapshots, fetchSnapshots, createSnapshot, handleRestoreSnap, handleDeleteSnap, handleClearHistory } = useSnapshotHistory({ currentDocumentId, activeVersionId, setActiveVersionId, ydoc, currentUserName });
  const currentDoc = documents.find(d => d.id === currentDocumentId);
  const currentDocPath = currentDoc?.file_path || null;
  const { commits: gitCommits, restoreFromCommit } = useGitHistory(workspacePath, currentDocPath);
  const { annotations, suggestions, reviewFilter, setReviewFilter, cardRefs, lintAlerts, activeAnnotationId, activeSuggestionId, handleCardClick, handleAcceptSuggestion, handleRejectSuggestion, onAddSuggestionReply, onAddAnnotationReply, onResolveAnnotation } = useReviewState({ ydoc, stage, currentDocumentId, currentUserName, docText, lintIgnoreState, updateLintIgnoreState });

  useEffect(() => { if (currentDocumentId) fetchSnapshots(); }, [currentDocumentId]);

  const canWrite = isTeamOwner || (!isTeamContext || teamPerms.canWriteFile());

  const handleRestoreFromGit = useCallback(async (commitHash: string) => {
    if (!(await guardTeamAuth(isTeamContext, user, 'restore from git history'))) return;
    if (!canWrite) { showAlertDialog('Permission Denied', 'You do not have permission to restore from git history.'); return; }
    const content = await restoreFromCommit(commitHash);
    if (content !== null && ydoc) {
      ydoc.transact(() => {
        const ytext = ydoc.getText('markdown');
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
      }, 'git-restore');
    }
  }, [ydoc, restoreFromCommit, isTeamContext, user, canWrite]);

  const guardedCreateSnapshot = useCallback(async (label?: string) => {
    if (!(await guardTeamAuth(isTeamContext, user, 'create snapshots'))) return;
    if (!canWrite) { showAlertDialog('Permission Denied', 'You do not have permission to create snapshots.'); return; }
    await createSnapshot(label);
  }, [createSnapshot, isTeamContext, user, canWrite]);

  const guardedRestoreSnap = useCallback(async (snapId: string) => {
    if (!canWrite) { showAlertDialog('Permission Denied', 'You do not have permission to restore snapshots.'); return; }
    await handleRestoreSnap(snapId);
  }, [handleRestoreSnap, canWrite]);

  const guardedDeleteSnap = useCallback(async (snapId: string) => {
    if (!canWrite) { showAlertDialog('Permission Denied', 'You do not have permission to delete snapshots.'); return; }
    await handleDeleteSnap(snapId);
  }, [handleDeleteSnap, canWrite]);

  const guardedClearHistory = useCallback(async () => {
    if (!canWrite) { showAlertDialog('Permission Denied', 'You do not have permission to clear snapshot history.'); return; }
    await handleClearHistory();
  }, [handleClearHistory, canWrite]);

  if (!currentDocumentId || !ydoc) {
    return <div className={cn("flex flex-col h-full", className)} style={style} />;
  }

  const switchStage = (s: Stage) => { setStage(s); ydoc.getMap("meta").set("stage", s); };
  const reprCounter = lintAlerts.length + suggestions.length + annotations.length;

  return (
    <div className={cn("relative h-full flex flex-col", className)} style={style}>
      <div className="px-4 pb-5 flex-1 flex flex-col relative overflow-hidden">
        <StageSwitcher stage={stage} reprCounter={reprCounter} onSwitch={switchStage} />

        {(stage === "write" || stage === "revise") && (
          <HistoryPanel
            stage={stage} activeVersionId={activeVersionId} snapshots={snapshots}
            onSetActiveVersion={setActiveVersionId}
            onRestore={guardedRestoreSnap} onDelete={guardedDeleteSnap}
            onClearHistory={guardedClearHistory}
            onCreateSnapshot={guardedCreateSnapshot}
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
                    onAddSuggestionReply={onAddSuggestionReply}
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
            onResolveAnnotation={onResolveAnnotation}
            onAddSuggestionReply={onAddSuggestionReply}
            onAddAnnotationReply={onAddAnnotationReply}
            activeSuggestionId={activeSuggestionId} activeAnnotationId={activeAnnotationId}
            cardRefs={cardRefs}
          />
        )}
      </div>

      <FocusModeToggle focusMode={focusMode} focusSessionWords={focusSessionWords} wordCount={wordCount} onToggle={toggleFocusMode} />
    </div>
  );
}
