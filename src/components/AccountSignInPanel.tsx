/**
 * Sign in, sign up, or connect to a server.
 *
 * Replaces a panel offering Google sign-in and magic links against Firebase.
 * Both are gone: accounts now live on whichever collaboration server the user
 * points the app at, which for most people is one they run themselves.
 *
 * The panel handles the case the old one could not — **no server configured** —
 * because that is now a normal state rather than a misconfiguration. Everything
 * except collaboration works without an account.
 */
import React, { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getServerUrl, setServerUrl } from '../api/serverUrl';

type Mode = 'signIn' | 'signUp';

export function AccountSignInPanel() {
  const { signIn, signUp, requestPasswordReset, authState, capabilities } = useAuth();

  const [serverInput, setServerInput] = useState(() => getServerUrl() ?? '');
  const [server, setServer] = useState(() => getServerUrl());
  const [serverError, setServerError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const busy = authState === 'signingIn';

  const saveServer = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setServerUrl(serverInput);
      setServer(getServerUrl());
      setServerError(null);
      // The capability probe runs on mount; reload so the form reflects the
      // server that was just configured.
      window.location.reload();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'That URL did not look right.');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (mode === 'signIn') await signIn(email, password);
      else await signUp(email, password, displayName || undefined);
    } catch {
      // useAuthState surfaces the message through authEvents.
    }
  };

  if (!server) {
    return (
      <form className="signin-panel" onSubmit={saveServer}>
        <h2>Connect to a server</h2>
        <p className="signin-panel__hint">
          Frontmatter works fully offline — writing, git, and publishing need no account. A server
          is only needed for real-time collaboration. You can run your own with{' '}
          <code>docker compose up</code>.
        </p>
        <label htmlFor="server-url">Server URL</label>
        <input
          id="server-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="http://localhost:8000"
          value={serverInput}
          onChange={(event) => setServerInput(event.target.value)}
        />
        {serverError && <p className="signin-panel__error">{serverError}</p>}
        <button type="submit" disabled={!serverInput.trim()}>
          Connect
        </button>
      </form>
    );
  }

  const registrationOpen = capabilities?.allowRegistration ?? true;

  return (
    <form className="signin-panel" onSubmit={submit}>
      <h2>{mode === 'signIn' ? 'Sign in' : 'Create an account'}</h2>
      <p className="signin-panel__server">
        {server}{' '}
        <button
          type="button"
          className="signin-panel__link"
          onClick={() => {
            setServerUrl(null);
            setServer(null);
            setServerInput('');
          }}
        >
          Change
        </button>
      </p>

      {mode === 'signUp' && (
        <>
          <label htmlFor="signin-name">Name</label>
          <input
            id="signin-name"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </>
      )}

      <label htmlFor="signin-email">Email</label>
      <input
        id="signin-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="signin-password">Password</label>
      <input
        id="signin-password"
        type="password"
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        required
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <button type="submit" disabled={busy || !email || !password}>
        {busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
      </button>

      <div className="signin-panel__actions">
        {registrationOpen && (
          <button
            type="button"
            className="signin-panel__link"
            onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
          >
            {mode === 'signIn' ? 'Create an account' : 'I already have an account'}
          </button>
        )}
        {mode === 'signIn' && (
          <button
            type="button"
            className="signin-panel__link"
            disabled={!email}
            onClick={() => void requestPasswordReset(email)}
          >
            Forgot password
          </button>
        )}
      </div>
    </form>
  );
}
