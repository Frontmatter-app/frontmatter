import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
} from 'lucide-react';
import type { FileNode } from '../../workspace/workspaceTypes';
import { cn } from '../../lib/utils';
import { cloudDocIdFromPath, isCloudOnlyNode, isCloudVirtualDir } from './cloudNodes';
import { getFileIcon } from './fileIcons';

interface ExplorerNodeProps {
  key?: React.Key;
  node: FileNode;
  level: number;
  syncedPaths: Set<string>;
  onOpenFile: (path: string) => void;
  onOpenCloudDoc: (docId: string) => void;
  onMove: (oldPath: string, newPath: string) => void;
  onContextMenu: (x: number, y: number, node: FileNode) => void;
}

export function ExplorerNode({
  node,
  level,
  syncedPaths,
  onOpenFile,
  onOpenCloudDoc,
  onMove,
  onContextMenu,
}: ExplorerNodeProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const cloudOnly = isCloudOnlyNode(node.path);
  const virtualDir = isCloudVirtualDir(node.path);
  const isSynced = !node.is_dir && !cloudOnly && syncedPaths.has(node.path);

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (node.is_dir) {
      setIsExpanded(expanded => !expanded);
    } else if (cloudOnly) {
      onOpenCloudDoc(cloudDocIdFromPath(node.path));
    } else {
      onOpenFile(node.path);
    }
  };

  const handleDragStart = (event: React.DragEvent) => {
    if (cloudOnly || virtualDir) return;
    event.stopPropagation();
    event.dataTransfer.setData('text/plain', node.path);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (node.is_dir && !virtualDir && event.dataTransfer.types.includes('text/plain')) {
      event.preventDefault();
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (virtualDir) return;
    const dragged = event.dataTransfer.getData('text/plain');
    if (dragged && dragged !== node.path) {
      const filename = dragged.split('/').pop() || '';
      const newPath = `${node.path}/${filename}`;
      if (dragged !== newPath) onMove(dragged, newPath);
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(event.clientX, event.clientY, node);
  };

  return (
    <div className="select-none flex flex-col gap-0.5">
      <div
        onClick={handleToggle}
        onContextMenu={handleContextMenu}
        draggable={!node.is_dir && !cloudOnly && !virtualDir}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ paddingLeft: `${level * 10 + 6}px` }}
        className={cn(
          'group flex items-center justify-between py-1 px-2 rounded-md hover:bg-black/5 cursor-pointer text-sm font-medium transition',
          cloudOnly && 'text-blue-600/80',
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {node.is_dir ? (
            <>
              {isExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              }
              {virtualDir ? (
                <Cloud className="w-4 h-4 text-blue-400 flex-shrink-0" />
              ) : isExpanded ? (
                <FolderOpen className="w-4 h-4 text-amber-500 fill-amber-500/20 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-amber-500 fill-amber-500/20 flex-shrink-0" />
              )}
            </>
          ) : (
            <>
              <div className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="relative flex-shrink-0">
                {cloudOnly
                  ? <Cloud className="w-4 h-4 text-blue-500" />
                  : getFileIcon(node.name)
                }
                {isSynced && (
                  <span className="absolute -bottom-1 -right-1.5" title="Synced to cloud">
                    <Cloud className="w-2.5 h-2.5 text-blue-500" style={{ strokeWidth: 2.5 }} />
                  </span>
                )}
              </div>
            </>
          )}

          <span className={cn(
            'truncate flex-1 text-xs',
            cloudOnly ? 'text-blue-600/80' : 'text-gray-700',
          )}>
            {node.name}
          </span>

          {isSynced && (
            <span className="text-[9px] font-bold text-blue-400/60 uppercase tracking-wider flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              cloud
            </span>
          )}
        </div>

        <div className="w-1 flex-shrink-0" />
      </div>

      {node.is_dir && isExpanded && node.children && (
        <div className="flex flex-col gap-0.5">
          {node.children.map((child, index) => (
            <ExplorerNode
              key={`${child.path}-${index}`}
              node={child}
              level={level + 1}
              syncedPaths={syncedPaths}
              onOpenFile={onOpenFile}
              onOpenCloudDoc={onOpenCloudDoc}
              onMove={onMove}
              onContextMenu={onContextMenu}
            />
          ))}
          {node.children.length === 0 && (
            <div
              style={{ paddingLeft: `${(level + 1) * 10 + 6}px` }}
              className="text-xs italic text-gray-400 py-1 px-2"
            >
              {virtualDir ? 'No cloud files here.' : 'Empty Folder'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
