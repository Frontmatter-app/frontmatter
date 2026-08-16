import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { createEditor, EditorHandle } from "../../editor/createEditor";
import { AnnotationManager } from "../../yjs/annotations";
import { SuggestionManager } from "../../yjs/suggestions";
import { AnchorIndex } from "../../yjs/anchorIndex";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { useAuth } from "../../auth/AuthProvider";
import { usePlan } from "../../billing/PlanProvider";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { useSettingsStore } from "../../settings/settingsStore";
import { useProseScanStore } from "../../review/proseScanStore";
import { useDocumentAssets } from "../../images/useDocumentAssets";
import { getContextFromYdoc } from "../../excalidraw/excalidrawService";
import { usePlanStore } from "../../billing/PlanProvider";
import { useSyncStatusStore } from "../../cloud/syncStatusStore";
import { getCurrentUser } from "../../auth/session";
import { setCurrentExcalidrawDocumentId, setImageAnnotationManager, setImageAuthorId, setImageYdoc } from "../../editor/extensions/inlinePreview/interactions";
import { linkCommand } from "../../editor/formatting/commands";
import { getLintIssues, proseLintExtension, revealLintIssue } from "../../editor/extensions/proseLintExtension";
import { autoCorrectExtension } from "../../editor/extensions/autoCorrectExtension";
import type { AutoCorrectOptions } from "../../editor/extensions/autoCorrect";
import { suggestionsExtension, setSuggestionsEffect } from "../../editor/extensions/suggestionsExtension";
import { analyzeDocument } from "../../review/lintPipeline";
import { useLintSelection, REVEAL_LINT_ISSUE, APPLY_LINT_FIX } from "../../review/lintSelectionStore";
import { EMPTY_IGNORE_STATE, type LintIgnoreState, type LintIssue } from "../../review/lintTypes";
import { getActiveHeading } from "./headingUtils";
import { guardTeamPermission } from "../../auth/permissionGuards";
import {
  useAwareness,
  useEditorAppearance,
  useEditorNavigation,
  useFocusModeAttribute,
  useTransclusionDocument,
  setEditorReadOnly as setEditorReadOnlyOn,
} from "../../editor/useEditorShell";
import { useTeamPermissions } from "../../auth/teamPermissions";
import { Transaction } from "@codemirror/state";
import { v4 as uuid } from "uuid";

/**
 * Applies an edit the way a keystroke would.
 *
 * Two things a bare `view.dispatch({ changes })` skips, both of which the
 * context menu was skipping:
 *
 *  - `EditorState.readOnly` only stops user input, not programmatic dispatch,
 *    so Cut and Delete still mutated a document the banner called read-only.
 *  - Suggest mode keys off `Transaction.userEvent`. Without it, an edit made
 *    from the menu bypassed tracked changes and altered the text outright.
 */
function dispatchEdit(
  view: EditorView,
  spec: { changes: { from: number; to: number; insert: string }; selection?: { anchor: number } },
  userEvent: string,
): boolean {
  if (view.state.readOnly) return false;
  view.dispatch({ ...spec, annotations: Transaction.userEvent.of(userEvent) });
  return true;
}

const readStr = (v: unknown): string[] => Array.isArray(v) ? v.filter((i): i is string => typeof i === "string") : [];
const readIgnore = (doc: Y.Doc): LintIgnoreState => { const m = doc.getMap("meta"); return { ignoredItemIds: readStr(m.get("ignored_lint_item_ids")), ignoredRules: readStr(m.get("ignored_lint_rules")), resolvedItemIds: readStr(m.get("resolved_lint_item_ids")) }; };

export function useReviseEditor(ydoc: Y.Doc, documentId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const rc = useRef(new Compartment());
  const sc = useRef(new Compartment());
  const [annManager, setAnnManager] = useState<AnnotationManager | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [lintIgnore, setLintIgnore] = useState<LintIgnoreState>(EMPTY_IGNORE_STATE);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const saved = useRef<{ from: number; to: number } | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const { setActiveHeading, setActiveAnnotationId, setActiveSuggestionId } = useWorkspace();
  const { settings } = useSettingsStore();
  const grammarScan = useProseScanStore((s) => s.grammar);

  // The editor is built once, so anything the extensions read at keystroke
  // time has to come through a ref. Passing the values directly would freeze
  // whatever they were when the document opened — which is exactly why
  // toggling prose lint on used to do nothing until the view was remounted.
  const autoCorrectRef = useRef<AutoCorrectOptions>({ corrections: true, smartPunctuation: true });
  autoCorrectRef.current = {
    corrections: settings.autoCorrect ?? true,
    smartPunctuation: settings.smartPunctuation ?? true,
  };
  const { user } = useAuth();
  const { isTeam } = usePlan();
  const teamPerms = useTeamPermissions();
  const isTeamContext = isTeam;
  const authorId = user?.display_name || user?.email?.split('@')[0] || 'Teammate';

  const awareness = useAwareness(ydoc, documentId);
  useFocusModeAttribute(focusMode);
  useTransclusionDocument(ydoc);

  useEffect(() => {
    setCurrentExcalidrawDocumentId(documentId);
    setImageYdoc(ydoc);
    setImageAuthorId(authorId);
    return () => { setCurrentExcalidrawDocumentId(null); setImageYdoc(null); setImageAuthorId(""); };
  }, [documentId, ydoc, authorId]);

  // This view renders the same inline image previews as the write view, so it
  // needs the same resolution. Without it, relative references resolved against
  // whichever document the write view had opened last.
  useDocumentAssets(ydoc, editorView, (() => {
    if (!ydoc || !documentId) return null;
    const plan = usePlanStore.getState();
    const isCloud =
      plan.activeContext.type === "team" ||
      useSyncStatusStore.getState().cloudDocumentIds.has(documentId);
    return getContextFromYdoc(ydoc, isCloud, plan.teamId || undefined, getCurrentUser()?.id);
  })());

  // Main editor setup
  useEffect(() => {
    if (!containerRef.current || !ydoc || !documentId || !awareness) return;
    setFocusMode((ydoc.getMap("meta").get("focus_mode") as boolean) || false);
    setLintIgnore(readIgnore(ydoc));
    const obs = () => { setFocusMode((ydoc.getMap("meta").get("focus_mode") as boolean) || false); setLintIgnore(readIgnore(ydoc)); };
    ydoc.getMap("meta").observe(obs);

    const aMgr = new AnnotationManager(ydoc, documentId);
    setAnnManager(aMgr);
    setImageAnnotationManager(aMgr);

    const sMgr = new SuggestionManager(ydoc, documentId);

    // Rebuilt when the lists change or the document does, not on every caret
    // move — resolving an anchor means decoding it, and this ran once per note
    // per keystroke.
    let annIndex = new AnchorIndex(aMgr.getAnnotations(), ydoc);
    let sugIndex = new AnchorIndex(sMgr.getSuggestions(), ydoc);
    const reindexAnnotations = () => { annIndex = new AnchorIndex(aMgr.getAnnotations(), ydoc); };
    const reindexSuggestions = () => { sugIndex = new AnchorIndex(sMgr.getSuggestions(), ydoc); };
    aMgr.observe(reindexAnnotations);
    sMgr.observe(reindexSuggestions);

    const cl = EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged) return;
      if (u.docChanged) { reindexAnnotations(); reindexSuggestions(); }
      setActiveHeading(getActiveHeading(u.state));
      const pos = u.state.selection.main.head;
      setActiveAnnotationId(annIndex.at(pos));
      setActiveSuggestionId(sugIndex.at(pos));
    });

    const handle = createEditor(containerRef.current, ydoc.getText("markdown"), awareness, [
      cl,
      suggestionsExtension(ydoc.getText("markdown"), sMgr, authorId),
      sc.current.of(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })),
      // Revise is the only stage that lints and the only stage that corrects.
      // Write stays a blank page you can type into without being argued with.
      proseLintExtension({
        onActivate: (issue) => useLintSelection.getState().setActiveIssueId(issue?.id ?? null),
      }),
      autoCorrectExtension(() => autoCorrectRef.current),
    ], aMgr);
    handleRef.current = handle;
    setEditorView(handle.view);

    handle.view.dispatch({ effects: setSuggestionsEffect.of(sMgr.getSuggestions()) });
    const sugCb = () => { if (handle.view.dom.isConnected) handle.view.dispatch({ effects: setSuggestionsEffect.of(sMgr.getSuggestions()) }); };
    sMgr.observe(sugCb);

    const cm = (e: MouseEvent) => {
      e.preventDefault();
      const v = handleRef.current?.view;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      saved.current = { from, to };
      setHasSelection(from !== to);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    };
    containerRef.current.addEventListener("contextmenu", cm);

    return () => {
      ydoc.getMap("meta").unobserve(obs);
      sMgr.unobserve(sugCb);
      aMgr.unobserve(reindexAnnotations);
      sMgr.unobserve(reindexSuggestions);
      containerRef.current?.removeEventListener("contextmenu", cm);
      handle.destroy();
      handleRef.current = null;
      setImageAnnotationManager(null);
      setActiveHeading(null); setActiveAnnotationId(null); setActiveSuggestionId(null);
    };
  }, [ydoc, documentId, awareness, setActiveHeading, setActiveAnnotationId, setActiveSuggestionId, authorId]);

  useEditorNavigation(handleRef);
  useEditorAppearance(handleRef, settings, sc.current);

  /**
   * Keeps the highlights current.
   *
   * Readability and inclusive language are computed here and cost nothing but
   * a short debounce, which is why the sentence colours track the sentence you
   * are editing. Grammar results arriving from Rust, an ignore choice being
   * made, and the setting being toggled all push through the same function, so
   * there is one code path instead of the two that had already drifted apart.
   */
  useEffect(() => {
    if (!ydoc) return;
    const ytext = ydoc.getText("markdown");
    let timer: ReturnType<typeof setTimeout> | null = null;

    const push = () => {
      const handle = handleRef.current;
      if (!handle) return;
      if (!settings.showProseLint) {
        handle.updateLintIssues([]);
        return;
      }
      const { issues } = analyzeDocument(
        ytext.toString(),
        useProseScanStore.getState().grammar,
        readIgnore(ydoc),
      );
      handle.updateLintIssues(issues);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, 150);
    };

    push();
    ytext.observe(schedule);
    window.addEventListener("editor-refresh-lint", push);
    return () => {
      if (timer) clearTimeout(timer);
      ytext.unobserve(schedule);
      window.removeEventListener("editor-refresh-lint", push);
    };
  }, [ydoc, settings.showProseLint, grammarScan, lintIgnore]);

  /** The sidebar half of the round trip: a card click scrolls the editor. */
  useEffect(() => {
    const reveal = (event: Event) => {
      const issue = (event as CustomEvent<{ issue?: LintIssue }>).detail?.issue;
      const view = handleRef.current?.view;
      if (issue && view) revealLintIssue(view, issue);
    };

    /**
     * A quick fix taken from a card.
     *
     * Unlike autocorrect this carries a user event, so in Revise it becomes a
     * tracked change like any other edit a reviewer makes — the point of the
     * stage is that nothing is rewritten behind the writer's back.
     */
    const applyFix = (event: Event) => {
      const { issue, replacement } = (event as CustomEvent<{ issue?: LintIssue; replacement?: string }>).detail ?? {};
      const view = handleRef.current?.view;
      if (!issue || replacement === undefined || !view) return;
      // Same reason as revealing: take the editor's copy of the range, which
      // has followed the edits, over the sidebar's, which is a debounce old.
      // The check below then refuses to rewrite anything that is not the exact
      // text the fix was offered for.
      const current = getLintIssues(view).find((held) => held.id === issue.id) ?? issue;
      const to = Math.min(current.to, view.state.doc.length);
      const from = Math.min(current.from, to);
      if (view.state.doc.sliceString(from, to) !== issue.match) return;
      dispatchEdit(view, { changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length } }, "input.replace");
    };

    window.addEventListener(REVEAL_LINT_ISSUE, reveal);
    window.addEventListener(APPLY_LINT_FIX, applyFix);
    return () => {
      window.removeEventListener(REVEAL_LINT_ISSUE, reveal);
      window.removeEventListener(APPLY_LINT_FIX, applyFix);
      useLintSelection.getState().setActiveIssueId(null);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    try { await navigator.clipboard.writeText(v.state.doc.sliceString(s.from, s.to)); } catch { }
  }, []);

  const handleCut = useCallback(async () => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    try { await navigator.clipboard.writeText(v.state.doc.sliceString(s.from, s.to)); } catch { }
    dispatchEdit(v, { changes: { from: s.from, to: s.to, insert: "" }, selection: { anchor: s.from } }, "delete");
  }, []);

  const handlePaste = useCallback(async () => {
    const v = handleRef.current?.view;
    if (!v) return;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const s = saved.current ?? v.state.selection.main;
    dispatchEdit(v, { changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } }, "input.paste");
  }, []);

  const handleDelete = useCallback(() => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    dispatchEdit(v, { changes: { from: s.from, to: s.to, insert: "" }, selection: { anchor: s.from } }, "delete");
  }, []);

  const handleAddNote = useCallback(async (noteText: string) => {
    if (!annManager) return;
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s) return;
    // The sidebar guards every other way of touching a note; this path had none
    // at all, so the context menu was a way around the permission check.
    if (!(await guardTeamPermission(isTeamContext, teamPerms.canReviseFile(), "add notes"))) return;
    const ytext = ydoc.getText("markdown");
    const st = Y.createRelativePositionFromTypeIndex(ytext, s.from, -1);
    const en = Y.createRelativePositionFromTypeIndex(ytext, s.to, -1);
    annManager.addAnnotation(uuid(), documentId, authorId, st, en, v.state.doc.sliceString(s.from, s.to), noteText);
  }, [annManager, ydoc, documentId, authorId, isTeamContext, teamPerms]);

  const handleInsertLink = useCallback(() => {
    const v = handleRef.current?.view;
    if (!v) return;
    linkCommand.apply(v);
  }, []);

  const setEditorReadOnly = useCallback((ro: boolean) => {
    setEditorReadOnlyOn(handleRef.current, rc.current, ro);
  }, []);

  return { containerRef, annManager, focusMode, contextMenuPos, hasSelection, setEditorReadOnly, handleCopy, handleCut, handlePaste, handleDelete, handleAddNote, handleInsertLink, onCloseContextMenu: useCallback(() => setContextMenuPos(null), []) };
}
