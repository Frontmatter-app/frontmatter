import { useEffect } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signInWithEmailLink, isSignInWithEmailLink, signInWithPopup, signOut as fbSignOut, GoogleAuthProvider, type User as FirebaseUser } from 'firebase/auth';
import { auth } from './firebase';
import { mapFirebaseUser, setCachedToken, removeCachedToken, addOrUpdateSavedAccount, getSavedAccounts, ensureUserDocumentExists, SavedAccount } from './authStorage';
import { showPromptDialog } from '../lib/tauriDialog';
import { isTauri } from '../lib/env';
import { ACTIVE_MOCK_KEY, clearStaleMockSession } from './mockAuth';
import type { User } from '../types';

interface UseAuthInitCallbacks {
  setUser: (u: User | null) => void;
  setSavedAccounts: (a: SavedAccount[]) => void;
  setAuthState: (s: string) => void;
  addAuthEvent: (e: { type: 'error' | 'info'; message: string }) => void;
  authStateRef: { current: string };
  /** Desktop OAuth round trip; `signInWithPopup` does not work in the webview. */
  getCustomTokenViaGoogle: () => Promise<string>;
}

export function useAuthInit({ setUser, setSavedAccounts, setAuthState, addAuthEvent, authStateRef, getCustomTokenViaGoogle }: UseAuthInitCallbacks) {
  useEffect(() => {
    let initDone = false;
    const raw = localStorage.getItem('frontmatter_saved_accounts');
    let list: SavedAccount[] = [];
    try { list = raw ? JSON.parse(raw) : []; setSavedAccounts(list); } catch (_) {}

    // A mock session written by a dev build must not survive into one where
    // mock auth is off, or the app comes up signed in as a user that cannot sync.
    clearStaleMockSession();

    /**
     * Re-establishes a session interactively. In the desktop webview a Firebase
     * popup cannot open at all, so the system-browser flow is the only one that
     * can succeed there.
     */
    const reauthenticate = async () => {
      if (isTauri) {
        const token = await getCustomTokenViaGoogle();
        const result = await signInWithCustomToken(auth, token);
        // Keep it, so the next switch to this account does not prompt again.
        setCachedToken(result.user.uid, token);
        return result;
      }
      const provider = new GoogleAuthProvider();
      return signInWithPopup(auth, provider);
    };

    const activeMockId = localStorage.getItem(ACTIVE_MOCK_KEY);
    if (activeMockId) {
      const target = list.find(a => a.uid === activeMockId);
      if (target) setUser({
        id: target.uid, display_name: target.displayName,
        email: target.email, avatar_url: target.photoURL || undefined,
        created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_anonymous: false,
      });
    }

    let hasCheckedUrlAuth = false;
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!hasCheckedUrlAuth) {
        hasCheckedUrlAuth = true;
        const urlParams = new URLSearchParams(window.location.search);
        const accountToken = urlParams.get('account_token');
        const accountUid = urlParams.get('account_uid');

        if (accountUid) {
          const savedAccountsParam = urlParams.get('saved_accounts');
          if (savedAccountsParam) {
            try {
              const accounts: SavedAccount[] = JSON.parse(decodeURIComponent(savedAccountsParam));
              if (Array.isArray(accounts) && accounts.length > 0) {
                localStorage.setItem('frontmatter_saved_accounts', JSON.stringify(accounts));
                setSavedAccounts(accounts);
              }
            } catch {}
          }
          if (fbUser && fbUser.uid === accountUid) {
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            localStorage.removeItem(ACTIVE_MOCK_KEY);
            const mapped = mapFirebaseUser(fbUser);
            setUser(mapped);
            setSavedAccounts(addOrUpdateSavedAccount(fbUser, mapped));
            ensureUserDocumentExists(fbUser);
            if (!initDone) { initDone = true; setAuthState('ready'); }
            return;
          }
          setAuthState('switchingAccount');
          try { await fbSignOut(auth); } catch {}
          const adopt = (fbUser: FirebaseUser) => {
            const mapped = mapFirebaseUser(fbUser);
            setUser(mapped);
            setSavedAccounts(addOrUpdateSavedAccount(fbUser, mapped));
            ensureUserDocumentExists(fbUser);
          };

          let restored = false;
          if (accountToken) {
            try {
              const result = await signInWithCustomToken(auth, accountToken);
              removeCachedToken(accountUid);
              setCachedToken(result.user.uid, accountToken);
              adopt(result.user);
              restored = true;
            } catch {
              // A custom token lasts an hour; past that the window has to ask.
              removeCachedToken(accountUid);
            }
          }

          if (!restored) {
            addAuthEvent({ type: 'info', message: 'Session expired. Re-authenticating…' });
            try {
              const result = await reauthenticate();
              if (result?.user) adopt(result.user);
            } catch (e) {
              console.error('[auth] re-authentication', e);
              addAuthEvent({ type: 'error', message: 'Please sign in to continue.' });
            }
          }
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
          if (!initDone) { initDone = true; setAuthState('ready'); }
          return;
        }
      }
      if (fbUser) {
        localStorage.removeItem(ACTIVE_MOCK_KEY);
        const mapped = mapFirebaseUser(fbUser);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(fbUser, mapped));
        ensureUserDocumentExists(fbUser);
      } else {
        if (!localStorage.getItem(ACTIVE_MOCK_KEY)) setUser(null);
        setSavedAccounts(getSavedAccounts());
      }
      if (!initDone) { initDone = true; setAuthState('ready'); }
    });

    const handleMessage = async (event: MessageEvent) => {
      // Both names, deliberately.
      //
      // The sign-in page is deployed separately from this app, so the two
      // sides are never upgraded together: a new build will meet the old page
      // and an old build will meet the new one. Accepting either name means
      // neither combination locks anyone out. The legacy name can be dropped
      // once the deployed page has been on the new one long enough that no
      // stale build is still in use.
      const isAuthMessage =
        event?.data?.type === 'frontmatter-auth' || event?.data?.type === 'marktype-auth';
      if (isAuthMessage && event.data.payload?.customToken) {
        try {
          setAuthState('switchingAccount');
          const payload = event.data.payload;
          const result = await signInWithCustomToken(auth, payload.customToken);
          setCachedToken(result.user.uid, payload.customToken);
          localStorage.removeItem(ACTIVE_MOCK_KEY);
          setUser(mapFirebaseUser(result.user));
          setSavedAccounts(addOrUpdateSavedAccount(result.user, mapFirebaseUser(result.user)));
        } catch (err) {
          console.error('[auth] PostMessage sign-in failed:', err);
          addAuthEvent({ type: 'error', message: 'Sign-in via redirect failed. Please try again.' });
        } finally {
          if (authStateRef.current === 'switchingAccount') setAuthState('ready');
        }
      }
    };
    window.addEventListener('message', handleMessage);

    if (isSignInWithEmailLink(auth, window.location.href)) {
      (async () => {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) email = await showPromptDialog('Email Confirmation', 'Please enter your email for confirmation:');
        if (email) {
          setAuthState('switchingAccount');
          signInWithEmailLink(auth, email, window.location.href)
            .then((result) => {
              window.localStorage.removeItem('emailForSignIn');
              if (result.user) {
                const mapped = mapFirebaseUser(result.user);
                setUser(mapped);
                setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
                addAuthEvent({ type: 'info', message: `Signed in as ${mapped.display_name}` });
              }
            })
            .catch(() => addAuthEvent({ type: 'error', message: 'Magic link invalid or expired.' }))
            .finally(() => { if (authStateRef.current === 'switchingAccount') setAuthState('ready'); });
        }
      })();
    }

    return () => { unsubscribe(); window.removeEventListener('message', handleMessage); };
  }, []);
}
