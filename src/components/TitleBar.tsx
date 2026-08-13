import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useSyncStatusStore } from '../cloud/syncStatusStore';
import { useSettingsStore } from '../settings/settingsStore';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { CollaborationBar } from './CollaborationBar';
import { registry } from '../yjs/DocumentRegistry';
import { AccountSwitcherModal } from './AccountSwitcherModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Effect, EffectState } from '@tauri-apps/api/window';
import {
  RefreshCw,
  Cloud,
  CloudOff,
  CloudLightning,
  Minimize,
  Maximize,
  Square,
  X,
  User,
  Settings,
  Keyboard,
  CheckCircle,
  Activity,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { AppMenu } from '../layout/titleBar/AppMenu';
import { useChromeTheme } from '../design/useChromeTheme';

const APP_NAME = 'Marktype';
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function SyncPopover({
  syncStatus,
  lastSyncedAt,
  onClose,
}: {
  syncStatus: string;
  lastSyncedAt: Date | null;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-0 mt-2 w-52 rounded-xl border border-white/10 bg-zinc-900 text-white p-3 shadow-xl backdrop-blur-xl z-50 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="font-semibold mb-1 flex items-center gap-1.5 text-neutral-200">
        Cloud:{' '}
        <span className="capitalize text-amber-400">{syncStatus}</span>
      </div>
      {lastSyncedAt && (
        <div className="text-[10px] text-neutral-400 mb-2">
          Last synced: {lastSyncedAt.toLocaleTimeString()}
        </div>
      )}
      <button
        onClick={() => {
          onClose();
          const activeDocs = registry.getActive();
          activeDocs.forEach((id) => registry.saveDocument(id));
        }}
        className="w-full py-1.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg text-center transition cursor-pointer text-xs"
      >
        Sync Now
      </button>
    </div>
  );
}

function UserAvatarMenu() {
  const { user } = useAuth();
  const { openSettings } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global shortcut: Cmd/Ctrl+Shift+K to open shortcuts modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Listen for event-driven open from other parts of the app
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('open-keyboard-shortcuts', handler);
    return () => window.removeEventListener('open-keyboard-shortcuts', handler);
  }, []);

  const handlePreferences = useCallback(() => {
    setIsOpen(false);
    openSettings('general');
  }, [openSettings]);

  const handleActivityMonitor = useCallback(() => {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('open-activity-monitor'));
  }, []);

  const handleAccount = useCallback(() => {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('open-account-switcher'));
  }, []);

  const handleKeyboardShortcuts = useCallback(() => {
    setIsOpen(false);
    setShowShortcuts(true);
  }, []);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="w-7 h-7 rounded-full border hover:border-black/20 bg-black/5 hover:bg-black/10 flex items-center justify-center shadow-sm transition-all active:scale-90 duration-150 cursor-pointer overflow-hidden flex-shrink-0"
          style={{ borderColor: 'rgba(0,0,0,0.10)' }}
          aria-label="Account menu"
          aria-expanded={isOpen}
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.display_name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 text-[var(--editor-text-color)] font-semibold text-[10px] select-none">
              {user?.display_name?.charAt(0).toUpperCase() || '✦'}
            </div>
          )}
        </button>

        {isOpen && (
          <div
            className="absolute right-0 mt-2 w-56 rounded-xl border border-black/10 bg-white dark:bg-zinc-900 shadow-xl z-50 text-sm animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2 border-b border-gray-100 dark:border-white/10">
              <div className="font-semibold text-gray-900 dark:text-white truncate text-xs">
                {user?.display_name}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {user?.email}
              </div>
            </div>
            <div className="p-1">
              <button
                onClick={handleAccount}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs flex items-center gap-2 transition cursor-pointer"
              >
                <User className="w-3.5 h-3.5" /> Account
              </button>
              <button
                onClick={handlePreferences}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs flex items-center gap-2 transition cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" /> Preferences
              </button>
              <button
                onClick={handleActivityMonitor}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs flex items-center gap-2 transition cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" /> Activity Monitor
              </button>
              <button
                onClick={handleKeyboardShortcuts}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs flex items-center justify-between gap-2 transition cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Keyboard className="w-3.5 h-3.5" /> Keyboard Shortcuts
                </span>
                <span className="flex items-center gap-0.5 opacity-50">
                  <kbd className="text-[9px] font-semibold px-1 py-0.5 rounded border border-current leading-none">⌘</kbd>
                  <kbd className="text-[9px] font-semibold px-1 py-0.5 rounded border border-current leading-none">⇧</kbd>
                  <kbd className="text-[9px] font-semibold px-1 py-0.5 rounded border border-current leading-none">K</kbd>
                </span>
              </button>
              <button
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs flex items-center gap-2 transition cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Check for Updates
              </button>
            </div>
          </div>
        )}
      </div>

      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </>
  );
}

function WindowControls({
  isMaximized,
  onClose,
  onMaximize,
  onMinimize,
}: {
  isMaximized: boolean;
  onClose: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
}) {
  return (
    <div className="flex items-center" style={{ marginLeft: '4px' }}>
      <button
        onClick={onMinimize}
        className="w-11 h-8 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
        aria-label="Minimize"
      >
        <Minimize className="w-4 h-4 text-gray-600 dark:text-gray-300" />
      </button>
      <button
        onClick={onMaximize}
        className="w-11 h-8 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Square className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
        ) : (
          <Maximize className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        )}
      </button>
      <button
        onClick={onClose}
        className="w-11 h-8 flex items-center justify-center hover:bg-red-500 hover:text-white transition cursor-pointer group"
        aria-label="Close"
      >
        <X className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-white" />
      </button>
    </div>
  );
}

export function TitleBar() {
  const { plan, isTeamOwner, activeContext, upgradeToAuthor, upgradeToTeam } = usePlan();
  const { currentDocumentId, documents, workspacePath } = useWorkspace();
  const syncStatus = useSyncStatusStore((state) => state.status);
  const lastSyncedAt = useSyncStatusStore((state) => state.lastSyncedAt);
  const { openSettings, settings } = useSettingsStore();

  useChromeTheme();

  const [isMaximized, setIsMaximized] = useState(false);
  const [showSyncPopover, setShowSyncPopover] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Listen for open-account-switcher event from UserAvatarMenu
  useEffect(() => {
    const handler = () => setIsAccountModalOpen(true);
    window.addEventListener('open-account-switcher', handler);
    return () => window.removeEventListener('open-account-switcher', handler);
  }, []);

  const currentDoc = documents.find((d) => d.id === currentDocumentId);
  const isCloudDoc = currentDoc
    ? currentDoc.is_cloud || currentDoc.cloud_synced || !!currentDoc.cloud_id
    : false;

  const hidePlanBadge = isTeamOwner && activeContext.type === 'team';
  const docTitle = currentDoc?.title || 'Untitled Document';
  const menuTitle = currentDocumentId ? `${docTitle} - ${APP_NAME}` : APP_NAME;

  useEffect(() => {
    let active = true;
    invoke<boolean>('get_window_state')
      .then((state) => {
        if (active) setIsMaximized(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isMac) {
      getCurrentWindow()
        .setEffects({
          effects: [Effect.Titlebar],
          state: EffectState.FollowsWindowActiveState,
          radius: 0,
        })
        .catch(() => {});
    }
  }, [isMac]);

  const handleClose = useCallback(async () => {
    await invoke('close_window');
  }, []);

  const handleMaximize = useCallback(async () => {
    const state = await invoke<boolean>('get_window_state');
    if (state) {
      await invoke('restore_window');
      setIsMaximized(false);
    } else {
      await invoke('maximize_window');
      setIsMaximized(true);
    }
  }, []);

  const handleMinimize = useCallback(async () => {
    await invoke('minimize_window');
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (!isMac) {
      handleMaximize();
    }
  }, [isMac, handleMaximize]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!isMac) {
        e.preventDefault();
      }
    },
    [isMac],
  );

  return (
    <div
      role="banner"
      className="h-10 flex items-center justify-between select-none border-b border-black/5 dark:border-white/5 flex-shrink-0 bg-[var(--editor-secondary-bg)]"
      style={{
        transition: 'background-color 0.3s ease',
        paddingLeft: isMac ? '80px' : '12px',
        paddingRight: isMac ? '12px' : '0px',
      }}
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Left: application menu. Non-macOS this is the only menu; on macOS it
          mirrors the native menu bar for reachability. */}
      <div className="flex items-center flex-shrink-0" data-tauri-drag-region={undefined}>
        <AppMenu hasDocument={!!currentDocumentId} hasWorkspace={!!workspacePath} />
      </div>

      {/* Center: Document title — absolutely positioned so it stays centered */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center min-w-0 max-w-[40vw] gap-2 relative"
        data-tauri-drag-region
      >
        <span
          className="text-sm font-medium truncate text-[var(--editor-text-color)] opacity-90 animate-in fade-in duration-200"
          title={menuTitle}
        >
          {menuTitle}
        </span>

      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-1 relative flex-shrink-0 ml-auto">
        <CollaborationBar documentId={currentDocumentId} />

        {isCloudDoc && (
          <div className="relative">
            <button
              onClick={() => setShowSyncPopover((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-black/5 transition relative cursor-pointer text-[var(--editor-text-color)]"
              title="Cloud sync status"
            >
              {syncStatus === 'synced' && (
                <Cloud className="w-4 h-4 text-green-500" />
              )}
              {syncStatus === 'syncing' && (
                <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
              )}
              {syncStatus === 'error' && (
                <CloudLightning className="w-4 h-4 text-red-500 animate-pulse" />
              )}
              {syncStatus === 'offline' && (
                <CloudOff className="w-4 h-4 text-gray-400" />
              )}
              {syncStatus === 'idle' && (
                <Cloud className="w-4 h-4 text-neutral-400" />
              )}
            </button>

            {showSyncPopover && (
              <SyncPopover
                syncStatus={syncStatus}
                lastSyncedAt={lastSyncedAt}
                onClose={() => setShowSyncPopover(false)}
              />
            )}
          </div>
        )}

        {!hidePlanBadge && (
          <button
            onClick={() => plan === 'free' && setShowUpgradeModal(true)}
            className={cn(
              'px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase border select-none transition cursor-pointer',
              plan === 'team' && 'bg-orange-500/10 text-orange-400 border-orange-500/20 cursor-default',
              plan === 'author' && 'bg-amber-500/10 text-amber-400 border-amber-500/20 cursor-default',
              plan === 'enterprise' && 'bg-purple-500/10 text-purple-400 border-purple-500/20 cursor-default',
              plan === 'free' && 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20 hover:bg-neutral-500/15',
            )}
            disabled={plan !== 'free'}
          >
            {plan === 'team'
              ? 'Team ✦✦'
              : plan === 'author'
                ? 'Author ✦'
                : plan === 'enterprise'
                  ? 'Enterprise'
                  : 'Free'}
          </button>
        )}

        {!isMac && (
          <WindowControls
            isMaximized={isMaximized}
            onClose={handleClose}
            onMaximize={handleMaximize}
            onMinimize={handleMinimize}
          />
        )}

        <UserAvatarMenu />

        <AccountSwitcherModal
          isOpen={isAccountModalOpen}
          onClose={() => setIsAccountModalOpen(false)}
        />

        {showUpgradeModal && (
          <UpgradeModalInline
            settings={settings}
            onUpgradeAuthor={upgradeToAuthor}
            onUpgradeTeam={upgradeToTeam}
            onClose={() => setShowUpgradeModal(false)}
          />
        )}
      </div>
    </div>
  );
}

function UpgradeModalInline({
  settings,
  onUpgradeAuthor,
  onUpgradeTeam,
  onClose,
}: {
  settings: { themeType: string };
  onUpgradeAuthor: () => Promise<void>;
  onUpgradeTeam: () => Promise<void>;
  onClose: () => void;
}) {
  const isDark = settings.themeType.startsWith('github_dark');
  const glassStyle: React.CSSProperties = {
    background: isDark ? 'rgba(15, 18, 25, 0.95)' : 'rgba(255, 255, 255, 0.98)',
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    color: 'var(--editor-text-color)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl h-[85vh] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden" style={glassStyle}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 flex-shrink-0 bg-black/5 dark:bg-white/2">
          <div className="flex items-center gap-3 flex-1">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h2 className="font-bold text-base select-none">Upgrade Plan</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-red-500 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto bg-[var(--editor-bg-color)]">
          <div className="max-w-3xl w-full flex flex-col gap-6">
            <button
              onClick={async () => { await onUpgradeAuthor(); onClose(); }}
              className="p-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-left hover:bg-amber-500/10 transition cursor-pointer group"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <span className="font-bold text-lg">Author Plan</span>
              </div>
              <p className="text-xs opacity-60 mb-3">Cloud sync + multi-device access</p>
              <span className="text-2xl font-extrabold text-amber-500">$9.99<span className="text-sm font-normal opacity-60">/mo</span></span>
            </button>
            <button
              onClick={async () => { await onUpgradeTeam(); onClose(); }}
              className="p-6 rounded-2xl border border-orange-500/30 bg-orange-500/5 text-left hover:bg-orange-500/10 transition cursor-pointer group"
            >
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-orange-400" />
                <span className="font-bold text-lg">Team Plan</span>
              </div>
              <p className="text-xs opacity-60 mb-3">Real-time collaboration, 10 seats</p>
              <span className="text-2xl font-extrabold text-orange-500">$99.99<span className="text-sm font-normal opacity-60">/mo</span></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
