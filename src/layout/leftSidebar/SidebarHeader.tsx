import React, { useMemo } from 'react';
import { Plus, Folder, FolderOpen, FolderPlus, Cloud } from 'lucide-react';

interface SidebarHeaderProps {
  isTeamContext: boolean;
  workspacePath: string | null;
  workspaceLabel: string;
  onNewRootFile: () => void;
  onNewRootFolder: () => void;
  onOpenExternal: () => void;
  onOpenWorkspace: () => void;
}

export function SidebarHeader({
  isTeamContext,
  workspacePath,
  workspaceLabel,
  onNewRootFile,
  onNewRootFolder,
  onOpenExternal,
  onOpenWorkspace,
}: SidebarHeaderProps) {
  return (
    <div className="group flex items-center justify-between mb-4 px-2">
      <div className="min-w-0 flex items-center gap-2">
        {isTeamContext ? (
          <Cloud className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 fill-amber-500/10" />
        )}
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 truncate">{workspaceLabel}</h2>
        </div>
      </div>
      <div className="flex items-center gap-1.5 ml-auto opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
        {isTeamContext ? (
          <>
            <button onClick={onNewRootFile} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="New Team File">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={onNewRootFolder} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="New Cloud Folder">
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button onClick={onOpenExternal} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="Add Local File">
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          workspacePath ? (
            <>
              <button onClick={onNewRootFile} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="New File">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button onClick={onNewRootFolder} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="New Folder">
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button onClick={onOpenWorkspace} className="text-gray-400 hover:text-gray-900 p-1 hover:bg-black/5 rounded cursor-pointer" title="Open Folder">
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )
        )}
      </div>
    </div>
  );
}
