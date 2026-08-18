import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { EditorContextMenu } from '../../components/EditorContextMenu';
import { ReadOnlyNotice } from '../../collab/ReadOnlyNotice';
import { SelectionToolbar } from '../../components/SelectionToolbar';
import { linkCommand } from '../../editor/formatting/commands';
import { useWriteEditor } from './useWriteEditor';
import { getContextFromYdoc } from '../../excalidraw/excalidrawService';
import { usePlan } from '../../billing/PlanProvider';
import { useAuth } from '../../auth/AuthProvider';
import { useSyncStatusStore } from '../../cloud/syncStatusStore';

const WIDTH_MAP: Record<string, string> = { narrow: '560px', medium: '720px', wide: '900px', full: '100%' };

export function WriteView({ ydoc, documentId }: { ydoc: Y.Doc; documentId?: string }) {
  const {
    containerRef, handleRef, focusMode, readOnlyReason, contextMenuPos, hasSelection,
    settings, setContextMenuPos, setHasSelection, selToolbar, setSelToolbar, handleAddNote,
  } = useWriteEditor(ydoc, documentId);
  const { isTeam, teamId, activeContext } = usePlan();
  const { user } = useAuth();
  const cloudDocumentIds = useSyncStatusStore(state => state.cloudDocumentIds);

  const imageContext = useMemo(() => {
    if (!ydoc) return null;
    const isCloud = activeContext.type === 'team' || (documentId ? cloudDocumentIds.has(documentId) : false);
    return getContextFromYdoc(ydoc, isCloud, teamId || undefined, user?.id || undefined);
  }, [ydoc, activeContext.type, teamId, user?.id, documentId, cloudDocumentIds]);

  const maxWidth = WIDTH_MAP[settings.editorWidth] || '720px';

  return (
    <div className={`w-full h-full pb-32 frontmatter-editor-container relative ${focusMode ? 'focus-mode-active' : ''}`}>
      <ReadOnlyNotice reason={readOnlyReason} />
      {/* `data-stage` is how the inline-preview interaction layer knows which
          stage it is in. Without it, `getStage()` returned null here and every
          click on an image was swallowed with the caret left where it was. */}
      <div className="flex items-center justify-center w-full h-full min-h-[300px]" data-stage="write">
        <div ref={containerRef} className="w-full h-full" style={{ maxWidth }} />
      </div>
      {createPortal(
        <EditorContextMenu
          position={contextMenuPos}
          hasSelection={hasSelection}
          onClose={() => setContextMenuPos(null)}
          onCopy={() => {
            if (!handleRef.current) return;
            const { from, to } = handleRef.current.view.state.selection.main;
            navigator.clipboard.writeText(handleRef.current.view.state.sliceDoc(from, to));
            setContextMenuPos(null);
          }}
          onCut={() => {
            if (!handleRef.current) return;
            handleRef.current.view.dispatch(handleRef.current.view.state.replaceSelection(''));
            handleRef.current.view.focus();
            setContextMenuPos(null);
          }}
          onPaste={async () => {
            if (!handleRef.current) return;
            handleRef.current.view.dispatch(handleRef.current.view.state.replaceSelection(await navigator.clipboard.readText()));
            handleRef.current.view.focus();
            setContextMenuPos(null);
          }}
          onDelete={() => {
            if (!handleRef.current) return;
            const { from, to } = handleRef.current.view.state.selection.main;
            handleRef.current.view.dispatch({ changes: { from, to } });
            handleRef.current.view.focus();
            setContextMenuPos(null);
          }}
          onAddNote={(note) => {
            void handleAddNote(note);
            setContextMenuPos(null);
          }}
          onInsertLink={() => {
            if (handleRef.current) {
              linkCommand.apply(handleRef.current.view);
            }
            setContextMenuPos(null);
          }}
        />,
        document.body
      )}
      {selToolbar && handleRef.current && (
        <SelectionToolbar
          view={handleRef.current.view}
          from={selToolbar.from}
          to={selToolbar.to}
          onClose={() => setSelToolbar(null)}
          documentId={documentId}
          imageContext={imageContext}
        />
      )}
    </div>
  );
}
