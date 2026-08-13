/**
 * Turns authentication failures into something a person can act on.
 *
 * Sign-in previously failed silently — the browser path logged to the console
 * and left the UI in its prior state, so a user saw nothing happen at all.
 */

export type AuthFailureKind =
  /** The user closed the popup or cancelled; not worth reporting. */
  | 'cancelled'
  /** Firebase is not set up for this build. */
  | 'not-configured'
  /** Wrong credentials, expired link, disabled account. */
  | 'rejected'
  /** Offline, timeout, or the backend was unreachable. */
  | 'unavailable'
  /** Anything we have not classified. */
  | 'unknown';

export interface AuthFailure {
  kind: AuthFailureKind;
  /** Shown to the user. Complete sentence, no error codes. */
  message: string;
  /** Original code, for logs. */
  code?: string;
}

const CANCELLED = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

const NOT_CONFIGURED = new Set([
  'auth/configuration-not-found',
  'auth/operation-not-allowed',
  'auth/invalid-api-key',
  'auth/api-key-not-valid',
]);

const REJECTED = new Map<string, string>([
  ['auth/invalid-email', 'That email address is not valid.'],
  ['auth/user-disabled', 'This account has been disabled.'],
  ['auth/user-not-found', 'No account matches that email address.'],
  ['auth/invalid-action-code', 'That sign-in link has expired. Request a new one.'],
  ['auth/expired-action-code', 'That sign-in link has expired. Request a new one.'],
  ['auth/invalid-custom-token', 'Your saved session is no longer valid. Sign in again.'],
  ['auth/custom-token-mismatch', 'Your saved session is no longer valid. Sign in again.'],
  ['auth/account-exists-with-different-credential',
    'An account already exists with this email using a different sign-in method.'],
  ['auth/too-many-requests', 'Too many attempts. Wait a few minutes and try again.'],
]);

const UNAVAILABLE = new Set([
  'auth/network-request-failed',
  'auth/timeout',
  'auth/internal-error',
]);

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

/**
 * Classifies a thrown value from Firebase Auth or our own sign-in flow.
 *
 * Callers should ignore `cancelled` — the user chose to stop — and surface
 * everything else.
 */
export function classifyAuthError(error: unknown): AuthFailure {
  const code = codeOf(error);

  if (code && CANCELLED.has(code)) {
    return { kind: 'cancelled', code, message: 'Sign-in was cancelled.' };
  }

  if (code && NOT_CONFIGURED.has(code)) {
    return {
      kind: 'not-configured',
      code,
      message: 'Sign-in is not available in this build. Check the app configuration.',
    };
  }

  if (code && REJECTED.has(code)) {
    return { kind: 'rejected', code, message: REJECTED.get(code)! };
  }

  if (code && UNAVAILABLE.has(code)) {
    return {
      kind: 'unavailable',
      code,
      message: 'Could not reach the sign-in service. Check your connection and try again.',
    };
  }

  // Our own flow throws plain Errors with already-readable messages.
  const raw = messageOf(error);
  if (raw && /timed out/i.test(raw)) {
    return { kind: 'unavailable', code, message: 'Sign-in timed out. Try again.' };
  }
  if (raw && /verification failed/i.test(raw)) {
    return {
      kind: 'rejected',
      code,
      message: 'Security verification failed. Start the sign-in again.',
    };
  }
  if (raw && /only supported inside the desktop app/i.test(raw)) {
    return { kind: 'not-configured', code, message: raw };
  }

  return {
    kind: 'unknown',
    code,
    message: 'Sign-in failed. Please try again.',
  };
}

/** True when the failure is the user backing out rather than something wrong. */
export function isCancellation(error: unknown): boolean {
  return classifyAuthError(error).kind === 'cancelled';
}
