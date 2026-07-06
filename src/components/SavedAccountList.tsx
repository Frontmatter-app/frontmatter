import React from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { timeAgo } from '../lib/timeAgo';
import { SavedAccount } from '../auth/authStorage';

interface SavedAccountListProps {
  accounts: SavedAccount[];
  switchingUid: string | null;
  removingUid: string | null;
  isAnyLoading: boolean;
  onSwitchAccount: (uid: string) => void;
  onRemoveAccount: (uid: string) => void;
}

export function SavedAccountList({ accounts, switchingUid, removingUid, isAnyLoading, onSwitchAccount, onRemoveAccount }: SavedAccountListProps) {
  if (accounts.length === 0) return null;

  return (
    <div className="mb-4 pt-3" style={{ borderTop: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)' }}>
      <div className="text-[9px] font-bold uppercase tracking-widest mb-2 px-1 flex items-center justify-between" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
        <span>Other Accounts</span>
        <span className="text-[8px] font-normal normal-case tracking-normal" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 30%, transparent)' }}>
          {accounts.length} saved
        </span>
      </div>
      <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1" role="listbox">
        {accounts.map((acc, idx) => {
          const isSwitching = switchingUid === acc.uid;
          const isRemoving = removingUid === acc.uid;
          return (
            <div
              key={acc.uid} role="option" aria-selected={false}
              className={`group flex items-center justify-between p-2 rounded-xl border border-transparent transition-all duration-200 cursor-pointer ${isAnyLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => !isAnyLoading && onSwitchAccount(acc.uid)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #fff) 3%, transparent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {acc.photoURL ? (
                  <img src={acc.photoURL} alt={acc.displayName} className="w-7 h-7 rounded-full object-cover" style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)' }} />
                ) : (
                  <div className="w-7 h-7 rounded-full border font-semibold flex items-center justify-center text-[10px]" style={{ background: 'var(--editor-bg-color, #0d1117)', borderColor: 'color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)', color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 60%, transparent)' }}>
                    {acc.displayName?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 text-left flex-1">
                  <div className="text-xs font-medium truncate flex items-center gap-1.5" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 80%, transparent)' }}>
                    <span className="truncate">{acc.displayName}</span>
                    {idx < 9 && (
                      <kbd className="px-1 py-0.5 rounded text-[8px] font-mono opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--editor-secondary-bg, #161b22)', color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }}>
                        {idx + 1}
                      </kbd>
                    )}
                  </div>
                  <div className="text-[10px] truncate flex items-center gap-1.5" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
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
                {isSwitching ? (
                  <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 50%, transparent)' }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Opening…</span>
                  </div>
                ) : isRemoving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#f87171' }} />
                ) : (
                  <>
                    <span className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0" style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}>
                      Open
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveAccount(acc.uid); }}
                      className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 40%, transparent)'; e.currentTarget.style.background = 'transparent'; }}
                      title="Remove saved account" aria-label={`Remove ${acc.displayName}`}
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
  );
}
