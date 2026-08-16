/**
 * Sign-in state, against the collaboration server.
 *
 * What this replaces was a great deal larger and needed four external services
 * to work: a Rust loopback listener for Google OAuth, a code-for-custom-token
 * exchange on a Modal backend, Firebase custom-token redemption, and a magic
 * link flow that could not use `tauri://localhost` as its continue URL.
 *
 * Signing in is now an email and a password against whichever server the user
 * points the app at, and **no server at all is a supported state** — the editor,
 * workflow, prose linting, git and publishing never needed an account.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchCapabilities,
  refreshCurrentUser,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  requestPasswordReset as apiRequestPasswordReset,
  type ServerCapabilities,
} from '../api/auth';
import { ApiError, NoServerConfiguredError } from '../api/client';
import { hasServer } from '../api/serverUrl';
import { getSession, onSessionChange, hydrateSession } from './session';
import type { User } from '../types';

export type AuthState = 'initializing' | 'ready' | 'signingIn' | 'signingOut';

export interface AuthEvent {
  type: 'error' | 'info';
  message: string;
}

function describe(error: unknown): string {
  if (error instanceof NoServerConfiguredError) return error.message;
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export function useAuthState() {
  const [user, setUser] = useState<User | null>(() => getSession()?.user ?? null);
  const [authState, setAuthState] = useState<AuthState>('initializing');
  const [authEvents, setAuthEvents] = useState<AuthEvent[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const addAuthEvent = useCallback((event: AuthEvent) => {
    setAuthEvents((previous) => [...previous, event]);
    // Errors stay until dismissed; informational notices fade.
    if (event.type === 'error') return;
    const timer = setTimeout(
      () => setAuthEvents((previous) => previous.filter((candidate) => candidate !== event)),
      5000,
    );
    dismissTimers.current.push(timer);
  }, []);

  const clearAuthEvents = useCallback(() => setAuthEvents([]), []);

  useEffect(
    () => () => {
      dismissTimers.current.forEach(clearTimeout);
      dismissTimers.current = [];
    },
    [],
  );

  // Anything that calls `setSession` — including the API client dropping an
  // expired token on a 401 — is reflected here without every screen having to
  // discover it separately.
  useEffect(() => onSessionChange((session) => setUser(session?.user ?? null)), []);

  // Startup: adopt any stored session, then confirm the token still works.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = hydrateSession();
      if (!stored || !hasServer()) {
        if (!cancelled) setAuthState('ready');
        return;
      }
      // Optimistic: show the user immediately and verify in the background, so
      // a slow or unreachable server does not gate startup.
      setUser(stored.user);
      const confirmed = await refreshCurrentUser(stored.token);
      if (cancelled) return;
      if (!confirmed) {
        addAuthEvent({ type: 'info', message: 'Your session expired. Sign in again.' });
      }
      setAuthState('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [addAuthEvent]);

  // What the configured server supports, so the sign-in form matches it.
  useEffect(() => {
    if (!hasServer()) {
      setCapabilities(null);
      return;
    }
    const controller = new AbortController();
    fetchCapabilities(controller.signal)
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
    return () => controller.abort();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setAuthState('signingIn');
      try {
        const session = await apiSignIn(email, password);
        setUser(session.user);
      } catch (error) {
        addAuthEvent({ type: 'error', message: describe(error) });
        throw error;
      } finally {
        setAuthState('ready');
      }
    },
    [addAuthEvent],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setAuthState('signingIn');
      try {
        const { requiresVerification } = await apiSignUp(email, password, displayName);
        if (requiresVerification) {
          addAuthEvent({
            type: 'info',
            message: 'Account created. Check your email to confirm the address.',
          });
        } else {
          await apiSignIn(email, password);
        }
      } catch (error) {
        addAuthEvent({ type: 'error', message: describe(error) });
        throw error;
      } finally {
        setAuthState('ready');
      }
    },
    [addAuthEvent],
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      try {
        await apiRequestPasswordReset(email);
        // Deliberately the same message whether or not the address exists.
        addAuthEvent({
          type: 'info',
          message: 'If that address has an account, a reset link is on its way.',
        });
      } catch (error) {
        addAuthEvent({ type: 'error', message: describe(error) });
      }
    },
    [addAuthEvent],
  );

  const logout = useCallback(async () => {
    setAuthState('signingOut');
    try {
      await apiSignOut();
      setUser(null);
    } finally {
      setAuthState('ready');
    }
  }, []);

  return {
    user,
    loading: authState === 'initializing',
    authState,
    authEvents,
    capabilities,
    clearAuthEvents,
    signIn,
    signUp,
    requestPasswordReset,
    logout,
  };
}
