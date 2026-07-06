import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { User as FirebaseUser } from 'firebase/auth';
import { db } from './firebase';
import type { User } from '../types';

const TOKEN_STORAGE_KEY = 'marktype_account_tokens';
const ACCOUNTS_STORAGE_KEY = 'marktype_saved_accounts';

export interface SavedAccount {
  uid:         string;
  email:       string;
  displayName: string;
  photoURL:    string | null;
  lastUsed:    string;
}

export function mapFirebaseUser(fbUser: FirebaseUser): User {
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

export async function ensureUserDocumentExists(fbUser: FirebaseUser) {
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
    } else {
      await setDoc(userDocRef, { updatedAt: serverTimestamp() }, { merge: true });
    }
  } catch (e) {
    console.error('[auth] Failed to ensure Firestore user document exists:', e);
  }
}

export function getCachedToken(uid: string): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const tokens = JSON.parse(raw);
    return tokens[uid] || null;
  } catch { return null; }
}

export function setCachedToken(uid: string, token: string) {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    const tokens = raw ? JSON.parse(raw) : {};
    tokens[uid] = token;
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {}
}

export function removeCachedToken(uid: string) {
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

export function getSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAccounts(list: SavedAccount[]) {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(list));
}

export function addOrUpdateSavedAccount(fbUser: FirebaseUser, mapped: User): SavedAccount[] {
  let list = getSavedAccounts();
  const filtered = list.filter(a => a.uid !== fbUser.uid);
  filtered.push({
    uid:         fbUser.uid,
    email:       fbUser.email || '',
    displayName: mapped.display_name || 'User',
    photoURL:    fbUser.photoURL || null,
    lastUsed:    new Date().toISOString(),
  });
  saveAccounts(filtered);
  return filtered;
}

export function removeSavedAccountFromStorage(uid: string): SavedAccount[] {
  const list = getSavedAccounts();
  const updated = list.filter(a => a.uid !== uid);
  saveAccounts(updated);
  removeCachedToken(uid);
  return updated;
}

export function clearAllAccounts() {
  localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
  clearAllCachedTokens();
}
