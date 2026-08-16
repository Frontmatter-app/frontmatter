/**
 * The signed-in session, readable outside React.
 *
 * Replaces `firebase/auth`'s `auth.currentUser`, which ~20 call sites across
 * the CRDT layer, the editor hooks and the image pipeline reached for directly.
 * Those places are not components and cannot use a hook, so the session is kept
 * in a module-level store with a subscribe function.
 *
 * The token is a bearer JWT issued by the collaboration server. It is held in
 * memory and mirrored to storage so a restart does not sign the user out.
 *
 * Known weakness, inherited and deliberately not widened: persistence is
 * `localStorage`, which is readable by anything running in the webview. It is
 * no worse than the Firebase custom tokens that were kept there before, but the
 * OS keychain is where this belongs, and forge credentials — which can write to
 * a user's repositories — must go there rather than here.
 */
import type { User } from '../types';

const TOKEN_KEY = 'frontmatter_access_token';
const USER_KEY = 'frontmatter_current_user';

export interface Session {
  user: User;
  token: string;
}

type Listener = (session: Session | null) => void;

let current: Session | null = null;
let listeners: Listener[] = [];
let hydrated = false;

function readStoredSession(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) as User };
  } catch {
    return null;
  }
}

/**
 * Loads any persisted session. Safe to call repeatedly.
 *
 * The token is not validated here — a call against the server will reject it if
 * it has expired, and blocking startup on a network round trip would make the
 * app unusable offline for the local-only features that need no account.
 */
export function hydrateSession(): Session | null {
  if (!hydrated) {
    current = readStoredSession();
    hydrated = true;
  }
  return current;
}

export function getSession(): Session | null {
  return hydrateSession();
}

export function getCurrentUser(): User | null {
  return hydrateSession()?.user ?? null;
}

export function getAccessToken(): string | null {
  return hydrateSession()?.token ?? null;
}

export function setSession(session: Session | null): void {
  current = session;
  hydrated = true;
  try {
    if (session) {
      localStorage.setItem(TOKEN_KEY, session.token);
      localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Storage full or blocked; the in-memory session still works for this run.
  }
  for (const listener of [...listeners]) listener(session);
}

export function onSessionChange(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

/** Test seam: drops the session and every subscriber. */
export function resetSessionForTests(): void {
  current = null;
  hydrated = false;
  listeners = [];
}
