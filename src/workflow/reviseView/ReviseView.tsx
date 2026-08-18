import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import { EditorContextMenu } from "../../components/EditorContextMenu";
import { useWorkspace } from "../../workspace/WorkspaceProvider";
import { useTeamPermissions } from "../../auth/teamPermissions";
import { useReviseEditor } from "./useReviseEditor";
import { useRoomStore } from "../../collab/roomStore";
import { ReadOnlyNotice, readOnlyReasonFor, type ReadOnlyReason } from "../../collab/ReadOnlyNotice";

export function ReviseView({
  ydoc,
  documentId,
}: {
  ydoc: Y.Doc;
  documentId: string;
}) {
  const { documents } = useWorkspace();
  const teamPerms = useTeamPermissions();
  const [readOnlyReason, setReadOnlyReason] = useState<ReadOnlyReason | null>(null);
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

  // Revise is the stage that rewrites text on the author's behalf —
  // autocorrect, accepted suggestions — so a reviewer left writable here would
  // have the app itself producing edits the server then silently drops.
  const roomAccess = useRoomStore(
    (state) => (documentId ? state.rooms[documentId]?.access : undefined),
  );

  useEffect(() => {
    if (!documentId) {
      setReadOnlyReason(null);
      setEditorReadOnly(false);
      return;
    }
    const doc = documents.find((d: any) => d.id === documentId);
    const filePerms = (doc as any)?.filePermissions;
    const reason = readOnlyReasonFor({
      roomAccess,
      canWrite: teamPerms.canReviseFile(filePerms),
    });

    setReadOnlyReason(reason);
    setEditorReadOnly(reason !== null);
  }, [documentId, documents, teamPerms, roomAccess, setEditorReadOnly]);

  return (
    <div
      className={`w-full h-full pb-32 frontmatter-editor-container ${focusMode ? "focus-mode-active" : ""}`}
    >
      <ReadOnlyNotice reason={readOnlyReason} />
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
