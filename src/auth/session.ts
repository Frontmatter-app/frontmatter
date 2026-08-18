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
const REFRESH_KEY = 'frontmatter_refresh_token';

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

/**
 * The long-lived credential that renews the short-lived one.
 *
 * Kept apart from the session so that replacing the access token — which now
 * happens roughly hourly — does not have to carry it along and risk dropping
 * it. Losing this is not fatal, but it costs the user a sign-in.
 */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage blocked. The session still works until the access token expires.
  }
}

/**
 * Replaces the access token, leaving the signed-in user alone.
 *
 * A renewal is not a sign-in: the same person is still here, and rebuilding the
 * session object from scratch would notify every subscriber that the user
 * changed, remounting things that have no reason to remount once an hour.
 */
export function updateAccessToken(token: string): void {
  const existing = hydrateSession();
  if (!existing) return;
  setSession({ ...existing, token });
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
      // Signing out drops the renewal credential with the session. Leaving it
      // behind would let the next `apiRequest` quietly sign the user back in.
      localStorage.removeItem(REFRESH_KEY);
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
