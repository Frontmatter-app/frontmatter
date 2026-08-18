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
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getServerUrl, setServerUrl } from '../api/serverUrl';
import { beginForgeSignIn } from '../api/forgeSignIn';
import { invoke } from '../filesystem/tauriCommands';
import { DsButton } from '../design/components';
import './accountSignIn.css';

type Mode = 'signIn' | 'signUp';

const LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
};

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

  const forgeProviders = capabilities?.forgeProviders ?? [];
  const [forgeBusy, setForgeBusy] = useState<string | null>(null);
  const [forgeUrl, setForgeUrl] = useState<string | null>(null);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const forgeAbort = useRef<AbortController | null>(null);

  // Abandoned rather than left running: the poll would otherwise carry on
  // against a server the user has since pointed away from.
  useEffect(() => () => forgeAbort.current?.abort(), []);

  const startForgeSignIn = async (provider: string) => {
    forgeAbort.current?.abort();
    const controller = new AbortController();
    forgeAbort.current = controller;

    setForgeBusy(provider);
    setForgeError(null);
    setForgeUrl(null);

    try {
      const { authorizeUrl, session } = await beginForgeSignIn(provider, {
        signal: controller.signal,
        // The system browser, not a webview: somebody is about to type their
        // git provider credentials and should be able to see the address bar.
        openBrowser: (url) => invoke('open_browser_url', { url }).then(() => undefined),
      });
      setForgeUrl(authorizeUrl);
      await session;
      // `establish` has already stored the session; the provider tree reacts.
    } catch (error) {
      if (controller.signal.aborted) return;
      setForgeError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      if (!controller.signal.aborted) {
        setForgeBusy(null);
        setForgeUrl(null);
      }
    }
  };

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

      {/* Offered first, and only when the server can actually do it. One
          identity for the repository, the room and the commit trailer, with no
          password to invent for an account that exists to mirror one somebody
          already has. */}
      {forgeProviders.length > 0 && (
        <div className="signin-panel__forge">
          {forgeProviders.map((provider) => (
            <DsButton
              key={provider}
              variant="primary"
              disabled={busy || forgeBusy !== null}
              onClick={() => void startForgeSignIn(provider)}
            >
              {forgeBusy === provider ? 'Waiting for your browser…' : `Continue with ${LABELS[provider] ?? provider}`}
            </DsButton>
          ))}

          {forgeUrl && (
            <p className="signin-panel__hint">
              Your browser should have opened.{' '}
              <a href={forgeUrl} target="_blank" rel="noreferrer">
                Open it by hand
              </a>{' '}
              if it did not.
            </p>
          )}
          {forgeError && <p className="signin-panel__error">{forgeError}</p>}

          <p className="signin-panel__divider">or use an email address</p>
        </div>
      )}

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
