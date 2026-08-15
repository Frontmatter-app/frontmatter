import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { AnnotationManager, Annotation } from "../../yjs/annotations";
import { SuggestionManager, Suggestion } from "../../yjs/suggestions";
import { toAbsolute } from "../../yjs/relativePositions";
import { useValeLintStore } from "../../settings/valeLintStore";
import { parseDocumentMetrics } from "../../settings/metrics/metricsParser";
import { buildMetricLintAlerts, filterLintAlerts, sanitizeMarkdownForLint } from "../../review/reviewIssues";
import type { LintIgnoreState, ReviewKind } from "../../review/reviewIssues";
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

  const metrics = useMemo(
    () => parseDocumentMetrics(sanitizeMarkdownForLint(docText)),
    [docText],
  );
  const valeAlerts = useValeLintStore((s) => s.alerts);
  const lintAlerts = useMemo(() => {
    return filterLintAlerts([...Object.values(valeAlerts).flat(), ...buildMetricLintAlerts(metrics)], lintIgnoreState, docText);
  }, [docText, lintIgnoreState, metrics, valeAlerts]);

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

  const handleCardClick = (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => {
    if (!ydoc) return;
    const startAbs = toAbsolute(item.start_pos, ydoc);
    const endAbs = toAbsolute(item.end_pos, ydoc);
    if (startAbs && endAbs) window.dispatchEvent(new CustomEvent('editor-select-range', { detail: { from: startAbs.index, to: endAbs.index } }));
  };

  const handleAcceptSuggestion = async (sug: Suggestion) => {
    if (!isTeamContext) {
      if (!sugManagerRef.current) return;
      const ytext = ydoc!.getText('markdown');
      const startAbs = toAbsolute(sug.start_pos, ydoc!);
      const endAbs = toAbsolute(sug.end_pos, ydoc!);
      if (sug.type === 'delete' && startAbs && endAbs && startAbs.index < endAbs.index) {
        ydoc!.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
      }
      sugManagerRef.current.resolveSuggestion(sug.id, 'accepted');
      return;
    }
    if (!(await guardTeamAuth(isTeamContext, user, 'accept suggestions'))) return;
    if (!(await guardTeamPermission(isTeamContext, teamPerms.canWriteFile(), 'accept suggestions'))) return;
    if (!sugManagerRef.current) return;
    const ytext = ydoc!.getText('markdown');
    const startAbs = toAbsolute(sug.start_pos, ydoc!);
    const endAbs = toAbsolute(sug.end_pos, ydoc!);
    if (sug.type === 'delete' && startAbs && endAbs && startAbs.index < endAbs.index) {
      ydoc!.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
    }
    sugManagerRef.current.resolveSuggestion(sug.id, 'accepted');
  };

  const handleRejectSuggestion = async (sug: Suggestion) => {
    if (!isTeamContext) {
      if (!sugManagerRef.current) return;
      const ytext = ydoc!.getText('markdown');
      const startAbs = toAbsolute(sug.start_pos, ydoc!);
      const endAbs = toAbsolute(sug.end_pos, ydoc!);
      if (sug.type === 'insert' && startAbs && endAbs && startAbs.index < endAbs.index) {
        ydoc!.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
      }
      sugManagerRef.current.resolveSuggestion(sug.id, 'rejected');
      return;
    }
    if (!(await guardTeamAuth(isTeamContext, user, 'reject suggestions'))) return;
    if (!(await guardTeamPermission(isTeamContext, teamPerms.canReviseFile(), 'reject suggestions'))) return;
    if (!sugManagerRef.current) return;
    const ytext = ydoc!.getText('markdown');
    const startAbs = toAbsolute(sug.start_pos, ydoc!);
    const endAbs = toAbsolute(sug.end_pos, ydoc!);
    if (sug.type === 'insert' && startAbs && endAbs && startAbs.index < endAbs.index) {
      ydoc!.transact(() => { ytext.delete(startAbs.index, endAbs.index - startAbs.index); }, 'suggestion-apply');
    }
    sugManagerRef.current.resolveSuggestion(sug.id, 'rejected');
  };

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
    lintAlerts,
    activeAnnotationId, activeSuggestionId,
    handleCardClick,
    handleAcceptSuggestion, handleRejectSuggestion,
    onAddSuggestionReply, onAddAnnotationReply, onResolveAnnotation,
  };
}
