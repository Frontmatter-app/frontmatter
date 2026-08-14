import React from 'react';
import { ChevronDown, ChevronRight, Cloud, Folder, FolderOpen, WifiHigh } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ExplorerNode as Node } from './explorerModel';
import type { ExplorerSource } from './explorerSource';
import { useExplorerExpansion } from './explorerExpansion';
import { getFileIcon } from './fileIcons';

export const EXPLORER_DRAG_TYPE = 'application/x-explorer-node';

export interface DragPayload {
  source: 'local' | 'cloud';
  key: string;
}

interface ExplorerNodeProps {
  node: Node;
  source: ExplorerSource;
  level: number;
  activeKey: string | null;
  openKeys: Set<string>;
  onOpen: (node: Node, source: ExplorerSource) => void;
  onContextMenu: (x: number, y: number, node: Node, source: ExplorerSource) => void;
  onDropNode: (payload: DragPayload, targetFolder: Node | null, targetSource: ExplorerSource) => void;
}

export function ExplorerNode({
  node, source, level, activeKey, openKeys, onOpen, onContextMenu, onDropNode,
}: ExplorerNodeProps) {
  const isExpanded = useExplorerExpansion(state => state.expanded.has(node.key));
  const toggle = useExplorerExpansion(state => state.toggle);
  const [isDropTarget, setIsDropTarget] = React.useState(false);

  const isActive = activeKey === node.key;
  const isOpen = openKeys.has(node.key);
  const isCloud = node.source === 'cloud';
  // A node can always be dragged out to the other source; only same-source
  // rearrangement needs the move capability.
  const canDrag = !!source.capabilities.move || !!source.transfer;

  const activate = () => {
    if (node.isDir) toggle(node.key);
    else onOpen(node, source);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
      return;
    }
    if (!node.isDir) return;
    if (event.key === 'ArrowRight' && !isExpanded) {
      event.preventDefault();
      toggle(node.key);
    } else if (event.key === 'ArrowLeft' && isExpanded) {
      event.preventDefault();
      toggle(node.key);
    }
  };

  const handleDragStart = (event: React.DragEvent) => {
    if (!canDrag) return;
    event.stopPropagation();
    const payload: DragPayload = { source: node.source, key: node.key };
    event.dataTransfer.setData(EXPLORER_DRAG_TYPE, JSON.stringify(payload));
    // Some drop targets (and the OS) only negotiate on text/plain.
    event.dataTransfer.setData('text/plain', node.path);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!node.isDir) return;
    if (!event.dataTransfer.types.includes(EXPLORER_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (!isDropTarget) setIsDropTarget(true);
  };

  const handleDragLeave = () => setIsDropTarget(false);

  const handleDrop = (event: React.DragEvent) => {
    if (!node.isDir) return;
    const raw = event.dataTransfer.getData(EXPLORER_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    try {
      onDropNode(JSON.parse(raw) as DragPayload, node, source);
    } catch {
      /* malformed payload — nothing sensible to do */
    }
  };

  return (
    <div className="select-none flex flex-col gap-0.5">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={node.isDir ? isExpanded : undefined}
        aria-selected={isActive}
        aria-label={node.name}
        onClick={activate}
        onKeyDown={handleKeyDown}
        onContextMenu={event => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event.clientX, event.clientY, node, source);
        }}
        draggable={canDrag}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ paddingLeft: `${level * 10 + 6}px` }}
        className={cn(
          'group flex items-center justify-between py-1 px-2 rounded-md cursor-pointer text-sm font-medium transition',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
          isActive ? 'bg-black/[0.07]' : 'hover:bg-black/5',
          isDropTarget && 'ring-1 ring-blue-400/60 bg-blue-500/5',
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {node.isDir ? (
            <>
              {isExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              }
              {isCloud ? (
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
                {isCloud
                  ? <Cloud className="w-4 h-4 text-blue-500" />
                  : getFileIcon(node.name)
                }
                {node.syncedToCloud && (
                  <span className="absolute -bottom-1 -right-1.5" title="Synced to cloud">
                    <Cloud className="w-2.5 h-2.5 text-blue-500" style={{ strokeWidth: 2.5 }} />
                  </span>
                )}
              </div>
            </>
          )}

          <span className={cn(
            'truncate flex-1 text-xs',
            isActive ? 'text-gray-900 font-semibold' : isCloud ? 'text-blue-600/80' : 'text-gray-700',
          )}>
            {node.name}
          </span>

          {node.offlineEnabled && (
            <WifiHigh className="w-3 h-3 text-violet-500/70 flex-shrink-0" aria-label="Available offline" />
          )}
        </div>

        {/* An open-but-inactive tab gets a dot so the tree agrees with the tab bar. */}
        <div className="w-2 flex-shrink-0 flex items-center justify-center">
          {isOpen && !isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400/70" aria-label="Open" />
          )}
        </div>
      </div>

      {node.isDir && isExpanded && (
        <div role="group" className="flex flex-col gap-0.5">
          {(node.children ?? []).map(child => (
            <ExplorerNode
              key={child.key}
              node={child}
              source={source}
              level={level + 1}
              activeKey={activeKey}
              openKeys={openKeys}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onDropNode={onDropNode}
            />
          ))}
          {(node.children ?? []).length === 0 && (
            <div
              style={{ paddingLeft: `${(level + 1) * 10 + 6}px` }}
              className="text-xs italic text-gray-400 py-1 px-2"
            >
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}
