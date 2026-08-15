import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { createEditor, EditorHandle } from "../../editor/createEditor";
import { Awareness } from "y-protocols/awareness";
import { AnnotationManager } from "../../yjs/annotations";
import { SuggestionManager } from "../../yjs/suggestions";
import { toAbsolute } from "../../yjs/relativePositions";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { useAuth } from "../../auth/AuthProvider";
import { usePlan } from "../../billing/PlanProvider";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { createFontTheme } from "../../editor/themes/themeConfig";
import { useSettingsStore } from "../../settings/settingsStore";
import { useValeLintStore } from "../../settings/valeLintStore";
import { registry } from "../../yjs/DocumentRegistry";
import { useDocumentAssets } from "../../images/useDocumentAssets";
import { getContextFromYdoc } from "../../excalidraw/excalidrawService";
import { usePlanStore } from "../../billing/PlanProvider";
import { useSyncStatusStore } from "../../cloud/syncStatusStore";
import { auth } from "../../auth/firebase";
import { setCurrentExcalidrawDocumentId, setImageAnnotationManager, setImageAuthorId, setImageYdoc } from "../../editor/extensions/inlinePreview/interactions";
import { linkCommand } from "../../editor/formatting/commands";
import { refreshInlinePreviewEffect } from "../../editor/extensions/inlinePreview/settingsRefresh";
import { valeLintExtension } from "../../editor/extensions/valeLintExtension";
import { parseDocumentMetrics } from "../../settings/metrics/metricsParser";
import { suggestionsExtension, setSuggestionsEffect } from "../../editor/extensions/suggestionsExtension";
import { buildMetricLintAlerts, filterLintAlerts, sanitizeMarkdownForLint } from "../../review/reviewIssues";
import type { LintIgnoreState } from "../../review/reviewIssues";
import { getActiveHeading } from "./headingUtils";

const readStr = (v: unknown): string[] => Array.isArray(v) ? v.filter((i): i is string => typeof i === "string") : [];
const readIgnore = (doc: Y.Doc): LintIgnoreState => { const m = doc.getMap("meta"); return { ignoredItemIds: readStr(m.get("ignored_lint_item_ids")), ignoredRules: readStr(m.get("ignored_lint_rules")), resolvedItemIds: readStr(m.get("resolved_lint_item_ids")) }; };

export function useReviseEditor(ydoc: Y.Doc, documentId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const rc = useRef(new Compartment());
  const sc = useRef(new Compartment());
  const [annManager, setAnnManager] = useState<AnnotationManager | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [lintIgnore, setLintIgnore] = useState<LintIgnoreState>({ ignoredItemIds: [], ignoredRules: [], resolvedItemIds: [] });
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const saved = useRef<{ from: number; to: number } | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const { setActiveHeading, setActiveAnnotationId, setActiveSuggestionId } = useWorkspace();
  const { settings } = useSettingsStore();
  const valeAlerts = useValeLintStore((s) => s.alerts);
  const { user } = useAuth();
  const { isTeam } = usePlan();
  const authorId = user?.display_name || user?.email?.split('@')[0] || 'Teammate';

  useEffect(() => {
    if (!ydoc) { setAwareness(null); return; }
    if (!documentId) { setAwareness(new Awareness(ydoc)); return; }
    let active = true, tid: any;
    const check = () => {
      const p = registry.getProvider(documentId);
      if (p) { if (active) setAwareness(p.awareness); }
      else if (isTeam) tid = setTimeout(check, 50);
      else if (active) setAwareness(new Awareness(ydoc));
    };
    check();
    return () => { active = false; if (tid) clearTimeout(tid); };
  }, [ydoc, documentId, isTeam]);

  useEffect(() => {
    document.body.setAttribute("data-focus-mode", focusMode ? "true" : "false");
    return () => document.body.removeAttribute("data-focus-mode");
  }, [focusMode]);

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
    return getContextFromYdoc(ydoc, isCloud, plan.teamId || undefined, auth.currentUser?.uid);
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

    const cl = EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged) return;
      setActiveHeading(getActiveHeading(u.state));
      const pos = u.state.selection.main.head;
      const activeAnn = aMgr.getAnnotations().find((a) => {
        const sa = toAbsolute(a.start_pos, ydoc);
        const ea = toAbsolute(a.end_pos, ydoc);
        return sa && ea && pos >= sa.index && pos <= ea.index && !a.resolved;
      });
      setActiveAnnotationId(activeAnn ? activeAnn.id : null);
      const activeSug = sMgr.getSuggestions().find((s) => {
        const sa = toAbsolute(s.start_pos, ydoc);
        const ea = toAbsolute(s.end_pos, ydoc);
        return sa && ea && pos >= sa.index && pos <= ea.index && !s.resolved;
      });
      setActiveSuggestionId(activeSug ? activeSug.id : null);
    });

    const handle = createEditor(containerRef.current, ydoc.getText("markdown"), awareness, [
      cl,
      suggestionsExtension(ydoc.getText("markdown"), sMgr, authorId),
      sc.current.of(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })),
      valeLintExtension(settings.showProseLint),
    ], aMgr);
    handleRef.current = handle;
    setEditorView(handle.view);

    handle.view.dispatch({ effects: setSuggestionsEffect.of(sMgr.getSuggestions()) });
    const sugCb = () => { if (handle.view.dom.isConnected) handle.view.dispatch({ effects: setSuggestionsEffect.of(sMgr.getSuggestions()) }); };
    sMgr.observe(sugCb);

    const hScroll = (e: Event) => {
      const li = (e as CustomEvent).detail?.lineIndex;
      if (!handleRef.current || typeof li !== "number") return;
      const v = handleRef.current.view;
      const ln = Math.min(Math.max(1, li + 1), v.state.doc.lines);
      const l = v.state.doc.line(ln);
      v.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 40 }), selection: { anchor: l.from } });
      v.focus();
    };
    window.addEventListener("editor-scroll-to-line", hScroll);

    const hSel = (e: Event) => {
      const { from, to } = (e as CustomEvent).detail;
      const v = handle.view;
      if (typeof from !== "number" || typeof to !== "number") return;
      v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center", yMargin: 80 }) });
      requestAnimationFrame(() => { const n = v.domAtPos(from).node; ((n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as Element)?.scrollIntoView({ behavior: "smooth", block: "center" }); });
      v.focus();
    };
    window.addEventListener("editor-select-range", hSel);

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
      window.removeEventListener("editor-scroll-to-line", hScroll);
      window.removeEventListener("editor-select-range", hSel);
      containerRef.current?.removeEventListener("contextmenu", cm);
      handle.destroy();
      handleRef.current = null;
      setImageAnnotationManager(null);
      setActiveHeading(null); setActiveAnnotationId(null); setActiveSuggestionId(null);
    };
  }, [ydoc, documentId, awareness, setActiveHeading, setActiveAnnotationId, setActiveSuggestionId, authorId]);

  useEffect(() => { handleRef.current?.view.dispatch({ effects: refreshInlinePreviewEffect.of() }); }, [settings.livePreview]);

  useEffect(() => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({ effects: sc.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })) });
  }, [settings.spellCheck]);

  useEffect(() => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({ effects: handleRef.current.fontCompartment.reconfigure(createFontTheme(settings.fontFamily, settings.fontSize, settings.lineHeight ?? "1.8")) });
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    if (!handleRef.current) return;
    if (!settings.showProseLint) { handleRef.current.updateValeAlerts([]); return; }
    const text = ydoc.getText("markdown")?.toString() || "";
    const metrics = parseDocumentMetrics(sanitizeMarkdownForLint(text));
    const flat = Object.values(valeAlerts).flat();
    handleRef.current.updateValeAlerts(filterLintAlerts([...flat, ...buildMetricLintAlerts(metrics)], lintIgnore, text));
  }, [settings.showProseLint, valeAlerts, ydoc, lintIgnore]);

  useEffect(() => {
    const refresh = () => {
      if (!handleRef.current || !settings.showProseLint) { handleRef.current?.updateValeAlerts([]); return; }
      const text = ydoc.getText("markdown")?.toString() || "";
      const li = readIgnore(ydoc);
      setLintIgnore(li);
      const flat = Object.values(useValeLintStore.getState().alerts).flat();
      handleRef.current.updateValeAlerts(filterLintAlerts([...flat, ...buildMetricLintAlerts(parseDocumentMetrics(sanitizeMarkdownForLint(text)))], li, text));
    };
    window.addEventListener("editor-refresh-lint", refresh);
    return () => window.removeEventListener("editor-refresh-lint", refresh);
  }, [settings.showProseLint, ydoc]);

  const handleCopy = useCallback(async () => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    try { await navigator.clipboard.writeText(v.state.doc.sliceString(s.from, s.to)); } catch { }
  }, []);

  const handleCut = useCallback(async () => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    try { await navigator.clipboard.writeText(v.state.doc.sliceString(s.from, s.to)); } catch { }
    v.dispatch({ changes: { from: s.from, to: s.to, insert: "" }, selection: { anchor: s.from } });
  }, []);

  const handlePaste = useCallback(async () => {
    const v = handleRef.current?.view;
    if (!v) return;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const s = saved.current ?? v.state.selection.main;
    v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } });
  }, []);

  const handleDelete = useCallback(() => {
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s || s.from === s.to) return;
    v.dispatch({ changes: { from: s.from, to: s.to, insert: "" }, selection: { anchor: s.from } });
  }, []);

  const handleAddNote = useCallback((noteText: string) => {
    if (!annManager) return;
    const v = handleRef.current?.view, s = saved.current;
    if (!v || !s) return;
    const ytext = ydoc.getText("markdown");
    const st = Y.createRelativePositionFromTypeIndex(ytext, s.from, -1);
    const en = Y.createRelativePositionFromTypeIndex(ytext, s.to, -1);
    annManager.addAnnotation(Math.random().toString(36).substring(2, 9), documentId, authorId, st, en, v.state.doc.sliceString(s.from, s.to), noteText);
  }, [annManager, ydoc, documentId, authorId]);

  const handleInsertLink = useCallback(() => {
    const v = handleRef.current?.view;
    if (!v) return;
    linkCommand.apply(v);
  }, []);

  const setEditorReadOnly = useCallback((ro: boolean) => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({ effects: rc.current.reconfigure(EditorState.readOnly.of(ro)) });
  }, []);

  return { containerRef, annManager, focusMode, contextMenuPos, hasSelection, setEditorReadOnly, handleCopy, handleCut, handlePaste, handleDelete, handleAddNote, handleInsertLink, onCloseContextMenu: useCallback(() => setContextMenuPos(null), []) };
}
