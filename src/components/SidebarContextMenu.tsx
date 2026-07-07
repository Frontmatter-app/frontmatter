import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, FolderPlus, Edit2, Trash2, FolderOpen, ExternalLink,
  Cloud, CloudOff, WifiOff, WifiHigh, UserPlus, Shield,
} from 'lucide-react';

interface SidebarContextMenuProps {
  position: { x: number; y: number } | null;
  isFolder: boolean;
  isSynced?: boolean;        // local file already synced to cloud
  isCloudOnly?: boolean;     // no local copy, cloud only
  isOfflineEnabled?: boolean;// already available offline
  canSync?: boolean;         // author+ plan and not already synced
  canMakeOffline?: boolean;  // group has offlineAccess permission
  canAddToTeam?: boolean;    // group has addToTeam permission (local file in team context)
  showManagePerms?: boolean; // team owner can manage per-file permissions
  isCloudFolder?: boolean;   // virtual cloud folder (can create cloud-only docs inside)
  onClose: () => void;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onRevealInFolder?: () => void;
  onOpen?: () => void;
  onSyncToCloud?: () => void;
  onUnsyncFromCloud?: () => void;
  onMakeOffline?: () => void;
  onRemoveOffline?: () => void;
  onAddToTeam?: () => void;
  onManagePermissions?: () => void;
}

export function SidebarContextMenu({
  position,
  isFolder,
  isSynced = false,
  isCloudOnly = false,
  isOfflineEnabled = false,
  canSync = false,
  canMakeOffline = true,
  canAddToTeam = false,
  showManagePerms = false,
  isCloudFolder = false,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onRevealInFolder,
  onOpen,
  onSyncToCloud,
  onUnsyncFromCloud,
  onMakeOffline,
  onRemoveOffline,
  onAddToTeam,
  onManagePermissions,
}: SidebarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape key or clicking outside
  useEffect(() => {
    if (!position) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 80);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
      clearTimeout(t);
    };
  }, [position, onClose]);

  if (!position) return null;

  const MENU_W = 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = position.x + 4;
  let y = position.y + 4;
  if (x + MENU_W > vw - 12) x = position.x - MENU_W - 4;
  if (y + 400 > vh - 12) y = Math.max(8, position.y - 300);
  x = Math.max(8, x);
  y = Math.max(8, y);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: y,
    left: x,
    width: MENU_W,
    zIndex: 99999,
    borderRadius: 12,
    overflow: 'hidden',
    background: 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)',
    backdropFilter: 'blur(20px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
    border: '1px solid var(--editor-border, rgba(128,128,128,0.15))',
    boxShadow: '0 10px 30px color-mix(in srgb, var(--editor-text-color, #000) 12%, transparent), 0 2px 6px color-mix(in srgb, var(--editor-text-color, #000) 6%, transparent)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    userSelect: 'none',
    padding: '4px 0',
  };

  const dividerStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--editor-border, rgba(128,128,128,0.12))',
    margin: '4px 0',
  };

  const itemStyle = (danger = false, muted = false, accent?: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: danger
      ? 'var(--editor-error, #e11d48)'
      : accent
        ? accent
        : muted
          ? 'color-mix(in srgb, var(--editor-text-color, #111827) 55%, transparent)'
          : 'var(--editor-text-color, #111827)',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    transition: 'background 0.08s',
  });

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'rgba(128,128,128,0.08)';
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
  };

  const btn = (
    label: string,
    icon: React.ReactNode,
    handler?: () => void,
    danger = false,
    muted = false,
    accent?: string,
  ) => handler ? (
    <button
      style={itemStyle(danger, muted, accent)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => { handler(); onClose(); }}
    >
      {icon}
      {label}
    </button>
  ) : null;

  const ic = (color: string) => ({ width: 14, height: 14, opacity: 0.75, color });

  const showCloudSection = canSync || isSynced || isCloudOnly || canAddToTeam;
  const showOfflineToggle = canMakeOffline && (isSynced || isCloudOnly);

  return createPortal(
    <div ref={menuRef} style={menuStyle}>
      {isFolder ? (
        <>
          {btn('New File', <Plus style={ic('currentColor')} />, onCreateFile)}
          {btn('New Folder', <FolderPlus style={ic('currentColor')} />, onCreateFolder)}
          <div style={dividerStyle} />
          {btn('Rename', <Edit2 style={ic('currentColor')} />, onRename)}
          {!isCloudFolder && btn('Reveal in Finder', <FolderOpen style={ic('currentColor')} />, onRevealInFolder)}
          {showCloudSection && <div style={dividerStyle} />}
          {canSync && !isSynced && btn('Sync to Cloud', <Cloud style={ic('var(--editor-info, #3b82f6)')} />, onSyncToCloud)}
          {isSynced && btn('Remove Cloud Sync', <CloudOff style={ic('var(--editor-muted, #6b7280)')} />, onUnsyncFromCloud, false, true)}
          {showOfflineToggle && !isOfflineEnabled && btn('Make Available Offline', <WifiHigh style={ic('var(--editor-accent, #8b5cf6)')} />, onMakeOffline)}
          {showOfflineToggle && isOfflineEnabled && btn('Remove Offline Access', <WifiOff style={ic('var(--editor-muted, #6b7280)')} />, onRemoveOffline, false, true)}
          {canAddToTeam && btn('Add to Team', <UserPlus style={ic('var(--editor-warning, #f97316)')} />, onAddToTeam, false, false)}
          {showManagePerms && <div style={dividerStyle} />}
          {showManagePerms && btn('Manage Permissions', <Shield style={ic('var(--editor-accent, #a855f7)')} />, onManagePermissions, false, false, 'var(--editor-accent, #a855f7)')}
          <div style={dividerStyle} />
          {btn('Delete', <Trash2 style={{ width: 14, height: 14, opacity: 0.8 }} />, onDelete, true)}
        </>
      ) : (
        <>
          {!isCloudOnly && btn('Open', <ExternalLink style={ic('currentColor')} />, onOpen)}
          {!isCloudOnly && btn('Rename', <Edit2 style={ic('currentColor')} />, onRename)}
          {showCloudSection && <div style={dividerStyle} />}
          {canSync && !isSynced && !isCloudOnly && btn('Sync to Cloud', <Cloud style={ic('var(--editor-info, #3b82f6)')} />, onSyncToCloud)}
          {(isSynced || isCloudOnly) && btn('Remove Cloud Sync', <CloudOff style={ic('var(--editor-muted, #6b7280)')} />, onUnsyncFromCloud, false, true)}
          {showOfflineToggle && !isOfflineEnabled && btn('Make Available Offline', <WifiHigh style={ic('var(--editor-accent, #8b5cf6)')} />, onMakeOffline)}
          {showOfflineToggle && isOfflineEnabled && btn('Remove Offline Access', <WifiOff style={ic('var(--editor-muted, #6b7280)')} />, onRemoveOffline, false, true)}
          {canAddToTeam && !isSynced && !isCloudOnly && btn('Add to Team', <UserPlus style={ic('var(--editor-warning, #f97316)')} />, onAddToTeam, false, false)}
          {showManagePerms && <div style={dividerStyle} />}
          {showManagePerms && btn('Manage Permissions', <Shield style={ic('var(--editor-accent, #a855f7)')} />, onManagePermissions, false, false, 'var(--editor-accent, #a855f7)')}
          <div style={dividerStyle} />
          {btn('Delete', <Trash2 style={{ width: 14, height: 14, opacity: 0.8 }} />, onDelete, true)}
        </>
      )}
    </div>,
    document.body
  );
}
