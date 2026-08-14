import React from 'react';
import {
  Cloud, CloudOff, Edit2, ExternalLink, FolderOpen, FolderPlus,
  Plus, Shield, Trash2, UserPlus, WifiHigh, WifiOff,
} from 'lucide-react';
import { SidebarContextMenu, type ContextMenuEntry } from '../../components/SidebarContextMenu';
import { FilePermissionsModal } from '../../components/FilePermissionsModal';
import { showPromptDialog } from '../../lib/tauriDialog';
import type { ExplorerNode } from './explorerModel';
import type { ExplorerSource } from './explorerSource';
import { useExplorerExpansion } from './explorerExpansion';

export interface ExplorerContextTarget {
  x: number;
  y: number;
  node: ExplorerNode;
  source: ExplorerSource;
}

interface ContextMenuActionsProps {
  target: ExplorerContextTarget | null;
  onClose: () => void;
  /** The other source, when a cross-source action ("Add to team") applies. */
  transferSource?: ExplorerSource;
}

const icon = (color: string) => ({ width: 14, height: 14, opacity: 0.75, color });

/**
 * Builds the menu for a node from its source's capabilities.
 *
 * The previous version recomputed a bespoke boolean expression per item at the
 * call site — which is how "Delete" ended up permanently hidden for cloud
 * folders and "Rename" ended up offered on nodes that refused it.
 */
export function ContextMenuActions({ target, onClose, transferSource }: ContextMenuActionsProps) {
  const [permissionsFor, setPermissionsFor] = React.useState<{ docId: string; title: string } | null>(null);
  const expand = useExplorerExpansion(state => state.expand);

  const items = React.useMemo<ContextMenuEntry[]>(() => {
    if (!target) return [];
    const { node, source } = target;
    const caps = source.capabilities;
    const entries: ContextMenuEntry[] = [];

    if (node.isDir) {
      if (caps.createFile) {
        entries.push({
          id: 'new-file',
          label: 'New File',
          icon: <Plus style={icon('currentColor')} />,
          onSelect: async () => {
            const name = await showPromptDialog('New File', 'Enter file name (e.g. notes.md):');
            if (!name?.trim()) return;
            expand(node.key);
            await source.createFile(node, name.trim());
          },
        });
      }
      if (caps.createFolder) {
        entries.push({
          id: 'new-folder',
          label: 'New Folder',
          icon: <FolderPlus style={icon('currentColor')} />,
          onSelect: async () => {
            const name = await showPromptDialog('New Folder', 'Enter folder name:');
            if (!name?.trim()) return;
            expand(node.key);
            await source.createFolder(node, name.trim());
          },
        });
      }
    } else {
      entries.push({
        id: 'open',
        label: 'Open',
        icon: <ExternalLink style={icon('currentColor')} />,
        onSelect: () => { void source.open(node); },
      });
    }

    const canRename = node.isDir ? caps.renameFolder : caps.renameFile;
    if (canRename) {
      entries.push({
        id: 'rename',
        label: 'Rename',
        icon: <Edit2 style={icon('currentColor')} />,
        onSelect: async () => {
          const newName = await showPromptDialog('Rename', 'Enter new name:', node.name);
          if (!newName?.trim() || newName.trim() === node.name) return;
          await source.rename(node, newName.trim());
        },
      });
    }

    if (caps.revealInFinder && source.revealInFinder) {
      entries.push({
        id: 'reveal',
        label: 'Reveal in Finder',
        icon: <FolderOpen style={icon('currentColor')} />,
        onSelect: () => { void source.revealInFinder!(node); },
      });
    }

    entries.push({ id: 'divider-cloud', divider: true });

    // Cross-source actions read from the *other* source, which owns the
    // conversion and the permission that gates it.
    if (transferSource?.transfer && !node.isDir) {
      const alreadyThere = node.source === 'local' && node.syncedToCloud;
      if (!alreadyThere) {
        entries.push({
          id: 'transfer',
          label: transferSource.transfer.label,
          icon: node.source === 'local'
            ? <UserPlus style={icon('var(--editor-warning, #f97316)')} />
            : <Cloud style={icon('var(--editor-info, #3b82f6)')} />,
          onSelect: () => { void transferSource.transfer!.accept(node, null); },
        });
      }
    }

    const isCloudBacked = node.source === 'cloud' || !!node.syncedToCloud;
    if (!node.isDir && isCloudBacked) {
      const cloudSource = node.source === 'cloud' ? source : transferSource;
      if (cloudSource?.unsync) {
        entries.push({
          id: 'unsync',
          label: 'Remove Cloud Sync',
          icon: <CloudOff style={icon('var(--editor-muted, #6b7280)')} />,
          muted: true,
          onSelect: () => { void cloudSource.unsync!(node); },
        });
      }
      if (cloudSource?.setOffline && cloudSource.capabilities.offlineToggle) {
        entries.push(node.offlineEnabled ? {
          id: 'offline-off',
          label: 'Remove Offline Access',
          icon: <WifiOff style={icon('var(--editor-muted, #6b7280)')} />,
          muted: true,
          onSelect: () => { void cloudSource.setOffline!(node, false); },
        } : {
          id: 'offline-on',
          label: 'Make Available Offline',
          icon: <WifiHigh style={icon('var(--editor-accent, #8b5cf6)')} />,
          onSelect: () => { void cloudSource.setOffline!(node, true); },
        });
      }
    }

    if (caps.managePermissions && !node.isDir && node.docId) {
      entries.push({ id: 'divider-perms', divider: true });
      entries.push({
        id: 'permissions',
        label: 'Manage Permissions',
        icon: <Shield style={icon('var(--editor-accent, #a855f7)')} />,
        accent: 'var(--editor-accent, #a855f7)',
        onSelect: () => setPermissionsFor({ docId: node.docId!, title: node.name }),
      });
    }

    const canDelete = node.isDir ? caps.deleteFolder : caps.deleteFile;
    if (canDelete) {
      entries.push({ id: 'divider-delete', divider: true });
      entries.push({
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 style={{ width: 14, height: 14, opacity: 0.8 }} />,
        danger: true,
        onSelect: () => { void source.remove(node); },
      });
    }

    return entries;
  }, [target, transferSource, expand]);

  return (
    <>
      <SidebarContextMenu
        position={target ? { x: target.x, y: target.y } : null}
        items={items}
        onClose={onClose}
      />

      {permissionsFor && (
        <FilePermissionsModal
          docId={permissionsFor.docId}
          docTitle={permissionsFor.title}
          isOpen={true}
          onClose={() => setPermissionsFor(null)}
        />
      )}
    </>
  );
}
