import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorContextMenu } from "../../components/EditorContextMenu";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { useTeamPermissions } from "../../auth/teamPermissions";
import { Lock } from "lucide-react";
import { useReviseEditor } from "./useReviseEditor";

export function ReviseView({
  ydoc,
  documentId,
}: {
  ydoc: Y.Doc;
  documentId: string;
}) {
  const { documents } = useWorkspace();
  const teamPerms = useTeamPermissions();
  const [isReadOnly, setIsReadOnly] = useState(false);
  const {
    containerRef,
    focusMode,
    contextMenuPos,
    hasSelection,
    setEditorReadOnly,
    handleCopy,
    handleCut,
    handlePaste,
    handleDelete,
    handleAddNote,
    handleInsertLink,
    onCloseContextMenu,
  } = useReviseEditor(ydoc, documentId);

  useEffect(() => {
    if (!documentId) {
      setIsReadOnly(false);
      setEditorReadOnly(false);
      return;
    }
    const doc = documents.find((d: any) => d.id === documentId);
    const filePerms = (doc as any)?.filePermissions;
    const readOnly = !teamPerms.canReviseFile(filePerms);
    setIsReadOnly(readOnly);
    setEditorReadOnly(readOnly);
  }, [documentId, documents, teamPerms, setEditorReadOnly]);

  return (
    <div
      className={`w-full h-full pb-32 marktype-editor-container ${focusMode ? "focus-mode-active" : ""}`}
    >
      {isReadOnly && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border-b border-amber-200 select-none"
          style={{ background: "color-mix(in srgb, var(--editor-bg-color, #fff) 85%, #f59e0b 15%)" }}
        >
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Read-only — your group doesn't have revise access to this document.</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full min-h-[300px]" data-stage="revise" />
      <EditorContextMenu
        position={contextMenuPos}
        hasSelection={hasSelection}
        onClose={onCloseContextMenu}
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
