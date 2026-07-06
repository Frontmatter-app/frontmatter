import { useState, useCallback, useRef } from 'react';
import { signInWithCustomToken, signInWithPopup, signOut as fbSignOut, GoogleAuthProvider, sendSignInLinkToEmail } from 'firebase/auth';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { auth } from './firebase';
import { isTauri } from '../lib/env';
import { showPromptDialog } from '../lib/tauriDialog';
import { mapFirebaseUser, setCachedToken, getCachedToken, removeCachedToken, addOrUpdateSavedAccount, getSavedAccounts, removeSavedAccountFromStorage, clearAllAccounts, SavedAccount } from './authStorage';
import type { User } from '../types';
import { useAuthInit } from './useAuthInit';

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

  const addAuthEvent = useCallback((event: AuthEvent) => {
    setAuthEvents(prev => [...prev, event]);
    setTimeout(() => setAuthEvents(prev => prev.filter(e => e !== event)), 5000);
  }, []);

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
      } catch (err) { console.error('Google Sign In Error:', err); throw err; }
      finally { setAuthStateSafe('ready'); }
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
    } catch (e: any) {
      const code = e?.code;
      if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
        const fallbackName = prompt('Enter your name to simulate Google Sign-in:');
        if (fallbackName) saveMockUser({
          id: 'mock-google-' + Date.now(), display_name: fallbackName,
          email: fallbackName.toLowerCase().replace(/\s+/g, '') + '@gmail.com',
          created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
        });
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        console.error('Google Sign In Error:', e);
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
    } catch {
      addAuthEvent({ type: 'info', message: `[Dev Mode] Magic link simulated for ${email}. Auto-signing in...` });
      setTimeout(() => {
        saveMockUser({
          id: 'mock-magic-' + Date.now(), display_name: email.split('@')[0], email,
          created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
        });
        addAuthEvent({ type: 'info', message: `Signed in as ${email.split('@')[0]}` });
      }, 1000);
    }
  }, [saveMockUser, addAuthEvent]);
  const logout = useCallback(async () => {
    setAuthStateSafe('signingOut');
    const currentUid = user?.id;
    localStorage.removeItem('marktype_active_mock_id');
    try { await fbSignOut(auth); } catch (e) { console.error('Sign Out Error:', e); }
    if (currentUid) removeCachedToken(currentUid);
    setUser(null);
    setAuthStateSafe('ready');
  }, [user?.id]);

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
          addAuthEvent({ type: 'error', message: 'Re-authentication failed or was cancelled.' });
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
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
        addAuthEvent({ type: 'error', message: 'Failed to switch account. Please try again.' });
      }
      const target = getSavedAccounts().find(a => a.uid === uid);
      if (target) saveMockUser({
        id: target.uid, display_name: target.displayName,
        email: target.email, avatar_url: target.photoURL || undefined,
        created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
      });
    } finally { if (authStateRef.current === 'switchingAccount') setAuthStateSafe('ready'); }
  }, [getCustomTokenViaGoogle, saveMockUser, addAuthEvent]);

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
    } catch (e) { console.error('Sign out all error:', e); }
    finally { setAuthStateSafe('ready'); }
  }, []);

  const loading = authState !== 'ready';

  return {
    user, loading, authState, savedAccounts, authEvents,
    clearAuthEvents, signInWithGoogle, sendMagicLink, logout,
    switchAccount, logoutAll, removeSavedAccount,
  };
}
