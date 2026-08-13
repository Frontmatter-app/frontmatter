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

export type AuthState = 'initializing' | 'ready' | 'switchingAccount' | 'signingOut';

export interface AuthEvent {
  type: 'error' | 'info';
  message: string;
}

/**
 * Mock accounts exist so the app can be exercised without a Firebase project.
 * They are opt-in: previously any sign-in failure fell through to creating one,
 * so a network error or a rejected address silently produced a fake local
 * session that looked signed in but could never sync.
 */
const MOCK_AUTH_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_MOCK_AUTH === 'true';

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
    localStorage.setItem('marktype_active_mock_id', mockUser.id);
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

  useAuthInit({ setUser, setSavedAccounts, setAuthState: setAuthStateSafe, addAuthEvent, authStateRef });

  const getCustomTokenViaGoogle = useCallback(async (): Promise<string> => {
    if (!isTauri) throw new Error('This action is only supported inside the desktop app.');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const port = await invoke<number>('start_google_auth', { state });
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authentication timed out.')), 300000);
      let unlisten: (() => void) | null = null;
      listen<{ code: string; state: string }>('auth-google-callback', async (event) => {
        clearTimeout(timeout);
        if (event.payload.state !== state) { reject(new Error('Security verification failed.')); return; }
        if (unlisten) unlisten();
        try {
          const redirectUri = `http://127.0.0.1:${port}/callback`;
          const backendUrl = import.meta.env.VITE_MODAL_BASE_URL || 'https://iamspruce--marktype-backend-fastapi-app.modal.run';
          const res = await fetch(`${backendUrl}/exchange-google-code`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: event.payload.code, redirectUri }),
          });
          if (!res.ok) throw new Error('Failed to exchange code');
          const payload = await res.json() as { customToken: string; uid: string; displayName: string | null; email: string | null; photoURL: string | null };
          resolve(payload.customToken);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Sign-in failed.'));
        }
      }).then(fn => { unlisten = fn; }).catch(err => { clearTimeout(timeout); reject(err); });
      invoke('open_browser_url', {
        url: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          response_type: 'code', scope: 'openid email profile', state,
          access_type: 'online', prompt: 'select_account',
        }).toString()}`,
      }).catch(err => { clearTimeout(timeout); reject(err); });
    });
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setAuthStateSafe('switchingAccount');
    if (isTauri) {
      try {
        const customToken = await getCustomTokenViaGoogle();
        const result = await signInWithCustomToken(auth, customToken);
        setCachedToken(result.user.uid, customToken);
        localStorage.removeItem('marktype_active_mock_id');
        const mapped = mapFirebaseUser(result.user);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
        addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
      } catch (err) {
        reportAuthError(err, 'google sign-in');
        throw err;
      } finally { setAuthStateSafe('ready'); }
      return;
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email'); provider.addScope('profile');
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        localStorage.removeItem('marktype_active_mock_id');
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
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: window.location.href.replace(window.location.search, ''),
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', email);
      addAuthEvent({ type: 'info', message: `Magic sign-in link sent to ${email}. Check your inbox!` });
    } catch (e) {
      const failure = reportAuthError(e, 'magic link');
      // Only a build explicitly configured for mock auth may simulate success.
      if (failure.kind === 'not-configured' && MOCK_AUTH_ENABLED) {
        addAuthEvent({ type: 'info', message: `Mock sign-in as ${email}.` });
        saveMockUser({
          id: 'mock-magic-' + Date.now(), display_name: email.split('@')[0], email,
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
    localStorage.removeItem('marktype_active_mock_id');
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
        localStorage.removeItem('marktype_active_mock_id');
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
        localStorage.removeItem('marktype_active_mock_id');
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
    localStorage.removeItem('marktype_active_mock_id');
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
