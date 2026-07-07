import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { createEditor, EditorHandle } from '../../editor/createEditor';
import { Awareness } from 'y-protocols/awareness';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { applyThemeVariablesToDOM, createFontTheme } from '../../editor/themes/themeConfig';
import { useSettingsStore } from '../../settings/settingsStore';
import { registry } from '../../yjs/DocumentRegistry';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { usePlan } from '../../billing/PlanProvider';
import { referencePickerExtension, setPickerDocumentPath } from '../../editor/extensions/referencePicker';
import { refreshInlinePreviewEffect } from '../../editor/extensions/inlinePreview/settingsRefresh';
import { formattingKeymap } from '../../editor/formatting/keymap';
import { setCurrentDocId } from '../../keyboard/useGlobalShortcuts';
import { SuggestionManager } from '../../yjs/suggestions';
import { suggestionsExtension, setSuggestionsEffect } from '../../editor/extensions/suggestionsExtension';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

function getActiveHeading(state: EditorState): string | null {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  for (let i = line.number; i >= 1; i--) {
    const text = state.doc.line(i).text.trim();
    const match = text.match(/^(#{1,6})\s+(.*)$/);
    if (match) return text;
  }
  return null;
}

export function useWriteEditor(
  ydoc: Y.Doc,
  documentId?: string,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const readOnlyCompartmentRef = useRef<Compartment>(new Compartment());
  const spellCheckCompartmentRef = useRef<Compartment>(new Compartment());
  const savedSel = useRef<{ from: number; to: number } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selToolbar, setSelToolbar] = useState<{ from: number; to: number } | null>(null);
  const { setActiveHeading, setActiveSuggestionId, documents, workspacePath } = useWorkspace();
  const { settings } = useSettingsStore();
  const teamPerms = useTeamPermissions();
  const { isTeam, teamId } = usePlan();

  useEffect(() => {
    if (!ydoc) { setAwareness(null); return; }
    if (!documentId) { setAwareness(new Awareness(ydoc)); return; }
    let active = true;
    let timeoutId: any;
    const check = () => {
      const provider = registry.getProvider(documentId);
      if (provider) { if (active) setAwareness(provider.awareness); }
      else if (isTeam) timeoutId = setTimeout(check, 50);
      else if (active) setAwareness(new Awareness(ydoc));
    };
    check();
    return () => { active = false; if (timeoutId) clearTimeout(timeoutId); };
  }, [ydoc, documentId, isTeam]);

  useEffect(() => {
    document.body.setAttribute('data-focus-mode', focusMode ? 'true' : 'false');
    return () => document.body.removeAttribute('data-focus-mode');
  }, [focusMode]);

  useEffect(() => {
    if (!documentId) return;
    const absPath = documents.find((d: any) => d.id === documentId)?.file_path ?? '';
    const relPath = workspacePath && absPath.startsWith(workspacePath) ? absPath.slice(workspacePath.length).replace(/^\/+/, '') : absPath;
    setPickerDocumentPath(relPath);
    setCurrentDocId(documentId);
  }, [documentId, documents, workspacePath]);

  useEffect(() => {
    applyThemeVariablesToDOM();
    if (!containerRef.current || !ydoc || !awareness) return;
    setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);
    const observer = () => setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);
    ydoc.getMap('meta').observe(observer);

    const suggestionManager = documentId ? new SuggestionManager(ydoc, documentId) : null;
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
        if (update.state.selection.main.empty) {
          const sel = update.state.selection.main;
          const line = update.state.doc.lineAt(sel.head);
          const atEmptyLineStart = line.length === 0 && sel.head === line.from;
          if (atEmptyLineStart) {
            setSelToolbar({ from: sel.head, to: sel.head });
          } else {
            setSelToolbar(null);
          }
        }
      }
    });

    const handle = createEditor(containerRef.current, ydoc.getText('markdown'), awareness, [
      cursorListener,
      suggestionsExtension(ydoc.getText('markdown'), suggestionManager ?? undefined),
      readOnlyCompartmentRef.current.of(EditorState.readOnly.of(false)),
      spellCheckCompartmentRef.current.of(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })),
      ...referencePickerExtension,
      formattingKeymap,
    ]);
    handleRef.current = handle;

    if (suggestionManager) {
      const sync = () => {
        if (!handle.view.dom.isConnected) return;
        handle.view.dispatch({ effects: setSuggestionsEffect.of(suggestionManager.getSuggestions()) });
      };
      sync();
      suggestionManager.observe(sync);
    }

    const pendingLine = (window as any).__pendingScrollLine;
    if (pendingLine !== undefined && typeof pendingLine === 'number') {
      (window as any).__pendingScrollLine = undefined;
      const lineNum = Math.min(Math.max(1, pendingLine + 1), handle.view.state.doc.lines);
      const line = handle.view.state.doc.line(lineNum);
      handle.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }), selection: { anchor: line.from } });
      handle.view.focus();
    }

    const handleScrollToLine = (e: Event) => {
      const lineIndex = (e as CustomEvent).detail?.lineIndex;
      const view = handle.view;
      if (view && typeof lineIndex === 'number') {
        const lineNum = Math.min(Math.max(1, lineIndex + 1), view.state.doc.lines);
        const line = view.state.doc.line(lineNum);
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }), selection: { anchor: line.from } });
        view.focus();
      }
    };
    window.addEventListener('editor-scroll-to-line', handleScrollToLine);

    const handleSelectRange = (e: Event) => {
      const { from, to } = (e as CustomEvent).detail;
      const view = handle.view;
      if (view && typeof from === 'number' && typeof to === 'number') {
        view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 80 }) });
        requestAnimationFrame(() => { const node = view.domAtPos(from).node; (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement!)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        view.focus();
      }
    };
    window.addEventListener('editor-select-range', handleSelectRange);

    const onMouseUp = () => {
      const view = handle.view;
      const sel = view.state.selection.main;
      if (!sel.empty && view.hasFocus) {
        setSelToolbar({ from: sel.from, to: sel.to });
      }
    };
    containerRef.current.addEventListener('mouseup', onMouseUp);

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const { from, to } = handle.view.state.selection.main;
      savedSel.current = { from, to };
      setHasSelection(from !== to);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setSelToolbar(null);
    };
    containerRef.current.addEventListener('contextmenu', onContext);

    return () => {
      ydoc.getMap('meta').unobserve(observer);
      window.removeEventListener('editor-scroll-to-line', handleScrollToLine);
      window.removeEventListener('editor-select-range', handleSelectRange);
      handle.view.destroy();
      handleRef.current = null;
      setActiveHeading(null);
      setActiveSuggestionId(null);
      containerRef.current?.removeEventListener('mouseup', onMouseUp);
      containerRef.current?.removeEventListener('contextmenu', onContext);
      setSelToolbar(null);
    };
  }, [ydoc, awareness, setActiveHeading, setActiveSuggestionId, documentId]);

  useEffect(() => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({ effects: refreshInlinePreviewEffect.of() });
  }, [settings.livePreview]);

  useEffect(() => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({
      effects: spellCheckCompartmentRef.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })),
    });
  }, [settings.spellCheck]);

  useEffect(() => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({
      effects: handleRef.current.fontCompartment.reconfigure(createFontTheme(settings.fontFamily, settings.fontSize, settings.lineHeight ?? '1.8')),
    });
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    if (!documentId) { setIsReadOnly(false); return; }
    const doc = documents.find((d: any) => d.id === documentId);
    const filePerms = (doc as any)?.filePermissions;
    const readOnly = !teamPerms.canWriteFile(filePerms);
    setIsReadOnly(readOnly);
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [documentId, documents, teamPerms]);

  const setEditorReadOnly = useCallback((ro: boolean) => {
    if (!handleRef.current) return;
    handleRef.current.view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(ro)) });
  }, []);

  return {
    containerRef, handleRef, focusMode, isReadOnly, contextMenuPos, hasSelection,
    savedSel, readOnlyCompartmentRef, spellCheckCompartmentRef, setEditorReadOnly,
    teamPerms, settings, setContextMenuPos, setHasSelection, selToolbar, setSelToolbar,
  };
}
