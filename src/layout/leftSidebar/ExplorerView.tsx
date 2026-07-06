import React from 'react';
import { ExplorerNode } from './ExplorerNode';
import type { FileNode } from '../../workspace/WorkspaceProvider';
import { isCloudVirtualDir } from './cloudNodes';

interface ExplorerViewProps {
  sidebarTree: FileNode | null;
  isTeamContext: boolean;
  onMove: (oldPath: string, newPath: string) => void;
  onOpenFile: (path: string) => void;
  onOpenCloudDoc: (docId: string) => void;
  onContextMenu: (x: number, y: number, node: FileNode) => void;
  syncedPaths: Set<string>;
}

export function ExplorerView({
  sidebarTree,
  isTeamContext,
  onMove,
  onOpenFile,
  onOpenCloudDoc,
  onContextMenu,
  syncedPaths,
}: ExplorerViewProps) {
  return (
    <div className="flex flex-col gap-0.5 flex-1">
      {sidebarTree ? (
        <div
          className="flex flex-col gap-0.5"
          onDragOver={e => {
            if (e.dataTransfer.types.includes('text/plain')) e.preventDefault();
          }}
          onDrop={async e => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData('text/plain');
            if (dragged && sidebarTree) {
              const filename = dragged.split('/').pop() || '';
              const newPath = `${sidebarTree.path}/${filename}`;
              if (dragged !== newPath) onMove(dragged, newPath);
            }
          }}
        >
          {sidebarTree.children?.map((child, idx) => (
            <ExplorerNode
              key={`${child.path}-${idx}`}
              node={child}
              level={1}
              syncedPaths={syncedPaths}
              onOpenFile={onOpenFile}
              onOpenCloudDoc={onOpenCloudDoc}
              onMove={onMove}
              onContextMenu={onContextMenu}
            />
          ))}

          {(!sidebarTree.children || sidebarTree.children.length === 0) && (
            <div className="text-xs italic text-gray-400 px-2 py-2">
              {isTeamContext
                ? 'Team workspace is empty. Add a local file to start.'
                : 'Local folder is empty. Open a folder or create a file to start.'
              }
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-400 p-2 text-center select-none bg-black/[0.02] rounded-lg border border-dashed border-black/5 mt-4">
          {isTeamContext
            ? 'No team workspace files yet.'
            : 'No active local folder. Open a folder to begin.'
          }
        </div>
      )}
    </div>
  );
}
