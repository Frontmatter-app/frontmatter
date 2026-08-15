import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { AnnotationManager, Annotation } from "../../yjs/annotations";
import { SuggestionManager, Suggestion } from "../../yjs/suggestions";
import { toAbsolute } from "../../yjs/relativePositions";
import { useProseScanStore } from "../../review/proseScanStore";
import { analyzeDocument } from "../../review/lintPipeline";
import { useLintSelection, REVEAL_LINT_ISSUE, APPLY_LINT_FIX } from "../../review/lintSelectionStore";
import type { LintIgnoreState, LintIssue, ReviewKind } from "../../review/lintTypes";
import { useSidebarContext } from "../SidebarContext";
import { guardTeamAuth, guardTeamPermission } from "../../auth/permissionGuards";
import * as Y from "yjs";
import { showAlertDialog } from "../../lib/tauriDialog";

interface UseReviewStateParams {
  ydoc: Y.Doc | null;
  stage: string;
  currentDocumentId: string | null;
  currentUserName: string;
  docText: string;
  lintIgnoreState: LintIgnoreState;
  updateLintIgnoreState: (updater: (current: LintIgnoreState) => LintIgnoreState) => void;
}

export function useReviewState({ ydoc, stage, currentDocumentId, currentUserName, docText, lintIgnoreState, updateLintIgnoreState }: UseReviewStateParams) {
  const { activeAnnotationId, activeSuggestionId } = useWorkspace();
  const { user, isTeamContext, teamPerms } = useSidebarContext();

  const annotationManagerRef = useRef<AnnotationManager | null>(null);
  const sugManagerRef = useRef<SuggestionManager | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewKind | "all">("all");
  const cardRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const grammarLints = useProseScanStore((s) => s.grammarLints);
  const grammarError = useProseScanStore((s) => s.grammarError);
  const activeLintIssueId = useLintSelection((s) => s.activeIssueId);

  // Same call the editor makes, memoized inside the pipeline: whichever of the
  // two runs second in a tick reuses the first one's result rather than
  // re-parsing the document.
  const analysis = useMemo(
    () => analyzeDocument(docText, grammarLints, lintIgnoreState),
    [docText, grammarLints, lintIgnoreState],
  );
  const lintIssues = analysis.issues;
  const readabilityStats = analysis.stats;

  useEffect(() => {
    setAnnotations([]); setSuggestions([]);
    annotationManagerRef.current = null; sugManagerRef.current = null;
    if ((stage !== "write" && stage !== "revise") || !ydoc || !currentDocumentId) return;

    const sugMgr = new SuggestionManager(ydoc, currentDocumentId);
    sugManagerRef.current = sugMgr;
    const updateSugs = () => setSuggestions(sugMgr.getSuggestions().filter((s) => !s.resolved));
    sugMgr.observe(updateSugs); updateSugs();

    // Both stages. Notes can be written from Write as well as Revise, and
    // building the manager only for Revise meant the review badge counted none
    // of them from the other side.
    const annMgr = new AnnotationManager(ydoc, currentDocumentId);
    annotationManagerRef.current = annMgr;
    const updateAnns = () => setAnnotations(annMgr.getAnnotations().filter((a) => !a.resolved));
    annMgr.observe(updateAnns); updateAnns();

    return () => {
      annMgr.unobserve(updateAnns);
      sugMgr.unobserve(updateSugs);
      annotationManagerRef.current = null;
      sugManagerRef.current = null;
    };
  }, [stage, ydoc, currentDocumentId]);

  /**
   * Scrolls the card for whatever the caret is in.
   *
   * Lint issues are in this list now. They were not, so moving through a
   * flagged sentence left the sidebar showing an unrelated part of the review
   * — the editor knew which issue was under the cursor and had no way to say
   * so.
   */
  useEffect(() => {
    const activeId = activeAnnotationId || activeSuggestionId || activeLintIssueId;
    if (!activeId) return;
    const el = cardRefs.current[activeId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeAnnotationId, activeSuggestionId, activeLintIssueId]);

  const handleCardClick = (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => {
    if (!ydoc) return;
    const startAbs = toAbsolute(item.start_pos, ydoc);
    const endAbs = toAbsolute(item.end_pos, ydoc);
    if (startAbs && endAbs) window.dispatchEvent(new CustomEvent('editor-select-range', { detail: { from: startAbs.index, to: endAbs.index } }));
  };

  /**
   * Selects the exact flagged text, not the start of its line.
   *
   * The old handler sent a line index, so clicking "very hard to read
   * sentence" put the caret at the left margin and left the writer to find
   * which of the four sentences on that line was meant.
   */
  const handleJumpToIssue = (issue: LintIssue) => {
    useLintSelection.getState().setActiveIssueId(issue.id);
    window.dispatchEvent(new CustomEvent(REVEAL_LINT_ISSUE, { detail: { issue } }));
  };

  const handleApplyFix = (issue: LintIssue, replacement: string) => {
    window.dispatchEvent(new CustomEvent(APPLY_LINT_FIX, { detail: { issue, replacement } }));
  };

  /**
   * Settles a suggestion, removing text only when the outcome calls for it.
   *
   * Accepting a delete removes the text; rejecting an insert removes it again.
   * The other two outcomes leave the document alone — an accepted insert is
   * already in the text, and a rejected delete was never applied.
   *
   * Written once. Both handlers used to carry the whole body twice, once for
   * the non-team early return and once after the guards, so every fix here had
   * to be made in four places — and the two copies had already drifted on which
   * permission they checked.
   */
  const settleSuggestion = async (sug: Suggestion, outcome: 'accepted' | 'rejected') => {
    const action = outcome === 'accepted' ? 'accept suggestions' : 'reject suggestions';
    if (!(await guardTeamAuth(isTeamContext, user, action))) return;
    // Both outcomes can rewrite the document, so both need the same permission.
    // Reject asked only for `canReviseFile`, which let a reviser delete text a
    // writer had added.
    if (!(await guardTeamPermission(isTeamContext, teamPerms.canWriteFile(), action))) return;
    if (!sugManagerRef.current || !ydoc) return;

    const removesText = outcome === 'accepted' ? sug.type === 'delete' : sug.type === 'insert';
    if (removesText) {
      const startAbs = toAbsolute(sug.start_pos, ydoc);
      const endAbs = toAbsolute(sug.end_pos, ydoc);
      if (startAbs && endAbs && startAbs.index < endAbs.index) {
        const ytext = ydoc.getText('markdown');
        ydoc.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
      }
    }
    sugManagerRef.current.resolveSuggestion(sug.id, outcome);
  };

  const handleAcceptSuggestion = (sug: Suggestion) => settleSuggestion(sug, 'accepted');
  const handleRejectSuggestion = (sug: Suggestion) => settleSuggestion(sug, 'rejected');

  const onAddSuggestionReply = (sugId: string, text: string) => {
    if (!sugManagerRef.current) return;
    if (!isTeamContext) { sugManagerRef.current.addReply(sugId, text, currentUserName); return; }
    if (!teamPerms.canReviseFile()) { showAlertDialog('Permission Denied', 'You do not have permission to reply to suggestions.'); return; }
    sugManagerRef.current.addReply(sugId, text, currentUserName);
  };

  const onAddAnnotationReply = (annId: string, text: string) => {
    if (!annotationManagerRef.current) return;
    if (!isTeamContext) { annotationManagerRef.current.addReply(annId, text, currentUserName); return; }
    if (!teamPerms.canReviseFile()) { showAlertDialog('Permission Denied', 'You do not have permission to reply to annotations.'); return; }
    annotationManagerRef.current.addReply(annId, text, currentUserName);
  };

  const onResolveAnnotation = (id: string) => {
    if (!annotationManagerRef.current) return;
    if (!isTeamContext) { annotationManagerRef.current.resolveAnnotation(id); return; }
    if (!teamPerms.canReviseFile()) { showAlertDialog('Permission Denied', 'You do not have permission to resolve annotations.'); return; }
    annotationManagerRef.current.resolveAnnotation(id);
  };

  return {
    annotations, suggestions, reviewFilter, setReviewFilter, cardRefs,
    lintIssues, readabilityStats, grammarError,
    activeAnnotationId, activeSuggestionId, activeLintIssueId,
    handleCardClick, handleJumpToIssue, handleApplyFix,
    handleAcceptSuggestion, handleRejectSuggestion,
    onAddSuggestionReply, onAddAnnotationReply, onResolveAnnotation,
  };
}
