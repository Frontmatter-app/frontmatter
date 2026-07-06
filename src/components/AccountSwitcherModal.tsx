import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, timeAgo } from '../auth/AuthProvider';
import { X, LogOut, Plus, Check, Users, Layout, Loader2, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { usePlan } from '../billing/PlanProvider';
import { useTeamNames } from '../hooks/useTeamNames';
import { showConfirmDialog, showAlertDialog } from '../lib/tauriDialog';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountSwitcherModal({ isOpen, onClose }: AccountSwitcherModalProps) {
  const {
    user,
    savedAccounts,
    switchAccount,
    logout,
    logoutAll,
    signInWithGoogle,
    removeSavedAccount,
    loading: authLoading,
    authEvents,
    clearAuthEvents,
  } = useAuth();
  const { plan, teamMemberships, activeContext, switchWorkspace } = usePlan();

  // Load team list reactively using the shared hook
  const teams = useTeamNames(teamMemberships, isOpen);

  // ── Per-action loading states (avoids single shared-flag confusion) ──
  const [addingAccount, setAddingAccount]           = useState(false);
  const [switchingUid, setSwitchingUid]             = useState<string | null>(null);
  const [signingOut, setSigningOut]                 = useState(false);
  const [signingOutAll, setSigningOutAll]           = useState(false);
  const [removingUid, setRemovingUid]               = useState<string | null>(null);
  const [workspaceSwitchingId, setWorkspaceSwitchingId] = useState<string | null>(null); // 'personal' or teamId

  // Any global action is in flight
  const isAnyLoading =
    addingAccount || !!switchingUid || signingOut || signingOutAll || !!workspaceSwitchingId || authLoading;

  // ── Sorted account list helpers ─────────────────────────────────────
  const getSortedAccounts = useCallback(() => {
    return [...savedAccounts].sort(
      (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
    );
  }, [savedAccounts]);

  const otherAccounts = getSortedAccounts().filter((acc) => acc.uid !== user?.id);

  // ── Keyboard shortcuts: 1–9 to switch to a saved account quickly ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        const account = otherAccounts[idx];
        if (account && !isAnyLoading) {
          e.preventDefault();
          handleSwitchAccount(account.uid);
        }
      }
      if (e.key === 'Escape') onClose();
    },
    [isOpen, otherAccounts, isAnyLoading]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Reset state on open ──────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setAddingAccount(false);
      setSwitchingUid(null);
      setSigningOut(false);
      setSigningOutAll(false);
      setRemovingUid(null);
      setWorkspaceSwitchingId(null);
      clearAuthEvents();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // ── Handlers ────────────────────────────────────────────────────

  const handleAddAccount = async () => {
    setAddingAccount(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      await showAlertDialog(
        'Add Account Error',
        err instanceof Error ? err.message : 'Failed to add account. Please try again.'
      );
    } finally {
      setAddingAccount(false);
    }
  };

  const handleSwitchAccount = async (uid: string) => {
    if (isAnyLoading) return;
    const targetAcc = savedAccounts.find((a) => a.uid === uid);
    const displayName = targetAcc ? targetAcc.displayName : 'this account';

    const confirmed = await showConfirmDialog(
      'Switch Account',
      `Open ${displayName} in a new window?`
    );
    if (!confirmed) return;

    setSwitchingUid(uid);
    try {
      await switchAccount(uid);
      onClose();
    } catch (err) {
      await showAlertDialog(
        'Switch Account Error',
        err instanceof Error ? err.message : 'Failed to switch account. Please try again.'
      );
    } finally {
      setSwitchingUid(null);
    }
  };

  const handleRemoveAccount = async (uid: string) => {
    const confirmed = await showConfirmDialog(
      'Remove Account',
      'Are you sure you want to remove this account profile from this device?'
    );
    if (!confirmed) return;
    setRemovingUid(uid);
    try {
      await removeSavedAccount(uid);
    } catch (err) {
      await showAlertDialog(
        'Remove Account Error',
        err instanceof Error ? err.message : 'Failed to remove account.'
      );
    } finally {
      setRemovingUid(null);
    }
  };

  const handleSignOutCurrent = async () => {
    const confirmed = await showConfirmDialog(
      'Sign Out',
      'Sign out of this account? You can switch back at any time if other accounts are saved.'
    );
    if (!confirmed) return;
    setSigningOut(true);
    try {
      await logout();
      onClose();
    } catch (err) {
      await showAlertDialog(
        'Sign Out Error',
        err instanceof Error ? err.message : 'Failed to sign out. Please try again.'
      );
    } finally {
      setSigningOut(false);
    }
  };

  const handleSignOutAll = async () => {
    const confirmed = await showConfirmDialog(
      'Sign Out All',
      'Sign out of all saved accounts? This will clear all cached sessions on this device.'
    );
    if (!confirmed) return;
    setSigningOutAll(true);
    try {
      await logoutAll();
      onClose();
    } catch (err) {
      await showAlertDialog(
        'Sign Out Error',
        err instanceof Error ? err.message : 'Failed to sign out of all accounts.'
      );
    } finally {
      setSigningOutAll(false);
    }
  };

  const handleSwitchWorkspaceInPlace = async (context: {
    type: 'personal' | 'team';
    teamId?: string;
    teamName?: string;
  }) => {
    const contextId = context.type === 'personal' ? 'personal' : context.teamId || 'team';
    setWorkspaceSwitchingId(contextId);
    try {
      await switchWorkspace(context);
      onClose();
    } catch (e) {
      console.error('[AccountSwitcher] Workspace switch failed:', e);
      await showAlertDialog('Workspace Error', 'Failed to open workspace window. Please try again.');
    } finally {
      setWorkspaceSwitchingId(null);
    }
  };

  // ── Derived display values ────────────────────────────────────────
  const planLabel =
    plan === 'team' ? 'Team Owner' : plan === 'author' ? 'Author' : 'Free';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--editor-bg-color, #000) 45%, transparent)' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative w-full max-w-sm rounded-2xl p-5 shadow-2xl backdrop-blur-xl flex flex-col max-h-[85vh] animate-scale-up"
        role="dialog"
        aria-label="Switch Account"
        style={{
          border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 8%, transparent)',
          background: 'color-mix(in srgb, var(--editor-bg-color, #0d1117) 92%, transparent)',
          color: 'var(--editor-text-color, #c9d1d9)',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 transition cursor-pointer"
          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="mb-4">
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--editor-text-color, #c9d1d9)' }}
          >
            Switch Account
          </h2>
          <p
            className="text-[11px] mt-0.5"
            style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }}
          >
            Open workspaces and accounts in separate isolated windows.
          </p>
        </div>

        {/* Auth Events */}
        {authEvents.length > 0 && (
          <div className="mb-3 space-y-1">
            {authEvents.map((evt, idx) =>
              evt.type === 'error' ? (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 rounded-xl text-[11px]"
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    color: '#f87171',
                  }}
                >
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  <span className="flex-1">{evt.message}</span>
                </div>
              ) : (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 rounded-xl text-[11px]"
                  style={{
                    background: 'rgba(34,197,94,0.1)',
                    border: '1px solid rgba(34,197,94,0.2)',
                    color: '#4ade80',
                  }}
                >
                  <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                  <span className="flex-1">{evt.message}</span>
                </div>
              )
            )}
          </div>
        )}

        {/* Active Account Identity Card */}
        {user && (
          <div
            className="mb-4 p-3 rounded-xl flex items-center gap-2.5"
            style={{
              border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)',
              background: 'color-mix(in srgb, var(--editor-bg-color, #0d1117) 50%, transparent)',
            }}
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.display_name}
                className="w-8 h-8 rounded-full object-cover"
                style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)' }}
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full font-bold flex items-center justify-center text-xs"
                style={{
                  background: 'var(--editor-secondary-bg, #161b22)',
                  color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 70%, transparent)',
                }}
              >
                {user.display_name?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                className="text-xs font-semibold flex items-center gap-1.5"
                style={{ color: 'var(--editor-text-color, #c9d1d9)' }}
              >
                <span className="truncate">{user.display_name}</span>
                <span
                  className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase"
                  style={{
                    border: '1px solid color-mix(in srgb, var(--editor-link-color, #58a6ff) 25%, transparent)',
                    background: 'color-mix(in srgb, var(--editor-link-color, #58a6ff) 12%, transparent)',
                    color: 'var(--editor-link-color, #58a6ff)',
                  }}
                >
                  {planLabel}
                </span>
              </div>
              <div
                className="text-[10px] truncate mt-0.5"
                style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }}
              >
                {user.email}
              </div>
            </div>
          </div>
        )}

        {/* Active Account Workspaces (Personal + Teams) */}
        {user && (
          <div
            className="mb-4 pt-3"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}
          >
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-2 px-1"
              style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
            >
              Active Account Workspaces
            </div>

            <div className="space-y-1">
              {/* Personal workspace entry */}
              <div
                onClick={() => {
                  if (!isAnyLoading) handleSwitchWorkspaceInPlace({ type: 'personal' });
                }}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-all duration-200 cursor-pointer group ${
                  isAnyLoading ? 'opacity-60 pointer-events-none' : ''
                }`}
                style={{
                  borderColor: activeContext.type === 'personal'
                    ? 'color-mix(in srgb, var(--editor-link-color, #58a6ff) 25%, transparent)'
                    : 'transparent',
                  background: activeContext.type === 'personal'
                    ? 'color-mix(in srgb, var(--editor-link-color, #58a6ff) 6%, transparent)'
                    : 'transparent',
                  color: activeContext.type === 'personal'
                    ? 'var(--editor-link-color, #58a6ff)'
                    : 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 80%, transparent)',
                }}
                onMouseEnter={(e) => {
                  if (activeContext.type !== 'personal') {
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)';
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 3%, transparent)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeContext.type !== 'personal') {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Layout className="w-4 h-4 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <div className="text-xs font-semibold">Personal Workspace</div>
                    <div
                      className="text-[10px] truncate"
                      style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                    >
                      Private cloud docs & local folder
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {workspaceSwitchingId === 'personal' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }} />
                  ) : activeContext.type === 'personal' ? (
                    <Check className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <span
                      className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                    >
                      Open
                    </span>
                  )}
                </div>
              </div>

              {/* Team workspace entries */}
              {teams.map((t) => {
                const isActive = activeContext.type === 'team' && activeContext.teamId === t.id;
                const isThisSwitching = workspaceSwitchingId === t.id;

                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      if (!isAnyLoading)
                        handleSwitchWorkspaceInPlace({
                          type: 'team',
                          teamId: t.id,
                          teamName: t.name,
                        });
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all duration-200 cursor-pointer group ${
                      isAnyLoading ? 'opacity-60 pointer-events-none' : ''
                    }`}
                    style={{
                      borderColor: isActive
                        ? 'color-mix(in srgb, var(--editor-caret-color, #1f6feb) 25%, transparent)'
                        : 'transparent',
                      background: isActive
                        ? 'color-mix(in srgb, var(--editor-caret-color, #1f6feb) 6%, transparent)'
                        : 'transparent',
                      color: isActive
                        ? 'var(--editor-caret-color, #1f6feb)'
                        : 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 80%, transparent)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)';
                        e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 3%, transparent)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = 'transparent';
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Users className="w-4 h-4 flex-shrink-0" />
                      <div className="min-w-0 text-left">
                        <div className="text-xs font-semibold truncate">{t.name} Workspace</div>
                        <div
                          className="text-[10px] truncate"
                          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                        >
                          Shared team cloud docs & local folder
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isThisSwitching ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }} />
                      ) : isActive ? (
                        <Check className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <span
                          className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                        >
                          Open
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Other Saved Accounts list */}
        {otherAccounts.length > 0 && (
          <div
            className="mb-4 pt-3"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}
          >
            <div
              className="text-[9px] font-bold uppercase tracking-widest mb-2 px-1 flex items-center justify-between"
              style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
            >
              <span>Other Accounts</span>
              <span className="text-[8px] font-normal normal-case tracking-normal" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 30%, transparent)' }}>
                {otherAccounts.length} saved
              </span>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1" role="listbox">
              {otherAccounts.map((acc, idx) => {
                const isSwitchingThisAccount = switchingUid === acc.uid;
                const isRemovingThisAccount  = removingUid === acc.uid;
                const rowDisabled            = isAnyLoading;

                return (
                  <div
                    key={acc.uid}
                    role="option"
                    aria-selected={false}
                    className={`group flex items-center justify-between p-2 rounded-xl border border-transparent transition-all duration-200 cursor-pointer ${
                      rowDisabled ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    style={{ borderColor: 'transparent' }}
                    onClick={() => !rowDisabled && handleSwitchAccount(acc.uid)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)';
                      e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 3%, transparent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'transparent';
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {acc.photoURL ? (
                        <img
                          src={acc.photoURL}
                          alt={acc.displayName}
                          className="w-7 h-7 rounded-full object-cover"
                          style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)' }}
                        />
                      ) : (
                        <div
                          className="w-7 h-7 rounded-full border font-semibold flex items-center justify-center text-[10px]"
                          style={{
                            background: 'var(--editor-bg-color, #0d1117)',
                            borderColor: 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)',
                            color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 60%, transparent)',
                          }}
                        >
                          {acc.displayName?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 text-left flex-1">
                        <div
                          className="text-xs font-medium truncate flex items-center gap-1.5"
                          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 80%, transparent)' }}
                        >
                          <span className="truncate">{acc.displayName}</span>
                          {idx < 9 && (
                            <kbd
                              className="px-1 py-0.5 rounded text-[8px] font-mono opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                background: 'var(--editor-secondary-bg, #161b22)',
                                color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)',
                              }}
                            >
                              {idx + 1}
                            </kbd>
                          )}
                        </div>
                        <div
                          className="text-[10px] truncate flex items-center gap-1.5"
                          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                        >
                          <span className="truncate">{acc.email}</span>
                          {acc.lastUsed && (
                            <span className="flex-shrink-0" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 28%, transparent)' }}>
                              · {timeAgo(acc.lastUsed)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isSwitchingThisAccount ? (
                        <div
                          className="flex items-center gap-1.5 text-[10px]"
                          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 50%, transparent)' }}
                        >
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Opening…</span>
                        </div>
                      ) : isRemovingThisAccount ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#f87171' }} />
                      ) : (
                        <>
                          <span
                            className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0"
                            style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                          >
                            Open
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveAccount(acc.uid);
                            }}
                            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = '#f87171';
                              e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)';
                              e.currentTarget.style.background = 'transparent';
                            }}
                            title="Remove saved account"
                            aria-label={`Remove ${acc.displayName}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div
          className="flex flex-col gap-2 pt-3 mt-auto"
          style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}
        >
          <div className="flex gap-2">
            {/* Add Account */}
            <button
              onClick={handleAddAccount}
              disabled={isAnyLoading}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)',
                background: 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)',
                color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 85%, transparent)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)';
              }}
            >
              {addingAccount ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Add Account
                </>
              )}
            </button>

            {/* Sign Out current active account */}
            {user && (
              <button
                onClick={handleSignOutCurrent}
                disabled={isAnyLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)',
                  color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 75%, transparent)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)';
                }}
              >
                {signingOut ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Signing out…
                  </>
                ) : (
                  <>
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </>
                )}
              </button>
            )}
          </div>

          {/* Sign Out All */}
          {savedAccounts.length > 1 && (
            <button
              onClick={handleSignOutAll}
              disabled={isAnyLoading}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'rgba(239,68,68,0.1)',
                color: '#f87171',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
              }}
            >
              {signingOutAll ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Signing out all…
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out All Accounts
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
