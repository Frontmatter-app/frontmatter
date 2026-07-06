import React, { useState } from 'react';
import { User, Check, Plus, Trash2, Loader2, LogOut, Layout, Users } from 'lucide-react';
import { useAuth } from '../../../auth/AuthProvider';
import { usePlan } from '../../../billing/PlanProvider';
import { useTeamNames } from '../../../hooks/useTeamNames';
import { showConfirmDialog, showAlertDialog } from '../../../lib/tauriDialog';

export function AccountsSection() {
  const { user, logout, signInWithGoogle, sendMagicLink, savedAccounts, switchAccount, logoutAll, removeSavedAccount } = useAuth();
  const { activeContext, switchWorkspace, isSettingsOpen } = usePlan();
  const teams = useTeamNames(usePlan().teamMemberships, isSettingsOpen);

  const [magicEmail, setMagicEmail] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSigningOutAll, setIsSigningOutAll] = useState(false);
  const [workspaceSwitchingId, setWorkspaceSwitchingId] = useState<string | null>(null);
  const [accountActionUid, setAccountActionUid] = useState<string | null>(null);
  const [accountActionType, setAccountActionType] = useState<'switch' | 'remove' | null>(null);

  const anyActionInFlight = isSigningOut || isSigningOutAll || !!accountActionUid || !!workspaceSwitchingId;

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <User className="w-5 h-5 text-blue-500" /> Manage Accounts
      </h3>

      <div className="mb-6 p-5 rounded-2xl bg-black/5 dark:bg-white/2 border border-black/5 dark:border-white/5 flex flex-col md:flex-row items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.display_name} className="w-10 h-10 rounded-full object-cover border border-black/10 dark:border-white/10" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500/20 to-purple-500/20 flex items-center justify-center font-bold text-sm">
              {user?.display_name?.charAt(0).toUpperCase() || '✦'}
            </div>
          )}
          <div>
            <span className="font-semibold text-xs text-gray-400 block">Logged In As</span>
            <span className="font-bold text-sm block">{user ? user.display_name : 'Guest Account'}</span>
            <span className="text-[11px] opacity-55 block">{user ? user.email : 'Local documents only — sign in to sync'}</span>
          </div>
        </div>
        {user ? (
          <button
            onClick={async () => {
              if (!(await showConfirmDialog('Sign Out', 'Are you sure you want to sign out?'))) return;
              setIsSigningOut(true);
              try { await logout(); } catch (err) { await showAlertDialog('Sign Out Error', err instanceof Error ? err.message : 'Failed to sign out.'); } finally { setIsSigningOut(false); }
            }}
            disabled={anyActionInFlight}
            className="flex items-center gap-1.5 py-1.5 px-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 hover:text-red-600 rounded-xl font-bold text-xs transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSigningOut ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing out…</> : 'Sign Out'}
          </button>
        ) : (
          <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
            <button onClick={signInWithGoogle} className="py-1.5 px-4 bg-white text-gray-900 border border-gray-200 shadow-sm hover:bg-gray-50 rounded-xl font-bold text-xs transition cursor-pointer active:scale-95 text-center">
              Sign In with Google
            </button>
            <form onSubmit={(e) => { e.preventDefault(); if (!magicEmail.trim()) return; sendMagicLink(magicEmail.trim()); setMagicEmail(''); }} className="flex gap-1.5">
              <input type="email" placeholder="Magic link email" value={magicEmail} onChange={(e) => setMagicEmail(e.target.value)} className="px-3 py-1.5 text-xs bg-[var(--editor-bg-color)] border border-black/10 dark:border-white/10 rounded-xl outline-none" />
              <button type="submit" className="px-3 py-1.5 bg-blue-500 text-white rounded-xl text-xs font-semibold cursor-pointer hover:bg-blue-600 active:scale-95">Send</button>
            </form>
          </div>
        )}
      </div>

      {user && (
        <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5 mb-6">
          <span className="text-xs font-bold text-gray-400 block mb-3">Active Account Workspaces</span>
          <div className="flex flex-col gap-2.5">
            <WorkspaceRow
              label="Personal Workspace" desc="Private cloud docs & local folder" icon={<Layout className="w-5 h-5 flex-shrink-0" />}
              isActive={activeContext.type === 'personal'} isSwitching={workspaceSwitchingId === 'personal'} disabled={anyActionInFlight}
              onSwitch={async () => { setWorkspaceSwitchingId('personal'); try { await switchWorkspace({ type: 'personal' }); } catch { await showAlertDialog('Workspace Error', 'Failed to open personal workspace.'); } finally { setWorkspaceSwitchingId(null); } }}
            />
            {teams.map((t) => {
              const isActive = activeContext.type === 'team' && activeContext.teamId === t.id;
              return (
                <WorkspaceRow
                  key={t.id} label={`${t.name} Workspace`} desc="Shared team cloud docs & local folder" icon={<Users className="w-5 h-5 flex-shrink-0" />}
                  isActive={isActive} isSwitching={workspaceSwitchingId === t.id} disabled={anyActionInFlight}
                  onSwitch={async () => { setWorkspaceSwitchingId(t.id); try { await switchWorkspace({ type: 'team', teamId: t.id, teamName: t.name }); } catch { await showAlertDialog('Workspace Error', 'Failed to open team workspace.'); } finally { setWorkspaceSwitchingId(null); } }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="border border-black/5 dark:border-white/5 rounded-2xl p-5 mb-6">
        <span className="text-xs font-bold text-gray-400 block mb-3">Saved Accounts ({savedAccounts.length})</span>
        <div className="flex flex-col gap-2.5">
          {savedAccounts.map((acc) => {
            const isActive = user?.id === acc.uid;
            const isSwitchingThis = accountActionUid === acc.uid && accountActionType === 'switch';
            const isRemovingThis = accountActionUid === acc.uid && accountActionType === 'remove';
            return (
              <div key={acc.uid} className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${isActive ? 'bg-blue-500/5 border-blue-500/30' : 'bg-black/5 dark:bg-white/2 border-transparent hover:border-black/10 dark:hover:border-white/10'}`}>
                <div className="flex items-center gap-3">
                  {acc.photoURL ? <img src={acc.photoURL} alt={acc.displayName} className="w-8 h-8 rounded-full object-cover border border-black/10 dark:border-white/10" /> : <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500/20 to-purple-500/20 flex items-center justify-center font-bold text-xs">{acc.displayName?.charAt(0).toUpperCase() || '✦'}</div>}
                  <div>
                    <span className="font-semibold text-xs block">{acc.displayName}</span>
                    <span className="text-[10px] opacity-50 block mt-0.5">{acc.email}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isActive && (
                    <button disabled={anyActionInFlight} onClick={async () => { if (!(await showConfirmDialog('Switch Account', `Open ${acc.displayName} in a new window?`))) return; setAccountActionUid(acc.uid); setAccountActionType('switch'); try { await switchAccount(acc.uid); } catch (err) { await showAlertDialog('Account Switch Error', err instanceof Error ? err.message : 'Failed.'); } finally { setAccountActionUid(null); setAccountActionType(null); } }}
                      className="flex items-center gap-1.5 py-1 px-3 bg-black/10 dark:bg-white/10 rounded-lg text-[10px] font-bold cursor-pointer hover:bg-black/20 dark:hover:bg-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      {isSwitchingThis ? <><Loader2 className="w-3 h-3 animate-spin" /> Opening…</> : 'Open'}
                    </button>
                  )}
                  {isActive && <span className="text-[10px] text-blue-500 font-bold bg-blue-500/10 px-2 py-0.5 rounded-md flex items-center gap-1"><Check className="w-3 h-3" /> Active</span>}
                  <button disabled={anyActionInFlight} onClick={async () => { setAccountActionUid(acc.uid); setAccountActionType('remove'); try { await removeSavedAccount(acc.uid); } catch (err) { await showAlertDialog('Remove Error', err instanceof Error ? err.message : 'Failed.'); } finally { setAccountActionUid(null); setAccountActionType(null); } }}
                    className="p-1 rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed" title="Remove saved account">
                    {isRemovingThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
          {savedAccounts.length === 0 && <p className="text-xs text-neutral-400 italic">No saved accounts. Sign in to get started.</p>}
        </div>
        <div className="mt-5 pt-4 border-t border-black/5 dark:border-white/5 flex flex-col gap-2">
          {savedAccounts.length < 3 ? (
            <button disabled={anyActionInFlight} onClick={signInWithGoogle} className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 bg-black/5 dark:bg-white/5 text-[var(--editor-text-color)] text-xs font-bold rounded-xl transition cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className="w-3.5 h-3.5" /> Add Another Account
            </button>
          ) : (
            <p className="text-[11px] text-neutral-400 text-center">You can save up to 3 accounts on this device.</p>
          )}
          {savedAccounts.length > 0 && (
            <button disabled={anyActionInFlight} onClick={async () => { if (!(await showConfirmDialog('Sign Out All', 'Sign out of all accounts? This clears all cached sessions.'))) return; setIsSigningOutAll(true); try { await logoutAll(); } catch (err) { await showAlertDialog('Sign Out All Error', err instanceof Error ? err.message : 'Failed.'); } finally { setIsSigningOutAll(false); } }}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {isSigningOutAll ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing out all…</> : <><LogOut className="w-3.5 h-3.5" /> Sign Out of All Accounts</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceRow({ label, desc, icon, isActive, isSwitching, disabled, onSwitch }: {
  key?: React.Key; label: string; desc: string; icon: React.ReactNode; isActive: boolean; isSwitching: boolean; disabled: boolean; onSwitch: () => void;
}) {
  return (
    <div onClick={disabled ? undefined : onSwitch} className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${isActive ? 'bg-blue-500/5 border-blue-500/30 text-blue-400' : 'bg-black/5 dark:bg-white/2 border-transparent hover:border-black/10 dark:hover:border-white/10 text-neutral-300'} ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-3">
        {icon}
        <div className="text-left">
          <span className="font-semibold text-xs block">{label}</span>
          <span className="text-[10px] opacity-50 block mt-0.5">{desc}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isSwitching ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
          : isActive ? <span className="text-[10px] text-blue-500 font-bold bg-blue-500/10 px-2 py-0.5 rounded-md flex items-center gap-1"><Check className="w-3 h-3" /> Active</span>
          : <span className="text-[10px] font-bold text-neutral-400 bg-neutral-500/10 px-2 py-0.5 rounded-md">Open</span>}
      </div>
    </div>
  );
}
