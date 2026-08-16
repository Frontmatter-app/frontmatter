/**
 * The account panel in Settings.
 *
 * Multi-account switching is gone with Firebase. It cached a custom token per
 * account in `localStorage` and passed tokens through window query strings to
 * open a second window — a design worth losing rather than porting. One signed-
 * in account per install; a second account means a second server session.
 */
import React from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { AccountSignInPanel } from '../../../components/AccountSignInPanel';
import { getServerUrl } from '../../../api/serverUrl';

export function AccountsSection() {
  const { user, logout, authEvents, clearAuthEvents } = useAuth();
  const server = getServerUrl();

  return (
    <div className="settings-section">
      <h2>Account</h2>

      {authEvents.length > 0 && (
        <div className="settings-section__events">
          {authEvents.map((event, index) => (
            <p key={index} className={`settings-section__event settings-section__event--${event.type}`}>
              {event.message}
            </p>
          ))}
          <button type="button" onClick={clearAuthEvents}>
            Dismiss
          </button>
        </div>
      )}

      {user ? (
        <>
          <dl className="settings-section__details">
            <dt>Signed in as</dt>
            <dd>{user.display_name || user.email}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Server</dt>
            <dd>{server ?? 'None'}</dd>
          </dl>
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        <AccountSignInPanel />
      )}

      <p className="settings-section__hint">
        An account is only needed for real-time collaboration. Writing, git, and publishing work
        without one.
      </p>
    </div>
  );
}
