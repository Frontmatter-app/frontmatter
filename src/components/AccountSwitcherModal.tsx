import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { usePlan } from '../billing/PlanProvider';
import { useTeamNames } from '../hooks/useTeamNames';
import { showConfirmDialog, showAlertDialog } from '../lib/tauriDialog';
import { ActiveAccountCard } from './ActiveAccountCard';
import { WorkspaceList } from './WorkspaceList';
import { SavedAccountList } from './SavedAccountList';
import { AccountFooterActions } from './AccountFooterActions';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountSwitcherModal({ isOpen, onClose }: AccountSwitcherModalProps) {
  const { user, savedAccounts, switchAccount, logout, logoutAll, signInWithGoogle, removeSavedAccount, authEvents, clearAuthEvents } = useAuth();
  const { plan, teamMemberships, activeContext, switchWorkspace } = usePlan();
  const teams = useTeamNames(teamMemberships, isOpen);

  const [addingAccount, setAddingAccount]           = useState(false);
  const [switchingUid, setSwitchingUid]             = useState<string | null>(null);
  const [signingOut, setSigningOut]                 = useState(false);
  const [signingOutAll, setSigningOutAll]           = useState(false);
  const [removingUid, setRemovingUid]               = useState<string | null>(null);
  const [workspaceSwitchingId, setWorkspaceSwitchingId] = useState<string | null>(null);

  const isAnyLoading = addingAccount || !!switchingUid || signingOut || signingOutAll || !!workspaceSwitchingId;

  const getSortedAccounts = useCallback(() => {
    return [...savedAccounts].sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());
  }, [savedAccounts]);

  const otherAccounts = getSortedAccounts().filter((acc) => acc.uid !== user?.id);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      const account = otherAccounts[idx];
      if (account && !isAnyLoading) { e.preventDefault(); handleSwitchAccount(account.uid); }
    }
    if (e.key === 'Escape') onClose();
  }, [isOpen, otherAccounts, isAnyLoading]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      setAddingAccount(false); setSwitchingUid(null); setSigningOut(false);
      setSigningOutAll(false); setRemovingUid(null); setWorkspaceSwitchingId(null);
      clearAuthEvents();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddAccount = async () => {
    setAddingAccount(true);
    try { await signInWithGoogle(); }
    catch (err) { await showAlertDialog('Add Account Error', err instanceof Error ? err.message : 'Failed to add account.'); }
    finally { setAddingAccount(false); }
  };

  const handleSwitchAccount = async (uid: string) => {
    if (isAnyLoading) return;
    const targetAcc = savedAccounts.find((a) => a.uid === uid);
    const displayName = targetAcc ? targetAcc.displayName : 'this account';
    if (!(await showConfirmDialog('Switch Account', `Open ${displayName} in a new window?`))) return;
    setSwitchingUid(uid);
    try { await switchAccount(uid); onClose(); }
    catch (err) { await showAlertDialog('Switch Account Error', err instanceof Error ? err.message : 'Failed to switch account.'); }
    finally { setSwitchingUid(null); }
  };

  const handleRemoveAccount = async (uid: string) => {
    if (!(await showConfirmDialog('Remove Account', 'Are you sure you want to remove this account profile from this device?'))) return;
    setRemovingUid(uid);
    try { await removeSavedAccount(uid); }
    catch (err) { await showAlertDialog('Remove Account Error', err instanceof Error ? err.message : 'Failed to remove account.'); }
    finally { setRemovingUid(null); }
  };

  const handleSignOutCurrent = async () => {
    if (!(await showConfirmDialog('Sign Out', 'Sign out of this account? You can switch back at any time if other accounts are saved.'))) return;
    setSigningOut(true);
    try { await logout(); onClose(); }
    catch (err) { await showAlertDialog('Sign Out Error', err instanceof Error ? err.message : 'Failed to sign out.'); }
    finally { setSigningOut(false); }
  };

  const handleSignOutAll = async () => {
    if (!(await showConfirmDialog('Sign Out All', 'Sign out of all saved accounts? This will clear all cached sessions on this device.'))) return;
    setSigningOutAll(true);
    try { await logoutAll(); onClose(); }
    catch (err) { await showAlertDialog('Sign Out Error', err instanceof Error ? err.message : 'Failed to sign out of all accounts.'); }
    finally { setSigningOutAll(false); }
  };

  const handleSwitchWorkspaceInPlace = async (context: { type: 'personal' | 'team'; teamId?: string; teamName?: string }) => {
    const contextId = context.type === 'personal' ? 'personal' : context.teamId || 'team';
    setWorkspaceSwitchingId(contextId);
    try { await switchWorkspace(context); onClose(); }
    catch (e) { await showAlertDialog('Workspace Error', 'Failed to open workspace window.'); }
    finally { setWorkspaceSwitchingId(null); }
  };

  const planLabel = plan === 'team' ? 'Team Owner' : plan === 'author' ? 'Author' : 'Free';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: 'color-mix(in srgb, var(--editor-bg-color, #000) 45%, transparent)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-5 shadow-2xl backdrop-blur-xl flex flex-col max-h-[85vh] animate-scale-up" role="dialog" aria-label="Switch Account"
        style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 8%, transparent)', background: 'color-mix(in srgb, var(--editor-bg-color, #0d1117) 92%, transparent)', color: 'var(--editor-text-color, #c9d1d9)' }}>
        <button onClick={onClose} className="absolute top-4 right-4 transition cursor-pointer" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="mb-4">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--editor-text-color, #c9d1d9)' }}>Switch Account</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }}>
            Open workspaces and accounts in separate isolated windows.
          </p>
        </div>

        {authEvents.length > 0 && (
          <div className="mb-3 space-y-1">
            {authEvents.map((evt, idx) => (
              <div key={idx} className={`flex items-center gap-2 p-2 rounded-xl text-[11px]`} style={{ background: evt.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: evt.type === 'error' ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(34,197,94,0.2)', color: evt.type === 'error' ? '#f87171' : '#4ade80' }}>
                {evt.type === 'error' ? <AlertCircle className="w-3 h-3 flex-shrink-0" /> : <CheckCircle2 className="w-3 h-3 flex-shrink-0" />}
                <span className="flex-1">{evt.message}</span>
              </div>
            ))}
          </div>
        )}

        {user && <ActiveAccountCard user={user} planLabel={planLabel} />}

        {user && (
          <WorkspaceList
            activeContext={activeContext}
            teams={teams}
            isAnyLoading={isAnyLoading}
            workspaceSwitchingId={workspaceSwitchingId}
            onSwitchWorkspace={handleSwitchWorkspaceInPlace}
          />
        )}

        <SavedAccountList
          accounts={otherAccounts}
          switchingUid={switchingUid}
          removingUid={removingUid}
          isAnyLoading={isAnyLoading}
          onSwitchAccount={handleSwitchAccount}
          onRemoveAccount={handleRemoveAccount}
        />

        <AccountFooterActions
          user={user}
          savedAccountsCount={savedAccounts.length}
          isAnyLoading={isAnyLoading}
          addingAccount={addingAccount}
          signingOut={signingOut}
          signingOutAll={signingOutAll}
          onAddAccount={handleAddAccount}
          onSignOut={handleSignOutCurrent}
          onSignOutAll={handleSignOutAll}
        />
      </div>
    </div>
  );
}
