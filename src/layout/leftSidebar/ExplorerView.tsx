import React from 'react';
import { FilePlus, FolderOpen, FolderPlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { showPromptDialog } from '../../lib/tauriDialog';
import type { ExplorerNode as Node } from './explorerModel';
import { walkTree } from './explorerModel';
import type { ExplorerSource } from './explorerSource';
import { ExplorerNode, EXPLORER_DRAG_TYPE, type DragPayload } from './ExplorerNode';
import { useExplorerExpansion } from './explorerExpansion';
import { SidebarSection } from './SidebarSection';

interface ExplorerViewProps {
  sources: ExplorerSource[];
  activeKey: string | null;
  openKeys: Set<string>;
  onContextMenu: (x: number, y: number, node: Node, source: ExplorerSource) => void;
}

/**
 * Renders one collapsible section per source.
 *
 * Local files and cloud documents used to be spliced into a single tree, which
 * made a row's meaning depend on a path prefix and left cross-source drags
 * undefined. Keeping the sections apart means a drop within a section is a
 * move and a drop across sections is a conversion, and each section can state
 * its own empty case honestly.
 */
export function ExplorerView({ sources, activeKey, openKeys, onContextMenu }: ExplorerViewProps) {
  const visible = sources.filter(source => source.tree || source.unavailableMessage);

  // One index over both trees so a drop can resolve the dragged key back to a
  // node without the payload having to carry the node itself.
  const nodesByKey = React.useMemo(() => {
    const index = new Map<string, { node: Node; source: ExplorerSource }>();
    for (const source of sources) {
      if (source.tree) walkTree(source.tree, node => index.set(node.key, { node, source }));
    }
    return index;
  }, [sources]);

  const handleDropNode = React.useCallback(
    (payload: DragPayload, targetFolder: Node | null, targetSource: ExplorerSource) => {
      const dragged = nodesByKey.get(payload.key);
      if (!dragged) return;
      if (dragged.node.key === targetFolder?.key) return;

      if (dragged.node.source === targetSource.id) {
        void targetSource.move(dragged.node, targetFolder);
      } else {
        void targetSource.transfer?.accept(dragged.node, targetFolder);
      }
    },
    [nodesByKey],
  );

  const handleOpen = React.useCallback((node: Node, source: ExplorerSource) => {
    void source.open(node);
  }, []);

  if (visible.length === 0) {
    return (
      <div className="text-xs text-gray-400 p-2 text-center select-none bg-black/[0.02] rounded-lg border border-dashed border-black/5">
        Nothing to show yet.
      </div>
    );
  }

  return (
    <>
      {visible.map(source => (
        <ExplorerSection
          key={source.id}
          source={source}
          activeKey={activeKey}
          openKeys={openKeys}
          onContextMenu={onContextMenu}
          onDropNode={handleDropNode}
          onOpen={handleOpen}
        />
      ))}
    </>
  );
}

interface ExplorerSectionProps {
  source: ExplorerSource;
  activeKey: string | null;
  openKeys: Set<string>;
  onOpen: (node: Node, source: ExplorerSource) => void;
  onContextMenu: (x: number, y: number, node: Node, source: ExplorerSource) => void;
  onDropNode: (payload: DragPayload, targetFolder: Node | null, targetSource: ExplorerSource) => void;
}

function ExplorerSection({
  source, activeKey, openKeys, onOpen, onContextMenu, onDropNode,
}: ExplorerSectionProps) {
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  const expand = useExplorerExpansion(state => state.expand);

  const rootChildren = source.tree?.children ?? [];
  const isEmpty = rootChildren.length === 0;

  const promptCreate = async (kind: 'file' | 'folder') => {
    const name = await showPromptDialog(
      kind === 'file' ? 'New File' : 'New Folder',
      kind === 'file' ? 'Enter a name for the new file:' : 'Enter a name for the new folder:',
    );
    if (!name?.trim()) return;
    if (source.tree) expand(source.tree.key);
    if (kind === 'file') await source.createFile(null, name.trim());
    else await source.createFolder(null, name.trim());
  };

  const handleRootDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(EXPLORER_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!isDropTarget) setIsDropTarget(true);
  };

  const handleRootDrop = (event: React.DragEvent) => {
    const raw = event.dataTransfer.getData(EXPLORER_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    setIsDropTarget(false);
    try {
      onDropNode(JSON.parse(raw) as DragPayload, null, source);
    } catch {
      /* malformed payload — nothing sensible to do */
    }
  };

  return (
    <SidebarSection
      label={source.label}
      actions={
        <>
          {source.headerAction && (
            <button
              onClick={source.headerAction.run}
              title={source.headerAction.label}
              className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
          {source.capabilities.createFile && (
            <button
              onClick={() => promptCreate('file')}
              title={`New file in ${source.label}`}
              className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          )}
          {source.capabilities.createFolder && (
            <button
              onClick={() => promptCreate('folder')}
              title={`New folder in ${source.label}`}
              className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      }
      bodyProps={{
        onDragOver: handleRootDragOver,
        onDragLeave: () => setIsDropTarget(false),
        onDrop: handleRootDrop,
        className: cn(
          'flex flex-col gap-0.5 rounded-md transition',
          isDropTarget && 'ring-1 ring-blue-400/60 bg-blue-500/5',
        ),
        role: 'tree',
        'aria-label': source.label,
      } as React.HTMLAttributes<HTMLDivElement>}
    >
      {source.tree ? (
        <>
          {rootChildren.map(child => (
            <ExplorerNode
              key={child.key}
              node={child}
              source={source}
              level={1}
              activeKey={activeKey}
              openKeys={openKeys}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onDropNode={onDropNode}
            />
          ))}
          {isEmpty && (
            <div className="text-xs italic text-gray-400 px-2 py-2">{source.emptyMessage}</div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-400 p-2 text-center select-none bg-black/[0.02] rounded-lg border border-dashed border-black/5">
          <p>{source.unavailableMessage}</p>
          {source.onActivate && (
            <button
              onClick={source.onActivate}
              className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              {source.activateLabel ?? 'Open'}
            </button>
          )}
        </div>
      )}
    </SidebarSection>
  );
}
