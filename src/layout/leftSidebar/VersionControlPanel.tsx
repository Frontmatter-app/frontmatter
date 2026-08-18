import React from 'react';
import * as Y from 'yjs';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { GitPanel } from './GitPanel';
import { CheckpointsPanel } from './CheckpointsPanel';

interface VersionControlPanelProps {
  ydoc: Y.Doc | null;
  currentDocumentId: string | null;
}

/**
 * Chooses the versioning story that actually applies to the open document.
 *
 * Git tracks the workspace folder, so it can only ever describe documents that
 * exist on disk. Cloud documents have no file — they are a Yjs history in
 * Firestore — which is why the git panel used to render commit and push
 * controls over a repository that could not contain a single team document.
 * Each panel hides itself when its backing store is not the one in play.
 */
export function VersionControlPanel({ ydoc, currentDocumentId }: VersionControlPanelProps) {
  const { documents } = useWorkspace();
  const currentDocument = documents.find(d => d.id === currentDocumentId) ?? null;
  const isCloudDocument = !!currentDocument && !currentDocument.file_path;

  return (
    <>
      {isCloudDocument && (
        <CheckpointsPanel ydoc={ydoc} documentId={currentDocumentId} title={currentDocument.title} />
      )}
      {/* The document is handed down because committing it writes the live Yjs
          text, not the file on disk — a collaborator's edit reaches the
          document without ever passing through the working tree. */}
      <GitPanel ydoc={ydoc} />
    </>
  );
}
