import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { showPromptDialog } from '../lib/tauriDialog';
import { User } from '../types';

const isTauri: boolean =
  typeof window !== 'undefined' &&
  (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ||
   typeof (window as any).__TAURI__ !== 'undefined');

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'AIzaSyFakeKeyForCompiling',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'marktype-app-demo.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'marktype-app-demo',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'marktype-app-demo.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '1:1234567890:web:1234567890',
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

function createAuth() {
  if (!isTauri) return getAuth(app);
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  } catch {
    return getAuth(app);
  }
}

export const auth      = createAuth();
export const db        = getFirestore(app);
export const functions = getFunctions(app);

export interface SavedAccount {
  uid:         string;
  email:       string;
  displayName: string;
  photoURL:    string | null;
  lastUsed:    string;
}

export type AuthState = 'initializing' | 'ready' | 'switchingAccount' | 'signingOut';

interface PendingAuthPayload {
  customToken: string;
  uid:         string;
  displayName: string | null;
  email:       string | null;
  photoURL:    string | null;
}

export interface AuthEvent {
  type: 'error' | 'info';
  message: string;
}

interface AuthContextType {
  user:             User | null;
  loading:          boolean;
  authState:        AuthState;
  savedAccounts:    SavedAccount[];
  authEvents:       AuthEvent[];
  clearAuthEvents:  () => void;
  signInWithGoogle: () => Promise<void>;
  sendMagicLink:    (email: string) => Promise<void>;
  logout:           () => Promise<void>;
  switchAccount:    (uid: string) => Promise<void>;
  logoutAll:        () => Promise<void>;
  removeSavedAccount: (uid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user:             null,
  loading:          true,
  authState:        'initializing',
  savedAccounts:    [],
  authEvents:       [],
  clearAuthEvents:  () => {},
  signInWithGoogle: async () => {},
  sendMagicLink:    async () => {},
  logout:           async () => {},
  switchAccount:    async () => {},
  logoutAll:        async () => {},
  removeSavedAccount: async () => {},
});

const TOKEN_STORAGE_KEY = 'marktype_account_tokens';

function getCachedToken(uid: string): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const tokens = JSON.parse(raw);
    return tokens[uid] || null;
  } catch { return null; }
}

function setCachedToken(uid: string, token: string) {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    const tokens = raw ? JSON.parse(raw) : {};
    tokens[uid] = token;
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {}
}

function removeCachedToken(uid: string) {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return;
    const tokens = JSON.parse(raw);
    delete tokens[uid];
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {}
}

function clearAllCachedTokens() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function mapFirebaseUser(fbUser: FirebaseUser): User {
  return {
    id:           fbUser.uid,
    display_name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
    email:        fbUser.email || undefined,
    avatar_url:   fbUser.photoURL || undefined,
    created_at:   fbUser.metadata.creationTime  || new Date().toISOString(),
    last_seen_at: fbUser.metadata.lastSignInTime || new Date().toISOString(),
    is_anonymous: false,
  };
}

function getSavedAccountsFromStorage(): SavedAccount[] {
  try {
    const raw = localStorage.getItem('marktype_saved_accounts');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAccountsToStorage(list: SavedAccount[]) {
  localStorage.setItem('marktype_saved_accounts', JSON.stringify(list));
}

function addOrUpdateSavedAccount(fbUser: FirebaseUser, mapped: User): SavedAccount[] {
  let list: SavedAccount[] = getSavedAccountsFromStorage();
  const filtered = list.filter(a => a.uid !== fbUser.uid);
  filtered.push({
    uid:         fbUser.uid,
    email:       fbUser.email || '',
    displayName: mapped.display_name || 'User',
    photoURL:    fbUser.photoURL || null,
    lastUsed:    new Date().toISOString(),
  });
  saveAccountsToStorage(filtered);
  return filtered;
}

async function ensureUserDocumentExists(fbUser: FirebaseUser) {
  try {
    const userDocRef = doc(db, 'users', fbUser.uid);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) {
      await setDoc(userDocRef, {
        email: fbUser.email,
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
        photoURL: fbUser.photoURL || null,
        plan: 'free',
        planStatus: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {
    console.error('[auth] Failed to ensure Firestore user document exists:', e);
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,          setUser]          = useState<User | null>(null);
  const [authState,     setAuthState]     = useState<AuthState>('initializing');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [authEvents,    setAuthEvents]    = useState<AuthEvent[]>([]);
  const authStateRef = useRef<AuthState>('initializing');

  const setAuthStateSafe = useCallback((s: AuthState) => {
    authStateRef.current = s;
    setAuthState(s);
  }, []);

  const addAuthEvent = useCallback((event: AuthEvent) => {
    setAuthEvents(prev => [...prev, event]);
    setTimeout(() => {
      setAuthEvents(prev => prev.filter(e => e !== event));
    }, 5000);
  }, []);

  const clearAuthEvents = useCallback(() => setAuthEvents([]), []);

  const authUnlistenRef = useRef<(() => void) | null>(null);

  const saveMockUser = (mockUser: User) => {
    localStorage.setItem('marktype_active_mock_id', mockUser.id);
    setUser(mockUser);
    let list: SavedAccount[] = getSavedAccountsFromStorage();
    const filtered = list.filter(a => a.uid !== mockUser.id);
    filtered.push({
      uid:         mockUser.id,
      email:       mockUser.email || '',
      displayName: mockUser.display_name || 'User',
      photoURL:    mockUser.avatar_url || null,
      lastUsed:    new Date().toISOString(),
    });
    saveAccountsToStorage(filtered);
    setSavedAccounts(filtered);
  };

  useEffect(() => {
    let initDone = false;

    const raw = localStorage.getItem('marktype_saved_accounts');
    let list: SavedAccount[] = [];
    try { list = raw ? JSON.parse(raw) : []; setSavedAccounts(list); } catch (_) {}

    const activeMockId = localStorage.getItem('marktype_active_mock_id');
    if (activeMockId) {
      const target = list.find(a => a.uid === activeMockId);
      if (target) {
        setUser({
          id:           target.uid,
          display_name: target.displayName,
          email:        target.email,
          avatar_url:   target.photoURL || undefined,
          created_at:   new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          is_anonymous: false,
        });
      }
    }

    // ── URL-based account auto-auth (for new windows opened via account switch) ──
    let hasCheckedUrlAuth = false;

    // ── onAuthStateChanged ─────────────────────────────────────────────────
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!hasCheckedUrlAuth) {
        hasCheckedUrlAuth = true;
        const urlParams = new URLSearchParams(window.location.search);
        const accountToken = urlParams.get('account_token');
        const accountUid = urlParams.get('account_uid');

        if (accountUid) {
          // Seed saved accounts from parent window (passed via URL param)
          const savedAccountsParam = urlParams.get('saved_accounts');
          if (savedAccountsParam) {
            try {
              const accounts: SavedAccount[] = JSON.parse(decodeURIComponent(savedAccountsParam));
              if (Array.isArray(accounts) && accounts.length > 0) {
                saveAccountsToStorage(accounts);
                setSavedAccounts(accounts);
              }
            } catch {}
          }

          // If already logged in as the target user, reuse session and clean URL parameters
          if (fbUser && fbUser.uid === accountUid) {
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

            localStorage.removeItem('marktype_active_mock_id');
            const mapped = mapFirebaseUser(fbUser);
            setUser(mapped);
            const updated = addOrUpdateSavedAccount(fbUser, mapped);
            setSavedAccounts(updated);
            ensureUserDocumentExists(fbUser);
            if (!initDone) {
              initDone = true;
              setAuthStateSafe('ready');
            }
            return;
          }

          // Incorrect or null user session. Clean up current auth and authenticate.
          setAuthStateSafe('switchingAccount');
          try {
            await fbSignOut(auth);
          } catch {}

          if (accountToken) {
            try {
              const result = await signInWithCustomToken(auth, accountToken);
              removeCachedToken(accountUid);
              setCachedToken(result.user.uid, accountToken);

              const mapped = mapFirebaseUser(result.user);
              setUser(mapped);
              const updated = addOrUpdateSavedAccount(result.user, mapped);
              setSavedAccounts(updated);
              ensureUserDocumentExists(result.user);
            } catch (err) {
              removeCachedToken(accountUid);
              addAuthEvent({ type: 'info', message: 'Session expired. Re-authenticating...' });
              try {
                await signInWithGoogle();
              } catch (e) {
                addAuthEvent({ type: 'error', message: 'Please sign in to continue.' });
              }
            }
          } else {
            // No custom token provided. Trigger Google sign-in flow directly.
            addAuthEvent({ type: 'info', message: 'Session expired. Re-authenticating...' });
            try {
              await signInWithGoogle();
            } catch (e) {
              addAuthEvent({ type: 'error', message: 'Please sign in to continue.' });
            }
          }

          // Strip auth query params from the URL so subsequent reloads don't re-trigger this logic
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

          if (!initDone) {
            initDone = true;
            setAuthStateSafe('ready');
          }
          return;
        }
      }

      // Standard user session change listener (when not doing query-param account switch on window load)
      if (fbUser) {
        localStorage.removeItem('marktype_active_mock_id');
        const mapped  = mapFirebaseUser(fbUser);
        setUser(mapped);
        const updated = addOrUpdateSavedAccount(fbUser, mapped);
        setSavedAccounts(updated);
        ensureUserDocumentExists(fbUser);
      } else {
        if (!localStorage.getItem('marktype_active_mock_id')) {
          setUser(null);
        }
        setSavedAccounts(getSavedAccountsFromStorage());
      }
      if (!initDone) {
        initDone = true;
        setAuthStateSafe('ready');
      }
    });

    // ── PostMessage handler ────────────────────────────────────────────────
    const handleMessage = async (event: MessageEvent) => {
      if (event?.data?.type === 'marktype-auth' && event.data.payload?.customToken) {
        try {
          setAuthStateSafe('switchingAccount');
          const payload = event.data.payload as PendingAuthPayload;
          const result = await signInWithCustomToken(auth, payload.customToken);
          setCachedToken(result.user.uid, payload.customToken);
          localStorage.removeItem('marktype_active_mock_id');
          setUser(mapFirebaseUser(result.user));
          const updated = addOrUpdateSavedAccount(result.user, mapFirebaseUser(result.user));
          setSavedAccounts(updated);
        } catch (err) {
          console.error('[auth] PostMessage sign-in failed:', err);
          addAuthEvent({ type: 'error', message: 'Sign-in via redirect failed. Please try again.' });
        } finally {
          if (authStateRef.current === 'switchingAccount') {
            setAuthStateSafe('ready');
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // ── Magic Link ──────────────────────────────────────────────────────────
    if (isSignInWithEmailLink(auth, window.location.href)) {
      (async () => {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
          email = await showPromptDialog('Email Confirmation', 'Please enter your email for confirmation:');
        }
        if (email) {
          setAuthStateSafe('switchingAccount');
          signInWithEmailLink(auth, email, window.location.href)
            .then((result) => {
              window.localStorage.removeItem('emailForSignIn');
              if (result.user) {
                const mapped = mapFirebaseUser(result.user);
                setUser(mapped);
                const updated = addOrUpdateSavedAccount(result.user, mapped);
                setSavedAccounts(updated);
                addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
              }
            })
            .catch(() => {
              addAuthEvent({ type: 'error', message: 'Magic link invalid or expired. Please request a new one.' });
            })
            .finally(() => {
              if (authStateRef.current === 'switchingAccount') {
                setAuthStateSafe('ready');
              }
            });
        }
      })();
    }

    return () => {
      unsubscribe();
      window.removeEventListener('message', handleMessage);
      if (authUnlistenRef.current) {
        authUnlistenRef.current();
        authUnlistenRef.current = null;
      }
    };
  }, []);

  // ── signInWithGoogle ──────────────────────────────────────────────────────
  const getCustomTokenViaGoogle = async (): Promise<string> => {
    if (!isTauri) {
      throw new Error('This action is only supported inside the desktop app.');
    }
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (authUnlistenRef.current) {
      authUnlistenRef.current();
      authUnlistenRef.current = null;
    }

    const port = await invoke<number>('start_google_auth', { state });

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timed out. Please try again.'));
      }, 300000);

      listen<{ code: string; state: string }>(
        'auth-google-callback',
        async (event) => {
          clearTimeout(timeout);
          if (event.payload.state !== state) {
            reject(new Error('Security verification failed. Please try again.'));
            return;
          }

          if (authUnlistenRef.current) {
            authUnlistenRef.current();
            authUnlistenRef.current = null;
          }

          try {
            const redirectUri = `http://127.0.0.1:${port}/callback`;
            const backendUrl = import.meta.env.VITE_MODAL_BASE_URL || 'https://iamspruce--marktype-backend-fastapi-app.modal.run';
            
            const res = await fetch(`${backendUrl}/exchange-google-code`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: event.payload.code,
                redirectUri,
              }),
            });

            if (!res.ok) {
              throw new Error('Failed to exchange code: ' + (await res.text()));
            }

            const payload: PendingAuthPayload = await res.json();
            resolve(payload.customToken);
          } catch (err) {
            reject(err instanceof Error ? err : new Error('Sign-in failed. Please try again.'));
          }
        }
      ).then(unlistenFn => {
        authUnlistenRef.current = unlistenFn;
      }).catch(err => {
        clearTimeout(timeout);
        reject(err);
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
      }).toString()}`;

      invoke('open_browser_url', { url: authUrl }).catch(err => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error('Failed to open browser. Please try again.'));
      });
    });
  };

  // ── signInWithGoogle ──────────────────────────────────────────────────────
  const signInWithGoogle = async (): Promise<void> => {
    setAuthStateSafe('switchingAccount');

    if (isTauri) {
      try {
        const customToken = await getCustomTokenViaGoogle();
        const result = await signInWithCustomToken(auth, customToken);
        setCachedToken(result.user.uid, customToken);
        const mapped = mapFirebaseUser(result.user);
        localStorage.removeItem('marktype_active_mock_id');
        setUser(mapped);
        const updated = addOrUpdateSavedAccount(result.user, mapped);
        setSavedAccounts(updated);
        addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
      } catch (err) {
        console.error('Google Sign In Error:', err);
        throw err;
      } finally {
        setAuthStateSafe('ready');
      }
      return;
    }

    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        localStorage.removeItem('marktype_active_mock_id');
        const mapped  = mapFirebaseUser(result.user);
        setUser(mapped);
        const updated = addOrUpdateSavedAccount(result.user, mapped);
        setSavedAccounts(updated);
        addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
      }
    } catch (e: any) {
      const code = e?.code;
      const isConfigError =
        code === 'auth/configuration-not-found' ||
        code === 'auth/operation-not-allowed';

      if (!isConfigError) {
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
          console.error('Google Sign In Error:', e);
        }
        return;
      }

      console.warn('Google Sign In: Firebase Google provider not enabled. Using fallback.');
      const fallbackName = prompt('Enter your name to simulate Google Sign-in:');
      if (fallbackName) {
        saveMockUser({
          id:           'mock-google-' + Date.now(),
          display_name: fallbackName,
          email:        fallbackName.toLowerCase().replace(/\s+/g, '') + '@gmail.com',
          created_at:   new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          is_anonymous: false,
        });
      }
    } finally {
      if (authStateRef.current === 'switchingAccount') {
        setAuthStateSafe('ready');
      }
    }
  };

  // ── sendMagicLink ─────────────────────────────────────────────────────────
  const sendMagicLink = async (email: string) => {
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: window.location.href.replace(window.location.search, ''),
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', email);
      addAuthEvent({ type: 'info', message: `Magic sign-in link sent to ${email}. Check your inbox!` });
    } catch (e: any) {
      console.error('Magic Link Error:', e);
      addAuthEvent({ type: 'info', message: `[Dev Mode] Magic link simulated for ${email}. Auto-signing in...` });
      setTimeout(() => {
        saveMockUser({
          id:           'mock-magic-' + Date.now(),
          display_name: email.split('@')[0],
          email,
          created_at:   new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          is_anonymous: false,
        });
        addAuthEvent({ type: 'info', message: `Signed in as ${email.split('@')[0]}` });
      }, 1000);
    }
  };

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    setAuthStateSafe('signingOut');
    const currentUid = user?.id;
    localStorage.removeItem('marktype_active_mock_id');
    try { await fbSignOut(auth); } catch (e) { console.error('Sign Out Error:', e); }
    if (currentUid) removeCachedToken(currentUid);
    setUser(null);
    setAuthStateSafe('ready');
  };

  // ── switchAccount ─────────────────────────────────────────────────────────
  const switchAccount = async (uid: string) => {
    // Try cached token first for instant switch (web in-place fallback)
    let cachedToken = getCachedToken(uid);
    if (cachedToken && !isTauri) {
      setAuthStateSafe('switchingAccount');
      try {
        const result = await signInWithCustomToken(auth, cachedToken);
        const mapped = mapFirebaseUser(result.user);
        localStorage.removeItem('marktype_active_mock_id');
        setUser(mapped);
        const updated = addOrUpdateSavedAccount(result.user, mapped);
        setSavedAccounts(updated);
        addAuthEvent({ type: 'info', message: `Switched to ${mapped.display_name}` });
        setAuthStateSafe('ready');
        return;
      } catch (e) {
        console.log('[auth] Cached token expired, falling back to full auth');
        removeCachedToken(uid);
        cachedToken = null;
      }
    }

    // In Tauri: pre-authenticate if token is missing/expired, then launch
    if (isTauri) {
      if (!cachedToken) {
        setAuthStateSafe('switchingAccount');
        addAuthEvent({ type: 'info', message: 'Please re-authenticate in the browser popup...' });
        try {
          cachedToken = await getCustomTokenViaGoogle();
          setCachedToken(uid, cachedToken);
        } catch (e) {
          console.error('[auth] Pre-authentication failed:', e);
          addAuthEvent({ type: 'error', message: 'Re-authentication failed or was cancelled.' });
          setAuthStateSafe('ready');
          throw e; // Abort: do not open a guest window!
        }
      }

      try {
        await invoke('open_account_window', {
          accountUid: uid,
          accountToken: cachedToken,
          workspaceContextJson: JSON.stringify({ type: 'personal' }),
          savedAccountsJson: JSON.stringify(getSavedAccountsFromStorage()),
        });
      } catch (e) {
        console.error('[auth] Failed to open account window:', e);
        addAuthEvent({ type: 'error', message: 'Failed to open new window for account.' });
      } finally {
        setAuthStateSafe('ready');
      }
      return;
    }

    // Web fallback: switch in-place with popup
    setAuthStateSafe('switchingAccount');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        localStorage.removeItem('marktype_active_mock_id');
        const mapped  = mapFirebaseUser(result.user);
        setUser(mapped);
        const updated = addOrUpdateSavedAccount(result.user, mapped);
        setSavedAccounts(updated);
        addAuthEvent({ type: 'info', message: `Switched to ${mapped.display_name}` });
      }
    } catch (e: any) {
      const code = e?.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        console.warn('Account switch error:', e);
        addAuthEvent({ type: 'error', message: 'Failed to switch account. Please try again.' });
      }
      const accounts = getSavedAccountsFromStorage();
      const target = accounts.find(a => a.uid === uid);
      if (target) {
        saveMockUser({
          id:           target.uid,
          display_name: target.displayName,
          email:        target.email,
          avatar_url:   target.photoURL || undefined,
          created_at:   new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          is_anonymous: false,
        });
      }
    } finally {
      if (authStateRef.current === 'switchingAccount') {
        setAuthStateSafe('ready');
      }
    }
  };

  // ── removeSavedAccount ───────────────────────────────────────────────────
  const removeSavedAccount = async (uid: string) => {
    const list = getSavedAccountsFromStorage();
    const updated = list.filter(a => a.uid !== uid);
    saveAccountsToStorage(updated);
    removeCachedToken(uid);
    setSavedAccounts(updated);

    if (user?.id === uid) {
      await logout();
    }
  };

  // ── logoutAll ─────────────────────────────────────────────────────────────
  const logoutAll = async () => {
    setAuthStateSafe('signingOut');
    localStorage.removeItem('marktype_active_mock_id');
    try {
      await fbSignOut(auth);
      localStorage.removeItem('marktype_saved_accounts');
      clearAllCachedTokens();
      setSavedAccounts([]);
      setUser(null);
    } catch (e) {
      console.error('Sign out all error:', e);
    } finally {
      setAuthStateSafe('ready');
    }
  };

  const loading = authState !== 'ready';

  return (
    <AuthContext.Provider value={{
      user, loading, authState, savedAccounts, authEvents, clearAuthEvents,
      signInWithGoogle, sendMagicLink, logout, switchAccount, logoutAll, removeSavedAccount
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useUser() {
  return useContext(AuthContext).user;
}

export { timeAgo };
