import React from 'react';
import { Plus, LogOut, Loader2 } from 'lucide-react';

interface AccountFooterActionsProps {
  user: { id: string } | null;
  savedAccountsCount: number;
  isAnyLoading: boolean;
  addingAccount: boolean;
  signingOut: boolean;
  signingOutAll: boolean;
  onAddAccount: () => void;
  onSignOut: () => void;
  onSignOutAll: () => void;
}

export function AccountFooterActions({ user, savedAccountsCount, isAnyLoading, addingAccount, signingOut, signingOutAll, onAddAccount, onSignOut, onSignOutAll }: AccountFooterActionsProps) {
  return (
    <div className="flex flex-col gap-2 pt-3 mt-auto" style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}>
      <div className="flex gap-2">
        <button
          onClick={onAddAccount} disabled={isAnyLoading}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)', background: 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)', color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 85%, transparent)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)'; }}
        >
          {addingAccount ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing in…</> : <><Plus className="w-3.5 h-3.5" /> Add Account</>}
        </button>

        {user && (
          <button
            onClick={onSignOut} disabled={isAnyLoading}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)', color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 75%, transparent)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 5%, transparent)'; }}
          >
            {signingOut ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing out…</> : <><LogOut className="w-3.5 h-3.5" /> Sign Out</>}
          </button>
        )}
      </div>

      {savedAccountsCount > 1 && (
        <button
          onClick={onSignOutAll} disabled={isAnyLoading}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-xl transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
        >
          {signingOutAll ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing out all…</> : <><LogOut className="w-3.5 h-3.5" /> Sign Out All Accounts</>}
        </button>
      )}
    </div>
  );
}
