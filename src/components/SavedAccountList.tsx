import React from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { timeAgo } from '../lib/timeAgo';
import { AccountAvatar } from './AccountAvatar';
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
    <section className="account__section">
      <div className="account__section-header">
        <h3 className="account__section-title">Other accounts</h3>
        <span className="account__section-meta">
          {accounts.length} saved
        </span>
      </div>

      <ul className="account__list">
        {accounts.map((acc, idx) => {
          const isSwitching = switchingUid === acc.uid;
          const isRemoving = removingUid === acc.uid;

          return (
            <li key={acc.uid} className="account__list-item account__list-item--split">
              <button
                type="button"
                className="account__row"
                disabled={isAnyLoading}
                onClick={() => onSwitchAccount(acc.uid)}
              >
                <AccountAvatar name={acc.displayName} photoURL={acc.photoURL} size="sm" />
                <span className="account__row-text">
                  <span className="account__row-title">
                    <span>{acc.displayName}</span>
                    {idx < 9 && <kbd className="account__kbd">{idx + 1}</kbd>}
                  </span>
                  <span className="account__row-subtitle">
                    {acc.email}
                    {acc.lastUsed && ` · ${timeAgo(acc.lastUsed)}`}
                  </span>
                </span>
                <span className="account__row-trailing">
                  {isSwitching ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Opening…
                    </>
                  ) : (
                    'Open'
                  )}
                </span>
              </button>

              <button
                type="button"
                className="account__row-action"
                disabled={isAnyLoading}
                onClick={() => onRemoveAccount(acc.uid)}
                aria-label={`Remove ${acc.displayName} from this device`}
                title="Remove from this device"
              >
                {isRemoving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
