import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { createEditor, EditorHandle } from "../../editor/createEditor";
import { Awareness } from "y-protocols/awareness";
import { AnnotationManager } from "../../yjs/annotations";
import { SuggestionManager } from "../../yjs/suggestions";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { useAuth } from "../../auth/AuthProvider";
import { usePlan } from "../../billing/PlanProvider";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorContextMenu } from "../../components/EditorContextMenu";
import { createFontTheme } from "../../editor/themes/themeConfig";
import { useSettingsStore } from "../../settings/settingsStore";
import { useValeLintStore } from "../../settings/valeLintStore";
import { registry } from "../../yjs/DocumentRegistry";
import { setCurrentExcalidrawDocumentId, setImageAnnotationManager, setImageAuthorId, setImageYdoc } from "../../editor/extensions/inlinePreview/interactions";
import { refreshInlinePreviewEffect } from "../../editor/extensions/inlinePreview/settingsRefresh";
import { valeLintExtension, setValeAlertsEffect } from "../../editor/valeLintExtension";
import { parseDocumentMetrics } from "../../settings/metrics/metricsParser";
import { suggestionsExtension, setSuggestionsEffect } from "../../editor/suggestionsExtension";
import { buildMetricLintAlerts, filterLintAlerts, sanitizeMarkdownForLint } from "../../review/reviewIssues";
import type { LintIgnoreState } from "../../review/reviewIssues";

function getActiveHeading(state: EditorState): string | null {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  for (let i = line.number; i >= 1; i--) {
    const text = state.doc.line(i).text.trim();
    const match = text.match(/^(#{1,6})\s+(.*)$/);
    if (match) return match[2].trim();
  }
  return null;
}

export function ReviseView({
  ydoc,
  documentId,
}: {
  ydoc: Y.Doc;
  documentId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [annManager, setAnnManager] = useState<AnnotationManager | null>(null);
  const [sugManager, setSugManager] = useState<SuggestionManager | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [lintIgnoreState, setLintIgnoreState] = useState<LintIgnoreState>({
    ignoredItemIds: [],
    ignoredRules: [],
    resolvedItemIds: [],
  });
  const { setActiveHeading, setActiveAnnotationId, setActiveSuggestionId } = useWorkspace();
  const { settings } = useSettingsStore();
  const valeAlerts = useValeLintStore((state) => state.alerts);
  const { user } = useAuth();
  const { isTeam } = usePlan();
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const spellCheckCompartmentRef = useRef<Compartment>(new Compartment());

  // Context menu state
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const savedSel = useRef<{ from: number; to: number } | null>(null);

  const authorId = user?.display_name || user?.email?.split('@')[0] || 'Teammate';

  const readStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  const readLintIgnoreState = (doc: Y.Doc): LintIgnoreState => {
    const meta = doc.getMap("meta");
    return {
      ignoredItemIds: readStringArray(meta.get("ignored_lint_item_ids")),
      ignoredRules: readStringArray(meta.get("ignored_lint_rules")),
      resolvedItemIds: readStringArray(meta.get("resolved_lint_item_ids")),
    };
  };

  // ── Wait for collaborative provider awareness or fallback ─────────────────
  useEffect(() => {
    if (!ydoc) {
      setAwareness(null);
      return;
    }

    if (!documentId) {
      setAwareness(new Awareness(ydoc));
      return;
    }

    let active = true;
    let timeoutId: any;

    const checkProvider = () => {
      const provider = registry.getProvider(documentId);
      if (provider) {
        if (active) {
          setAwareness(provider.awareness);
        }
      } else if (isTeam) {
        timeoutId = setTimeout(checkProvider, 50);
      } else {
        if (active) {
          setAwareness(new Awareness(ydoc));
        }
      }
    };

    checkProvider();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [ydoc, documentId, isTeam]);

  // ── Sync focus mode to body attribute so CSS can dim sidebars ─────────────
  useEffect(() => {
    document.body.setAttribute('data-focus-mode', focusMode ? 'true' : 'false');
    return () => { document.body.removeAttribute('data-focus-mode'); };
  }, [focusMode]);

  // ── Expose document ID to Excalidraw context menu ──────────────────────
  useEffect(() => {
    setCurrentExcalidrawDocumentId(documentId);
    setImageYdoc(ydoc);
    setImageAuthorId(authorId);
    return () => {
      setCurrentExcalidrawDocumentId(null);
      setImageYdoc(null);
      setImageAuthorId('');
    };
  }, [documentId, ydoc, authorId]);

  // ── Build editor ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !ydoc || !documentId || !awareness) return;

    setFocusMode((ydoc.getMap("meta").get("focus_mode") as boolean) || false);
    setLintIgnoreState(readLintIgnoreState(ydoc));
    const observer = () => {
      setFocusMode((ydoc.getMap("meta").get("focus_mode") as boolean) || false);
      setLintIgnoreState(readLintIgnoreState(ydoc));
    };
    ydoc.getMap("meta").observe(observer);

    const aManager = new AnnotationManager(ydoc, documentId);
    setAnnManager(aManager);
    setImageAnnotationManager(aManager);

    const sManager = new SuggestionManager(ydoc, documentId);
    setSugManager(sManager);

    // Track cursor and selection to highlight corresponding sidebar items
    const cursorListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        setActiveHeading(getActiveHeading(update.state));

        const pos = update.state.selection.main.head;
        
        // Find if cursor is inside any pending annotation
        const activeAnn = aManager.getAnnotations().find(ann => {
          const startAbs = Y.createAbsolutePositionFromRelativePosition(ann.start_pos, ydoc);
          const endAbs = Y.createAbsolutePositionFromRelativePosition(ann.end_pos, ydoc);
          return startAbs && endAbs && pos >= startAbs.index && pos <= endAbs.index && !ann.resolved;
        });
        setActiveAnnotationId(activeAnn ? activeAnn.id : null);

        // Find if cursor is inside any pending suggestion
        const activeSug = sManager.getSuggestions().find(sug => {
          const startAbs = Y.createAbsolutePositionFromRelativePosition(sug.start_pos, ydoc);
          const endAbs = Y.createAbsolutePositionFromRelativePosition(sug.end_pos, ydoc);
          return startAbs && endAbs && pos >= startAbs.index && pos <= endAbs.index && !sug.resolved;
        });
        setActiveSuggestionId(activeSug ? activeSug.id : null);
      }
    });

    const spellCompartment = spellCheckCompartmentRef.current;
    const handle = createEditor(
      containerRef.current,
      ydoc.getText("markdown"),
      awareness,
      [
        cursorListener,
        suggestionsExtension(ydoc.getText("markdown"), sManager, authorId),
        valeLintExtension(settings.showProseLint),
        spellCompartment.of(
          EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
        ),
      ],
      aManager,
    );
    handleRef.current = handle;

    // Handle pending scroll-to-line (from diagnostics popover, etc.)
    const pendingLine = window.__pendingScrollLine;
    if (pendingLine !== undefined && typeof pendingLine === 'number') {
      window.__pendingScrollLine = undefined;
      const lineNum = Math.min(Math.max(1, pendingLine + 1), handle.view.state.doc.lines);
      const line = handle.view.state.doc.line(lineNum);
      handle.view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
        selection: { anchor: line.from }
      });
      handle.view.focus();
    }

    // Initial suggestion sync
    handle.view.dispatch({
      effects: setSuggestionsEffect.of(sManager.getSuggestions())
    });

    // Observe suggestions updates
    const sugCallback = () => {
      if (!handle.view.dom.isConnected) return;
      handle.view.dispatch({
        effects: setSuggestionsEffect.of(sManager.getSuggestions())
      });
    };
    sManager.observe(sugCallback);

    const handleScrollToLine = (e: Event) => {
      const customEvent = e as CustomEvent<{ lineIndex: number }>;
      const lineIndex = customEvent.detail?.lineIndex;
      const view = handle.view;
      if (view && typeof lineIndex === 'number') {
        const lineNum = Math.min(Math.max(1, lineIndex + 1), view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
          selection: { anchor: line.from }
        });
        view.focus();
      }
    };
    window.addEventListener('editor-scroll-to-line', handleScrollToLine);

    const handleSelectRange = (e: Event) => {
      const customEvent = e as CustomEvent<{ from: number; to: number }>;
      const { from, to } = customEvent.detail;
      const view = handle.view;
      if (view && typeof from === 'number' && typeof to === 'number') {
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 80 }),
        });
        requestAnimationFrame(() => {
          const node = view.domAtPos(from).node;
          const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        view.focus();
      }
    };
    window.addEventListener('editor-select-range', handleSelectRange);

    const container = containerRef.current;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const view = handleRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      savedSel.current = { from, to };
      setHasSelection(from !== to);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    };

    container.addEventListener("contextmenu", handleContextMenu);

    return () => {
      ydoc.getMap("meta").unobserve(observer);
      sManager.unobserve(sugCallback);
      window.removeEventListener('editor-scroll-to-line', handleScrollToLine);
      window.removeEventListener('editor-select-range', handleSelectRange);
      container.removeEventListener("contextmenu", handleContextMenu);
      setImageAnnotationManager(null);
      handle.destroy();
      handleRef.current = null;
      setActiveHeading(null);
      setActiveAnnotationId(null);
      setActiveSuggestionId(null);
    };
  }, [ydoc, documentId, awareness, setActiveHeading, setActiveAnnotationId, setActiveSuggestionId, authorId]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: refreshInlinePreviewEffect.of(),
    });
  }, [settings.livePreview]);

  // Live font reconfiguration
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: handle.fontCompartment.reconfigure(
        createFontTheme(settings.fontFamily, settings.fontSize, settings.lineHeight ?? '1.8')
      ),
    });
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  // Live spellcheck reconfiguration
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: spellCheckCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
      ),
    });
  }, [settings.spellCheck]);

  // Live lint updates: Vale alerts + style warnings
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    if (!settings.showProseLint) {
      handle.updateValeAlerts([]);
      return;
    }

    const valeAlerts = useValeLintStore.getState().alerts;
    const flatVale = Object.values(valeAlerts).flat();

    const text = ydoc.getText('markdown')?.toString() || '';
    const metrics = parseDocumentMetrics(sanitizeMarkdownForLint(text));

    handle.updateValeAlerts(filterLintAlerts([...flatVale, ...buildMetricLintAlerts(metrics)], lintIgnoreState, text));
  }, [settings.showProseLint, valeAlerts, ydoc, lintIgnoreState]);

  useEffect(() => {
    const refreshLint = () => {
      const handle = handleRef.current;
      if (!handle || !settings.showProseLint) {
        handle?.updateValeAlerts([]);
        return;
      }

      const text = ydoc.getText('markdown')?.toString() || '';
      const metrics = parseDocumentMetrics(sanitizeMarkdownForLint(text));
      const flatVale = Object.values(useValeLintStore.getState().alerts).flat();
      const latestIgnoreState = readLintIgnoreState(ydoc);
      setLintIgnoreState(latestIgnoreState);
      handle.updateValeAlerts(filterLintAlerts([...flatVale, ...buildMetricLintAlerts(metrics)], latestIgnoreState, text));
    };

    window.addEventListener("editor-refresh-lint", refreshLint);
    return () => window.removeEventListener("editor-refresh-lint", refreshLint);
  }, [settings.showProseLint, ydoc]);

  /* ── Clipboard + editor operations ───────────────────────────────── */

  const handleCopy = useCallback(async () => {
    const view = handleRef.current?.view;
    const sel = savedSel.current;
    if (!view || !sel || sel.from === sel.to) return;
    try {
      await navigator.clipboard.writeText(view.state.doc.sliceString(sel.from, sel.to));
    } catch {}
  }, []);

  const handleCut = useCallback(async () => {
    const view = handleRef.current?.view;
    const sel = savedSel.current;
    if (!view || !sel || sel.from === sel.to) return;
    try {
      await navigator.clipboard.writeText(view.state.doc.sliceString(sel.from, sel.to));
    } catch {}
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: "" },
      selection: { anchor: sel.from },
    });
  }, []);

  const handlePaste = useCallback(async () => {
    const view = handleRef.current?.view;
    if (!view) return;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const sel = savedSel.current ?? view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
    });
  }, []);

  const handleDelete = useCallback(() => {
    const view = handleRef.current?.view;
    const sel = savedSel.current;
    if (!view || !sel || sel.from === sel.to) return;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: "" },
      selection: { anchor: sel.from },
    });
  }, []);

  const handleAddNote = useCallback(
    (noteText: string) => {
      if (!annManager) return;
      const view = handleRef.current?.view;
      const sel = savedSel.current;
      if (!view || !sel) return;
      const ytext = ydoc.getText("markdown");
      const selectedText = view.state.doc.sliceString(sel.from, sel.to);
      const startPos = Y.createRelativePositionFromTypeIndex(ytext, sel.from, -1);
      const endPos = Y.createRelativePositionFromTypeIndex(ytext, sel.to, -1);
      annManager.addAnnotation(
        Math.random().toString(36).substring(2, 9),
        documentId,
        authorId,
        startPos,
        endPos,
        selectedText,
        noteText,
      );
    },
    [annManager, ydoc, documentId, authorId],
  );

  const handleInsertLink = useCallback((url: string) => {
    const view = handleRef.current?.view;
    if (!view) return;
    const sel = savedSel.current ?? view.state.selection.main;
    const selectedText = view.state.doc.sliceString(sel.from, sel.to);
    const md = `[${selectedText || "link text"}](${url})`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: md },
      selection: { anchor: sel.from + md.length },
    });
  }, []);

  return (
    <div className={`w-full h-full pb-32 marktype-editor-container ${focusMode ? "focus-mode-active" : ""}`}>
      <div ref={containerRef} className="w-full h-full min-h-[300px]" data-stage="revise" />

      <EditorContextMenu
        position={contextMenuPos}
        hasSelection={hasSelection}
        onClose={() => setContextMenuPos(null)}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onAddNote={handleAddNote}
        onInsertLink={handleInsertLink}
        onDelete={handleDelete}
      />
    </div>
  );
}
