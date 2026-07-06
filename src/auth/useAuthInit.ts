import { useEffect } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signInWithEmailLink, isSignInWithEmailLink, signInWithPopup, signOut as fbSignOut, GoogleAuthProvider } from 'firebase/auth';
import { auth } from './firebase';
import { mapFirebaseUser, setCachedToken, removeCachedToken, addOrUpdateSavedAccount, getSavedAccounts, ensureUserDocumentExists, SavedAccount } from './authStorage';
import { showPromptDialog } from '../lib/tauriDialog';
import type { User } from '../types';

interface UseAuthInitCallbacks {
  setUser: (u: User | null) => void;
  setSavedAccounts: (a: SavedAccount[]) => void;
  setAuthState: (s: string) => void;
  addAuthEvent: (e: { type: 'error' | 'info'; message: string }) => void;
  authStateRef: { current: string };
}

export function useAuthInit({ setUser, setSavedAccounts, setAuthState, addAuthEvent, authStateRef }: UseAuthInitCallbacks) {
  useEffect(() => {
    let initDone = false;
    const raw = localStorage.getItem('marktype_saved_accounts');
    let list: SavedAccount[] = [];
    try { list = raw ? JSON.parse(raw) : []; setSavedAccounts(list); } catch (_) {}

    const activeMockId = localStorage.getItem('marktype_active_mock_id');
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
                localStorage.setItem('marktype_saved_accounts', JSON.stringify(accounts));
                setSavedAccounts(accounts);
              }
            } catch {}
          }
          if (fbUser && fbUser.uid === accountUid) {
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            localStorage.removeItem('marktype_active_mock_id');
            const mapped = mapFirebaseUser(fbUser);
            setUser(mapped);
            setSavedAccounts(addOrUpdateSavedAccount(fbUser, mapped));
            ensureUserDocumentExists(fbUser);
            if (!initDone) { initDone = true; setAuthState('ready'); }
            return;
          }
          setAuthState('switchingAccount');
          try { await fbSignOut(auth); } catch {}
          if (accountToken) {
            try {
              const result = await signInWithCustomToken(auth, accountToken);
              removeCachedToken(accountUid);
              setCachedToken(result.user.uid, accountToken);
              const mapped = mapFirebaseUser(result.user);
              setUser(mapped);
              setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
              ensureUserDocumentExists(result.user);
            } catch {
              removeCachedToken(accountUid);
              addAuthEvent({ type: 'info', message: 'Session expired. Re-authenticating...' });
              try {
                const provider = new GoogleAuthProvider();
                const result = await signInWithPopup(auth, provider);
                if (result?.user) {
                  const mapped = mapFirebaseUser(result.user);
                  setUser(mapped);
                  setSavedAccounts(addOrUpdateSavedAccount(result.user, mapped));
                }
              } catch { addAuthEvent({ type: 'error', message: 'Please sign in to continue.' }); }
            }
          } else {
            addAuthEvent({ type: 'info', message: 'Session expired. Re-authenticating...' });
            try {
              const provider = new GoogleAuthProvider();
              const result = await signInWithPopup(auth, provider);
              if (result?.user) {
                setUser(mapFirebaseUser(result.user));
                setSavedAccounts(addOrUpdateSavedAccount(result.user, mapFirebaseUser(result.user)));
              }
            } catch { addAuthEvent({ type: 'error', message: 'Please sign in to continue.' }); }
          }
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
          if (!initDone) { initDone = true; setAuthState('ready'); }
          return;
        }
      }
      if (fbUser) {
        localStorage.removeItem('marktype_active_mock_id');
        const mapped = mapFirebaseUser(fbUser);
        setUser(mapped);
        setSavedAccounts(addOrUpdateSavedAccount(fbUser, mapped));
        ensureUserDocumentExists(fbUser);
      } else {
        if (!localStorage.getItem('marktype_active_mock_id')) setUser(null);
        setSavedAccounts(getSavedAccounts());
      }
      if (!initDone) { initDone = true; setAuthState('ready'); }
    });

    const handleMessage = async (event: MessageEvent) => {
      if (event?.data?.type === 'marktype-auth' && event.data.payload?.customToken) {
        try {
          setAuthState('switchingAccount');
          const payload = event.data.payload;
          const result = await signInWithCustomToken(auth, payload.customToken);
          setCachedToken(result.user.uid, payload.customToken);
          localStorage.removeItem('marktype_active_mock_id');
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
