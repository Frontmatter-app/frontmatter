/**
 * Account operations against the collaboration server.
 *
 * This is the whole identity surface the app needs. What it replaces was
 * markedly larger: a Google OAuth loopback listener in Rust, a code-for-custom-
 * token exchange on the backend, a Firebase custom-token redemption, a magic
 * link flow that could not use `tauri://localhost` as a continue URL, and a
 * `postMessage` bridge accepting two legacy message names.
 */
import { apiRequest } from './client';
import { setSession, type Session } from '../auth/session';
import type { User } from '../types';

interface ServerUser {
  id: string;
  email: string;
  is_active: boolean;
  is_verified: boolean;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface ServerCapabilities {
  identity: 'builtin' | 'oidc' | 'forge';
  allowRegistration: boolean;
  requireEmailVerification: boolean;
}

function toUser(raw: ServerUser): User {
  return {
    id: raw.id,
    email: raw.email,
    display_name: raw.display_name || raw.email.split('@')[0],
    avatar_url: raw.avatar_url ?? null,
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    is_anonymous: false,
  } as User;
}

/**
 * What this server supports, so the sign-in UI matches the server it is
 * pointed at rather than assuming. Callable before signing in.
 */
export function fetchCapabilities(signal?: AbortSignal): Promise<ServerCapabilities> {
  return apiRequest<ServerCapabilities>('/config', { anonymous: true, signal });
}

export async function signIn(email: string, password: string): Promise<Session> {
  // The token endpoint is OAuth2 password flow, so it takes form encoding and
  // calls the email field `username`.
  const token = await apiRequest<TokenResponse>('/auth/jwt/login', {
    anonymous: true,
    form: { username: email, password },
  });

  const session = await establish(token.access_token);
  return session;
}

export async function signUp(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ requiresVerification: boolean }> {
  const created = await apiRequest<ServerUser>('/auth/register', {
    anonymous: true,
    body: { email, password, display_name: displayName },
  });
  return { requiresVerification: !created.is_verified };
}

export async function requestPasswordReset(email: string): Promise<void> {
  // Always resolves, including for an unknown address: a differing response
  // would let anyone test which emails have accounts.
  await apiRequest<void>('/auth/forgot-password', { anonymous: true, body: { email } });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiRequest<void>('/auth/reset-password', { anonymous: true, body: { token, password } });
}

export async function requestVerificationEmail(email: string): Promise<void> {
  await apiRequest<void>('/auth/request-verify-token', { anonymous: true, body: { email } });
}

export async function verifyEmail(token: string): Promise<void> {
  await apiRequest<void>('/auth/verify', { anonymous: true, body: { token } });
}

/** Exchanges a token for the user it belongs to, and installs the session. */
export async function establish(accessToken: string): Promise<Session> {
  setSession({
    token: accessToken,
    // Placeholder so the request below carries the Authorization header; it is
    // replaced with the real record before anything observes it.
    user: { id: '', email: '' } as User,
  });
  try {
    const raw = await apiRequest<ServerUser>('/users/me');
    const session = { token: accessToken, user: toUser(raw) };
    setSession(session);
    return session;
  } catch (error) {
    setSession(null);
    throw error;
  }
}

/** Re-reads the signed-in user, confirming the stored token still works. */
export async function refreshCurrentUser(token: string): Promise<Session | null> {
  try {
    return await establish(token);
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await apiRequest<void>('/auth/jwt/logout', { method: 'POST' });
  } catch {
    // A failed logout call must still sign the user out locally — otherwise an
    // unreachable server traps them in a session they asked to end.
  }
  setSession(null);
}
