import React from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { Lock } from 'lucide-react';
import { EditorContextMenu } from '../../components/EditorContextMenu';
import { useWriteEditor } from './useWriteEditor';

const WIDTH_MAP: Record<string, string> = { narrow: '560px', medium: '720px', wide: '900px', full: '100%' };

export function WriteView({ ydoc, documentId }: { ydoc: Y.Doc; documentId?: string }) {
  const {
    containerRef, focusMode, isReadOnly, contextMenuPos, hasSelection,
    settings, setContextMenuPos, setHasSelection, handleRef,
  } = useWriteEditor(ydoc, documentId);

  const maxWidth = WIDTH_MAP[settings.editorWidth] || '720px';

  return (
    <div className={`w-full h-full pb-32 marktype-editor-container relative ${focusMode ? 'focus-mode-active' : ''}`}>
      {isReadOnly && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50/80 dark:bg-amber-900/20 border-b border-amber-200/50 select-none"
          style={{ background: 'color-mix(in srgb, var(--editor-bg-color, #fff) 85%, #f59e0b 15%)' }}>
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Read-only — your group doesn't have write access to this document.</span>
        </div>
      )}
      <div className="flex items-center justify-center w-full h-full min-h-[300px]">
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
          onAddNote={() => setContextMenuPos(null)}
          onInsertLink={() => setContextMenuPos(null)}
        />,
        document.body
      )}
    </div>
  );
}
