import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { createEditor, EditorHandle } from '../../editor/createEditor';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { applyThemeVariablesToDOM } from '../../editor/themes/themeConfig';
import { useSettingsStore } from '../../settings/settingsStore';
import { useTeamPermissions } from '../../auth/teamPermissions';
import { usePlan } from '../../billing/PlanProvider';
import { referencePickerExtension, setPickerDocumentPath } from '../../editor/extensions/referencePicker';
import { formattingKeymap } from '../../editor/formatting/keymap';
import { setCurrentDocId } from '../../keyboard/useGlobalShortcuts';
import type { ImageContext } from '../../images/imageTypes';
import { imageDropExtension } from '../../editor/extensions/imageDrop';
import { useDocumentAssets } from '../../images/useDocumentAssets';
import { getContextFromYdoc } from '../../excalidraw/excalidrawService';
import { usePlanStore } from '../../billing/PlanProvider';
import { useSyncStatusStore } from '../../cloud/syncStatusStore';
import { useRoomStore } from '../../collab/roomStore';
import { readOnlyReasonFor, type ReadOnlyReason } from '../../collab/ReadOnlyNotice';
import { getCurrentUser } from "../../auth/session";
import { SuggestionManager } from '../../yjs/suggestions';
import { AnnotationManager } from '../../yjs/annotations';
import {
  setCurrentExcalidrawDocumentId,
  setImageAnnotationManager,
  setImageAuthorId,
  setImageYdoc,
} from '../../editor/extensions/inlinePreview/interactions';
import { useAuth } from '../../auth/AuthProvider';
import { guardTeamPermission } from '../../auth/permissionGuards';
import { v4 as uuid } from 'uuid';
import {
  useAwareness,
  useEditorAppearance,
  useEditorNavigation,
  useFocusModeAttribute,
  useTransclusionDocument,
  setEditorReadOnly as setEditorReadOnlyOn,
} from '../../editor/useEditorShell';
import { AnchorIndex } from '../../yjs/anchorIndex';
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
  const [readOnlyReason, setReadOnlyReason] = useState<ReadOnlyReason | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selToolbar, setSelToolbar] = useState<{ from: number; to: number } | null>(null);
  // State, not just the ref: image resolution has to re-run once the editor
  // exists, and a ref assignment does not re-render.
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const { setActiveHeading, setActiveSuggestionId, documents, workspacePath } = useWorkspace();
  const { settings } = useSettingsStore();
  const teamPerms = useTeamPermissions();
  const { isTeam, teamId } = usePlan();
  const { user } = useAuth();
  const authorId = user?.display_name || user?.email?.split('@')[0] || 'You';
  const awareness = useAwareness(ydoc, documentId);
  // Notes are anchored to the shared document, so the manager has to outlive
  // any one editor mount — the sidebar reads the same map.
  const [annManager, setAnnManager] = useState<AnnotationManager | null>(null);

  /**
   * Resolved per event rather than captured: a document can gain cloud status,
   * or move on disk, while the editor is mounted.
   */
  const getImageContext = useCallback((): ImageContext | null => {
    if (!ydoc || !documentId) return null;
    const plan = usePlanStore.getState();
    const isCloud =
      plan.activeContext.type === 'team' ||
      useSyncStatusStore.getState().cloudDocumentIds.has(documentId);
    return getContextFromYdoc(ydoc, isCloud, plan.teamId || undefined, getCurrentUser()?.id);
  }, [ydoc, documentId]);

  useFocusModeAttribute(focusMode);
  useTransclusionDocument(ydoc);

  useEffect(() => {
    if (!documentId) return;
    const absPath = documents.find((d: any) => d.id === documentId)?.file_path ?? '';
    const relPath = workspacePath && absPath.startsWith(workspacePath) ? absPath.slice(workspacePath.length).replace(/^\/+/, '') : absPath;
    setPickerDocumentPath(relPath);
    setCurrentDocId(documentId);
  }, [documentId, documents, workspacePath]);

  // Owns the image base directory, resolves this document's images, and
  // re-renders once it knows where each one actually lives.
  useDocumentAssets(ydoc, editorView, getImageContext());

  useEffect(() => {
    applyThemeVariablesToDOM();
    if (!containerRef.current || !ydoc || !awareness) return;
    setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);
    const observer = () => setFocusMode(ydoc.getMap('meta').get('focus_mode') as boolean || false);
    ydoc.getMap('meta').observe(observer);

    const suggestionManager = documentId ? new SuggestionManager(ydoc, documentId) : null;
    // Notes were readable in Revise and invisible here: the manager was never
    // handed to `createEditor`, so the annotation decorations had nothing to
    // draw and the "Add a Note" menu item had nowhere to put what you typed.
    const annotationManager = documentId ? new AnnotationManager(ydoc, documentId) : null;
    setAnnManager(annotationManager);

    // The image context menu reaches these through module state rather than
    // through the view. Only Revise ever set them, so the menu had no document
    // to act on here even once it was allowed to open.
    setCurrentExcalidrawDocumentId(documentId ?? null);
    setImageYdoc(ydoc);
    setImageAuthorId(authorId);
    setImageAnnotationManager(annotationManager);

    // Rebuilt when the list changes or the document does, not on every caret
    // move — see `AnchorIndex`.
    let sugIndex = new AnchorIndex(suggestionManager?.getSuggestions() ?? [], ydoc);
    const reindexSuggestions = () => {
      sugIndex = new AnchorIndex(suggestionManager?.getSuggestions() ?? [], ydoc);
    };
    suggestionManager?.observe(reindexSuggestions);

    const cursorListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        if (update.docChanged) reindexSuggestions();
        setActiveHeading(getActiveHeading(update.state));
        const pos = update.state.selection.main.head;
        setActiveSuggestionId(sugIndex.at(pos));
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
      imageDropExtension(getImageContext),
      suggestionsExtension(ydoc.getText('markdown'), suggestionManager ?? undefined),
      readOnlyCompartmentRef.current.of(EditorState.readOnly.of(false)),
      spellCheckCompartmentRef.current.of(EditorView.contentAttributes.of({ spellcheck: String(settings.spellCheck ?? true) })),
      ...referencePickerExtension(),
      formattingKeymap,
    ], annotationManager ?? undefined);
    handleRef.current = handle;
    setEditorView(handle.view);

    const syncSuggestions = suggestionManager
      ? () => {
          if (!handle.view.dom.isConnected) return;
          handle.view.dispatch({ effects: setSuggestionsEffect.of(suggestionManager.getSuggestions()) });
        }
      : null;
    if (suggestionManager && syncSuggestions) {
      syncSuggestions();
      suggestionManager.observe(syncSuggestions);
    }

    const pendingLine = (window as any).__pendingScrollLine;
    if (pendingLine !== undefined && typeof pendingLine === 'number') {
      (window as any).__pendingScrollLine = undefined;
      const lineNum = Math.min(Math.max(1, pendingLine + 1), handle.view.state.doc.lines);
      const line = handle.view.state.doc.line(lineNum);
      handle.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }), selection: { anchor: line.from } });
      handle.view.focus();
    }

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
      if (suggestionManager && syncSuggestions) suggestionManager.unobserve(syncSuggestions);
      suggestionManager?.unobserve(reindexSuggestions);
      // `handle.destroy()`, not `handle.view.destroy()`. The former also drops
      // the annotation observer and clears the active-editor pointer; going
      // straight to the view left one live observer per stage switch, each
      // dispatching into a destroyed editor.
      handle.destroy();
      handleRef.current = null;
      setAnnManager(null);
      setCurrentExcalidrawDocumentId(null);
      setImageYdoc(null);
      setImageAuthorId('');
      setImageAnnotationManager(null);
      setActiveHeading(null);
      setActiveSuggestionId(null);
      containerRef.current?.removeEventListener('mouseup', onMouseUp);
      containerRef.current?.removeEventListener('contextmenu', onContext);
      setSelToolbar(null);
    };
  }, [ydoc, awareness, setActiveHeading, setActiveSuggestionId, documentId]);

  useEditorNavigation(handleRef);
  useEditorAppearance(handleRef, settings, spellCheckCompartmentRef.current);

  // What the room granted, if this document is in one. Subscribed rather than
  // read once: a grant renewed at a lower level must reach the editor.
  const roomAccess = useRoomStore(
    (state) => (documentId ? state.rooms[documentId]?.access : undefined),
  );

  useEffect(() => {
    if (!documentId) { setIsReadOnly(false); setReadOnlyReason(null); return; }
    const doc = documents.find((d: any) => d.id === documentId);
    const filePerms = (doc as any)?.filePermissions;

    // Either source can forbid writing. The room's verdict is the one the
    // server enforces: without it a reviewer types normally and watches the
    // server drop every keystroke, which reads as the app being broken rather
    // than as a permission they do not have.
    const reason = readOnlyReasonFor({
      roomAccess,
      canWrite: teamPerms.canWriteFile(filePerms),
    });

    setIsReadOnly(reason !== null);
    setReadOnlyReason(reason);
    setEditorReadOnlyOn(handleRef.current, readOnlyCompartmentRef.current, reason !== null);
  }, [documentId, documents, teamPerms, roomAccess]);

  const setEditorReadOnly = useCallback((ro: boolean) => {
    setEditorReadOnlyOn(handleRef.current, readOnlyCompartmentRef.current, ro);
  }, []);

  /**
   * Anchors a note to the selection.
   *
   * The context menu has always rendered the whole compose UI here; the
   * callback it was given threw the text away and closed the menu, so the note
   * looked accepted and never existed.
   */
  const handleAddNote = useCallback(async (noteText: string) => {
    const view = handleRef.current?.view;
    const selection = savedSel.current;
    if (!annManager || !view || !selection || !documentId) return;
    if (!(await guardTeamPermission(isTeam, teamPerms.canWriteFile(), 'add notes'))) return;

    const ytext = ydoc.getText('markdown');
    const start = Y.createRelativePositionFromTypeIndex(ytext, selection.from, -1);
    const end = Y.createRelativePositionFromTypeIndex(ytext, selection.to, -1);
    annManager.addAnnotation(
      uuid(),
      documentId,
      authorId,
      start,
      end,
      view.state.doc.sliceString(selection.from, selection.to),
      noteText,
    );
  }, [annManager, ydoc, documentId, authorId, isTeam, teamPerms]);

  return {
    containerRef, handleRef, focusMode, isReadOnly, readOnlyReason, contextMenuPos, hasSelection,
    savedSel, readOnlyCompartmentRef, spellCheckCompartmentRef, setEditorReadOnly,
    teamPerms, settings, setContextMenuPos, setHasSelection, selToolbar, setSelToolbar,
    handleAddNote,
  };
}
