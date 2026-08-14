import { useState, useCallback, useEffect, useRef } from 'react';
import { signInWithCustomToken, signInWithPopup, signOut as fbSignOut, GoogleAuthProvider, sendSignInLinkToEmail } from 'firebase/auth';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { auth } from './firebase';
import { isTauri } from '../lib/env';
import { showPromptDialog } from '../lib/tauriDialog';
import { mapFirebaseUser, setCachedToken, getCachedToken, removeCachedToken, addOrUpdateSavedAccount, getSavedAccounts, removeSavedAccountFromStorage, clearAllAccounts, SavedAccount } from './authStorage';
import type { User } from '../types';
import { useAuthInit } from './useAuthInit';
import { classifyAuthError, isCancellation } from './authErrors';
import { MOCK_AUTH_ENABLED, ACTIVE_MOCK_KEY } from './mockAuth';
import { magicLinkContinueUrl, isProbablyEmail } from './magicLink';

export type AuthState = 'initializing' | 'ready' | 'switchingAccount' | 'signingOut';

export interface AuthEvent {
  type: 'error' | 'info';
  message: string;
}

export function useAuthState() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('initializing');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEvent[]>([]);
  const authStateRef = useRef<AuthState>('initializing');

  const setAuthStateSafe = useCallback((s: AuthState) => {
    authStateRef.current = s;
    setAuthState(s);
  }, []);

  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const addAuthEvent = useCallback((event: AuthEvent) => {
    setAuthEvents(prev => [...prev, event]);
    // Errors stay until dismissed; informational notices fade.
    if (event.type === 'error') return;
    const timer = setTimeout(() => setAuthEvents(prev => prev.filter(e => e !== event)), 5000);
    dismissTimers.current.push(timer);
  }, []);

  useEffect(() => () => {
    dismissTimers.current.forEach(clearTimeout);
    dismissTimers.current = [];
  }, []);

  /** Reports a failure to the user unless they simply cancelled. */
  const reportAuthError = useCallback((error: unknown, context: string) => {
    const failure = classifyAuthError(error);
    if (failure.kind === 'cancelled') return failure;
    console.error(`[auth] ${context}`, failure.code ?? '', error);
    addAuthEvent({ type: 'error', message: failure.message });
    return failure;
  }, [addAuthEvent]);

  const clearAuthEvents = useCallback(() => setAuthEvents([]), []);

  const saveMockUser = useCallback((mockUser: User) => {
    localStorage.setItem(ACTIVE_MOCK_KEY, mockUser.id);
    setUser(mockUser);
    let list = getSavedAccounts();
    const filtered = list.filter(a => a.uid !== mockUser.id);
    filtered.push({
      uid: mockUser.id,
      email: mockUser.email || '',
      displayName: mockUser.display_name || 'User',
      photoURL: mockUser.avatar_url || null,
      lastUsed: new Date().toISOString(),
    });
    localStorage.setItem('marktype_saved_accounts', JSON.stringify(filtered));
    setSavedAccounts(filtered);
  }, []);

  /**
   * Runs the desktop OAuth round trip and returns a Firebase custom token.
   *
   * The listener is registered *before* the browser opens and torn down on
   * every exit path. Previously it was registered concurrently with the browser
   * launch and only unlistened on the success path, so a cancelled or timed-out
   * attempt left a live listener behind; the next attempt's callback was then
   * delivered to both, and the stale one raced the live one to redeem a
   * single-use authorisation code.
   */
  const getCustomTokenViaGoogle = useCallback(async (): Promise<string> => {
    if (!isTauri) throw new Error('This action is only supported inside the desktop app.');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const port = await invoke<number>('start_google_auth', { state });

    let unlisten: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await new Promise<string>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Authentication timed out.')), 300000);

        listen<{ code: string; state: string }>('auth-google-callback', async (event) => {
          // A callback carrying someone else's state is not ours to answer.
          if (event.payload.state !== state) return;
          try {
            const redirectUri = `http://127.0.0.1:${port}/callback`;
            const backendUrl = import.meta.env.VITE_MODAL_BASE_URL || 'https://iamspruce--marktype-backend-fastapi-app.modal.run';
            const res = await fetch(`${backendUrl}/exchange-google-code`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: event.payload.code, redirectUri }),
            });
            if (!res.ok) throw new Error('Could not complete sign-in with Google. Please try again.');
            const payload = await res.json() as { customToken: string };
            if (!payload?.customToken) throw new Error('Sign-in service returned no session.');
            resolve(payload.customToken);
          } catch (err) {
            reject(err instanceof Error ? err : new Error('Sign-in failed.'));
          }
        })
          .then(fn => {
            unlisten = fn;
            // Only now is it safe to send the user to Google: an emit that
            // arrives before this point is dropped.
            return invoke('open_browser_url', {
              url: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
                client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
                redirect_uri: `http://127.0.0.1:${port}/callback`,
                response_type: 'code', scope: 'openid email profile', state,
                access_type: 'online', prompt: 'select_account',
              }).toString()}`,
            });
          })
          .catch(reject);
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      unlisten?.();
    }
  }, []);

  useAuthInit({
    setUser, setSavedAccounts, setAuthState: setAuthStateSafe,
    addAuthEvent, authStateRef, getCustomTokenViaGoogle,
  });

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setAuthStateSafe('switchingAccount');
    if (isTauri) {
      try {
        const customToken = await getCustomTokenViaGoogle();
        const result = await signInWithCustomToken(auth, customToken);
        setCachedToken(result.user.uid, customToken);
        localStorage.removeItem(ACTIVE_MOCK_KEY);
        const mapped = mapFirebaseUser(result.user);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
        addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
      } catch (err) {
        const failure = reportAuthError(err, 'google sign-in');
        // Backing out of the browser prompt is not an error to raise at the
        // caller, which would show it in an alert dialog.
        if (failure.kind !== 'cancelled') throw err;
      } finally { setAuthStateSafe('ready'); }
      return;
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email'); provider.addScope('profile');
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        localStorage.removeItem(ACTIVE_MOCK_KEY);
        const mapped = mapFirebaseUser(result.user);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
        addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
      }
    } catch (e) {
      const failure = reportAuthError(e, 'google sign-in');
      if (failure.kind === 'not-configured' && MOCK_AUTH_ENABLED) {
        const name = await showPromptDialog('Mock sign-in', 'Enter a display name:');
        if (name) saveMockUser({
          id: 'mock-google-' + Date.now(), display_name: name,
          email: name.toLowerCase().replace(/\s+/g, '') + '@example.test',
          created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
        });
      }
    } finally { if (authStateRef.current === 'switchingAccount') setAuthStateSafe('ready'); }
  }, [getCustomTokenViaGoogle, saveMockUser]);

  const sendMagicLink = useCallback(async (email: string) => {
    const address = email.trim();
    if (!isProbablyEmail(address)) {
      const message = 'Enter a valid email address.';
      addAuthEvent({ type: 'error', message });
      throw new Error(message);
    }

    const continueUrl = magicLinkContinueUrl();
    if (!continueUrl) {
      // Better to say this than to send a link whose landing page the desktop
      // build cannot be reached at.
      const message = 'Email sign-in is not available in the desktop app. Continue with Google instead.';
      addAuthEvent({ type: 'error', message });
      throw new Error(message);
    }

    try {
      await sendSignInLinkToEmail(auth, address, {
        url: continueUrl,
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', address);
      addAuthEvent({ type: 'info', message: `Sign-in link sent to ${address}. Check your inbox.` });
    } catch (e) {
      const failure = reportAuthError(e, 'magic link');
      // Only a build explicitly configured for mock auth may simulate success.
      if (failure.kind === 'not-configured' && MOCK_AUTH_ENABLED) {
        addAuthEvent({ type: 'info', message: `Mock sign-in as ${address}.` });
        saveMockUser({
          id: 'mock-magic-' + Date.now(), display_name: address.split('@')[0], email: address,
          created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
        });
        return;
      }
      throw e;
    }
  }, [saveMockUser, addAuthEvent, reportAuthError]);
  const logout = useCallback(async () => {
    setAuthStateSafe('signingOut');
    const currentUid = user?.id;
    localStorage.removeItem(ACTIVE_MOCK_KEY);
    try {
      await fbSignOut(auth);
    } catch (e) {
      // The local session is cleared regardless: leaving a user apparently
      // signed in after they asked to leave is worse than a stale server token.
      console.error('[auth] sign-out', e);
      addAuthEvent({ type: 'info', message: 'Signed out locally; the server session may persist.' });
    } finally {
      if (currentUid) removeCachedToken(currentUid);
      setUser(null);
      setAuthStateSafe('ready');
    }
  }, [user?.id, addAuthEvent]);

  const switchAccount = useCallback(async (uid: string) => {
    let cachedToken = getCachedToken(uid);
    if (cachedToken && !isTauri) {
      setAuthStateSafe('switchingAccount');
      try {
        const result = await signInWithCustomToken(auth, cachedToken);
        const mapped = mapFirebaseUser(result.user);
        localStorage.removeItem(ACTIVE_MOCK_KEY);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
        addAuthEvent({ type: 'info', message: `Switched to ${mapped.display_name}` });
        setAuthStateSafe('ready');
        return;
      } catch {
        removeCachedToken(uid);
        cachedToken = null;
      }
    }
    if (isTauri) {
      if (!cachedToken) {
        setAuthStateSafe('switchingAccount');
        addAuthEvent({ type: 'info', message: 'Please re-authenticate in the browser popup...' });
        try { cachedToken = await getCustomTokenViaGoogle(); setCachedToken(uid, cachedToken); }
        catch (err) {
          if (!isCancellation(err)) reportAuthError(err, 're-authentication');
          setAuthStateSafe('ready'); throw err;
        }
      }
      try {
        await invoke('open_account_window', {
          accountUid: uid, accountToken: cachedToken,
          workspaceContextJson: JSON.stringify({ type: 'personal' }),
          savedAccountsJson: JSON.stringify(getSavedAccounts()),
        });
      } catch (e) {
        console.error('[auth] Failed to open account window:', e);
        addAuthEvent({ type: 'error', message: 'Failed to open new window for account.' });
      } finally { setAuthStateSafe('ready'); }
      return;
    }
    setAuthStateSafe('switchingAccount');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        localStorage.removeItem(ACTIVE_MOCK_KEY);
        const mapped = mapFirebaseUser(result.user);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
        addAuthEvent({ type: 'info', message: `Switched to ${mapped.display_name}` });
      }
    } catch (e) {
      const failure = reportAuthError(e, 'switch account');
      if (failure.kind === 'not-configured' && MOCK_AUTH_ENABLED) {
        const target = getSavedAccounts().find(a => a.uid === uid);
        if (target) saveMockUser({
          id: target.uid, display_name: target.displayName,
          email: target.email, avatar_url: target.photoURL || undefined,
          created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
        });
      }
    } finally { if (authStateRef.current === 'switchingAccount') setAuthStateSafe('ready'); }
  }, [getCustomTokenViaGoogle, saveMockUser, addAuthEvent, reportAuthError]);

  const removeSavedAccount = useCallback(async (uid: string) => {
    const updated = removeSavedAccountFromStorage(uid);
    setSavedAccounts(updated);
    if (user?.id === uid) await logout();
  }, [user?.id, logout]);

  const logoutAll = useCallback(async () => {
    setAuthStateSafe('signingOut');
    localStorage.removeItem(ACTIVE_MOCK_KEY);
    try {
      await fbSignOut(auth);
      clearAllAccounts();
      setSavedAccounts([]);
      setUser(null);
    } catch (e) {
      console.error('[auth] sign-out all', e);
    } finally {
      // Local state is cleared even when the network call fails.
      clearAllAccounts();
      setSavedAccounts([]);
      setUser(null);
      setAuthStateSafe('ready');
    }
  }, []);

  const loading = authState !== 'ready';

  return {
    user, loading, authState, savedAccounts, authEvents,
    clearAuthEvents, signInWithGoogle, sendMagicLink, logout,
    switchAccount, logoutAll, removeSavedAccount,
  };
}
