import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { createEditor, EditorHandle } from '../../editor/createEditor';
import { Awareness } from 'y-protocols/awareness';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { applyThemeVariablesToDOM, createFontTheme } from '../../editor/themes/themeConfig';
import { useSettingsStore } from '../../settings/settingsStore';
import { registry } from '../../yjs/DocumentRegistry';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { Lock } from 'lucide-react';
import { usePlan } from '../../billing/PlanProvider';
import { referencePickerExtension, setPickerDocumentPath } from '../../editor/extensions/referencePicker';
import { slashCommandExtension, setSlashCommandDocumentId } from '../../editor/extensions/slashCommand';
import { refreshInlinePreviewEffect } from '../../editor/extensions/inlinePreview/settingsRefresh';
import { createPortal } from 'react-dom';
import { EditorContextMenu } from '../../components/EditorContextMenu';
import { SuggestionManager } from '../../yjs/suggestions';
import { suggestionsExtension, setSuggestionsEffect } from '../../editor/suggestionsExtension';


// Returns the full heading line (e.g. "## Introduction") including level markers,
// so the sidebar can match by both level AND title to avoid false matches.
function getActiveHeading(state: EditorState): string | null {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  for (let i = line.number; i >= 1; i--) {
    const text = state.doc.line(i).text.trim();
    const match = text.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      // Return the full heading with its level markers preserved (e.g. "## My Section")
      return text;
    }
  }
  return null;
}

// Map editorWidth setting → max-width in pixels
const WIDTH_MAP: Record<string, string> = {
  narrow: '560px',
  medium: '720px',
  wide:   '900px',
  full:   '100%',
};

export function WriteView({ ydoc, documentId }: { ydoc: Y.Doc; documentId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const readOnlyCompartmentRef = useRef<Compartment>(new Compartment());
  const spellCheckCompartmentRef = useRef<Compartment>(new Compartment());
  const [focusMode, setFocusMode] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const { setActiveHeading, setActiveSuggestionId, documents, workspacePath } = useWorkspace();
  const { settings } = useSettingsStore();
  const teamPerms = useTeamPermissions();
  const { isTeam, teamId } = usePlan();
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const savedSel = useRef<{ from: number; to: number } | null>(null);

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
        // Poll for the provider since team doc is loading
        timeoutId = setTimeout(checkProvider, 50);
      } else {
        // Fallback for non-team docs
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

  // ── Keep the @ reference picker aware of the current document path ──────────
  useEffect(() => {
    if (!documentId) return;
    const absPath = documents.find((d: any) => d.id === documentId)?.file_path ?? '';
    const relPath = workspacePath && absPath.startsWith(workspacePath)
      ? absPath.slice(workspacePath.length).replace(/^\/+/, '')
      : absPath;
    setPickerDocumentPath(relPath);
    setSlashCommandDocumentId(documentId);
  }, [documentId, documents, workspacePath]);

  // ── Build editor once per ydoc and awareness ─────────────────────────────────
  useEffect(() => {
    applyThemeVariablesToDOM();

    if (!containerRef.current || !ydoc || !awareness) return;

    setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);

    const observer = () => {
      setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);
    };
    ydoc.getMap('meta').observe(observer);

    const suggestionManager = documentId ? new SuggestionManager(ydoc, documentId) : null;

    // ── Track cursor movements and broadcast to remote collaborators ──────────
    const cursorListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        setActiveHeading(getActiveHeading(update.state));

        const pos = update.state.selection.main.head;
        const activeSug = suggestionManager?.getSuggestions().find((sug) => {
          const startAbs = Y.createAbsolutePositionFromRelativePosition(sug.start_pos, ydoc);
          const endAbs = Y.createAbsolutePositionFromRelativePosition(sug.end_pos, ydoc);
          return startAbs && endAbs && pos >= startAbs.index && pos <= endAbs.index && !sug.resolved;
        });
        setActiveSuggestionId(activeSug ? activeSug.id : null);
      }
    });

    const roCompartment = readOnlyCompartmentRef.current;
    const spellCompartment = spellCheckCompartmentRef.current;
    let unobserveSuggestions: (() => void) | null = null;
    const handle = createEditor(
      containerRef.current,
      ydoc.getText('markdown'),
      awareness,
      [
        cursorListener,
        suggestionsExtension(ydoc.getText('markdown'), suggestionManager ?? undefined),
        roCompartment.of(EditorState.readOnly.of(false)),
        spellCompartment.of(
          EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
        ),
        ...referencePickerExtension,
        ...slashCommandExtension,
      ],
    );

    handleRef.current = handle;

    if (suggestionManager) {
      const syncSuggestions = () => {
        if (!handle.view.dom.isConnected) return;
        handle.view.dispatch({
          effects: setSuggestionsEffect.of(suggestionManager.getSuggestions()),
        });
      };
      syncSuggestions();
      suggestionManager.observe(syncSuggestions);

      unobserveSuggestions = () => {
        suggestionManager.unobserve(syncSuggestions);
      };
    }

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

    // Add context menu handler for right-click selection menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const view = handle.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      savedSel.current = { from, to };
      setHasSelection(from !== to);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    };
    containerRef.current.addEventListener("contextmenu", handleContextMenu);

    return () => {
      ydoc.getMap('meta').unobserve(observer);
      if (unobserveSuggestions) unobserveSuggestions();
      window.removeEventListener('editor-scroll-to-line', handleScrollToLine);
      window.removeEventListener('editor-select-range', handleSelectRange);
      handle.view.destroy();
      handleRef.current = null;
      setActiveHeading(null);
      setActiveSuggestionId(null);
      containerRef.current?.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [ydoc, awareness, setActiveHeading, setActiveSuggestionId, documentId]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: refreshInlinePreviewEffect.of(),
    });
  }, [settings.livePreview]);

  // ── Live-toggle spellcheck on the CM contenteditable without rebuilding ────
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: spellCheckCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })
      ),
    });
  }, [settings.spellCheck]);

  // ── Live-reconfigure font/size/lineHeight without rebuilding the editor ─────
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: handle.fontCompartment.reconfigure(
        createFontTheme(settings.fontFamily, settings.fontSize, settings.lineHeight ?? '1.8')
      ),
    });
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  // ── Read-only mode based on team filePermissions ─────────────────────────────
  useEffect(() => {
    if (!documentId) { setIsReadOnly(false); return; }
    const doc = documents.find(d => d.id === documentId);
    const filePerms = (doc as any)?.filePermissions;
    const readOnly = !teamPerms.canWriteFile(filePerms);
    setIsReadOnly(readOnly);
    const handle = handleRef.current;
    if (!handle) return;
    handle.view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [documentId, documents, teamPerms]);

  // ── Typewriter mode: keep cursor vertically centred ──────────────────────────
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (settings.typewriterMode) {
      handle.view.dom.setAttribute('data-typewriter', 'true');
    } else {
      handle.view.dom.removeAttribute('data-typewriter');
    }
  }, [settings.typewriterMode]);

  const maxWidth = WIDTH_MAP[settings.editorWidth ?? 'medium'];

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
    <div
      className={`w-full h-full pb-32 marktype-editor-container ${focusMode ? 'focus-mode-active' : ''}`}
    >
      {isReadOnly && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border-b border-amber-200 select-none"
          style={{ background: 'color-mix(in srgb, var(--editor-bg-color, #fff) 85%, #f59e0b 15%)' }}
        >
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Read-only — your group doesn't have write access to this document.</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full min-h-[300px] mx-auto"
        data-stage="write"
        style={{ maxWidth }}
      />
      {createPortal(
        <EditorContextMenu
          position={contextMenuPos}
          hasSelection={hasSelection}
          onClose={() => setContextMenuPos(null)}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onInsertLink={handleInsertLink}
          onDelete={handleDelete}
        />,
        document.body
      )}
    </div>
  );
}
