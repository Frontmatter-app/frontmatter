import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, LogOut, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { usePlan } from '../billing/PlanProvider';
import { useTeamNames } from '../hooks/useTeamNames';
import { showConfirmDialog, showAlertDialog } from '../lib/tauriDialog';
import { DsButton, DsModal } from '../design/components';
import { ActiveAccountCard } from './ActiveAccountCard';
import { WorkspaceList } from './WorkspaceList';
import { SavedAccountList } from './SavedAccountList';
import { AccountSignInPanel } from './AccountSignInPanel';
import './accountModal.css';

/** Matches the limit the settings panel states, which nothing enforced before. */
export const MAX_SAVED_ACCOUNTS = 3;

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountSwitcherModal({ isOpen, onClose }: AccountSwitcherModalProps) {
  const {
    user, savedAccounts, switchAccount, logout, logoutAll,
    signInWithGoogle, sendMagicLink, removeSavedAccount, authEvents, clearAuthEvents,
  } = useAuth();
  const { plan, teamMemberships, activeContext, switchWorkspace } = usePlan();
  const teams = useTeamNames(teamMemberships, isOpen);

  const [addingAccount, setAddingAccount] = useState(false);
  const [switchingUid, setSwitchingUid] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [workspaceSwitchingId, setWorkspaceSwitchingId] = useState<string | null>(null);

  const isAnyLoading =
    addingAccount || !!switchingUid || signingOut || signingOutAll || !!removingUid || !!workspaceSwitchingId;

  const otherAccounts = [...savedAccounts]
    .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
    .filter((acc) => acc.uid !== user?.id);

  const atAccountLimit = savedAccounts.length >= MAX_SAVED_ACCOUNTS;

  const handleSwitchAccount = useCallback(async (uid: string) => {
    if (isAnyLoading) return;
    const target = savedAccounts.find((a) => a.uid === uid);
    const displayName = target ? target.displayName : 'this account';
    if (!(await showConfirmDialog('Switch account', `Open ${displayName} in a new window?`))) return;
    setSwitchingUid(uid);
    try {
      await switchAccount(uid);
      onClose();
    } catch (err) {
      await showAlertDialog('Could not switch account', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSwitchingUid(null);
    }
  }, [isAnyLoading, savedAccounts, switchAccount, onClose]);

  // Read through a ref so the window listener does not need re-registering on
  // every render, and never calls a stale copy of the handler.
  const switchRef = useRef(handleSwitchAccount);
  switchRef.current = handleSwitchAccount;

  const accountsRef = useRef(otherAccounts);
  accountsRef.current = otherAccounts;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape is handled by DsModal; this is only the 1-9 quick switch.
      if (e.key < '1' || e.key > '9') return;
      const account = accountsRef.current[Number(e.key) - 1];
      if (!account) return;
      e.preventDefault();
      void switchRef.current(account.uid);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setAddingAccount(false);
    setSwitchingUid(null);
    setSigningOut(false);
    setSigningOutAll(false);
    setRemovingUid(null);
    setWorkspaceSwitchingId(null);
    clearAuthEvents();
  }, [isOpen, clearAuthEvents]);

  const handleAddAccount = async () => {
    if (atAccountLimit) return;
    setAddingAccount(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      await showAlertDialog('Could not add account', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setAddingAccount(false);
    }
  };

  const handleRemoveAccount = async (uid: string) => {
    if (!(await showConfirmDialog('Remove account', 'Remove this account profile from this device?'))) return;
    setRemovingUid(uid);
    try {
      await removeSavedAccount(uid);
    } catch (err) {
      await showAlertDialog('Could not remove account', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setRemovingUid(null);
    }
  };

  const handleSignOutCurrent = async () => {
    if (!(await showConfirmDialog('Sign out', 'Sign out of this account? You can switch back at any time if other accounts are saved.'))) return;
    setSigningOut(true);
    try {
      await logout();
      onClose();
    } catch (err) {
      await showAlertDialog('Could not sign out', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!(await showConfirmDialog('Sign out of everything', 'Sign out of all saved accounts? This clears every cached session on this device.'))) return;
    setSigningOutAll(true);
    try {
      await logoutAll();
      onClose();
    } catch (err) {
      await showAlertDialog('Could not sign out', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSigningOutAll(false);
    }
  };

  const handleSwitchWorkspace = async (context: { type: 'personal' | 'team'; teamId?: string; teamName?: string }) => {
    const contextId = context.type === 'personal' ? 'personal' : context.teamId || 'team';
    setWorkspaceSwitchingId(contextId);
    try {
      await switchWorkspace(context);
      onClose();
    } catch {
      await showAlertDialog('Could not open workspace', 'Please try again.');
    } finally {
      setWorkspaceSwitchingId(null);
    }
  };

  const planLabel = plan === 'team' ? 'Team' : plan === 'author' ? 'Author' : plan === 'enterprise' ? 'Enterprise' : 'Free';

  const footer = user ? (
    <div className="account__footer-group">
      <DsButton onClick={handleAddAccount} disabled={isAnyLoading || atAccountLimit}
        title={atAccountLimit ? `You can save up to ${MAX_SAVED_ACCOUNTS} accounts on this device.` : undefined}>
        {addingAccount ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : <><Plus className="w-4 h-4" /> Add account</>}
      </DsButton>
      <DsButton variant="danger" onClick={handleSignOutCurrent} disabled={isAnyLoading}>
        {signingOut ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing out…</> : <><LogOut className="w-4 h-4" /> Sign out</>}
      </DsButton>
      {/* Only worth offering once there is more than one session to clear. */}
      {savedAccounts.length > 1 && (
        <DsButton variant="danger" onClick={handleSignOutAll} disabled={isAnyLoading}>
          {signingOutAll ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing out…</> : 'Sign out of all'}
        </DsButton>
      )}
    </div>
  ) : undefined;

  return (
    <DsModal
      open={isOpen}
      onClose={onClose}
      title={user ? 'Account' : 'Sign in'}
      subtitle={user
        ? 'Switch workspace, add another account, or sign out.'
        : 'Sync your documents across devices.'}
      dismissable={!isAnyLoading}
      footer={footer}
    >
      {authEvents.length > 0 && (
        <div className="account__events">
          {authEvents.map((evt, idx) => (
            <div
              key={idx}
              className={`account__event account__event--${evt.type}`}
              role={evt.type === 'error' ? 'alert' : 'status'}
            >
              <span className="account__event-icon">
                {evt.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              </span>
              <span className="account__event-message">{evt.message}</span>
            </div>
          ))}
        </div>
      )}

      {user ? (
        <>
          <ActiveAccountCard user={user} planLabel={planLabel} />

          <WorkspaceList
            activeContext={activeContext}
            teams={teams}
            isAnyLoading={isAnyLoading}
            workspaceSwitchingId={workspaceSwitchingId}
            onSwitchWorkspace={handleSwitchWorkspace}
          />

          <SavedAccountList
            accounts={otherAccounts}
            switchingUid={switchingUid}
            removingUid={removingUid}
            isAnyLoading={isAnyLoading}
            onSwitchAccount={handleSwitchAccount}
            onRemoveAccount={handleRemoveAccount}
          />

          {atAccountLimit && (
            <p className="account__note" style={{ marginTop: 'var(--ds-space-3)' }}>
              You can save up to {MAX_SAVED_ACCOUNTS} accounts on this device. Remove one to add another.
            </p>
          )}
        </>
      ) : (
        <>
          <AccountSignInPanel
            busy={isAnyLoading}
            signingIn={addingAccount}
            onGoogle={() => void handleAddAccount()}
            onMagicLink={sendMagicLink}
          />

          <SavedAccountList
            accounts={otherAccounts}
            switchingUid={switchingUid}
            removingUid={removingUid}
            isAnyLoading={isAnyLoading}
            onSwitchAccount={handleSwitchAccount}
            onRemoveAccount={handleRemoveAccount}
          />
        </>
      )}
    </DsModal>
  );
}
