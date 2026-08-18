/**
 * HTTP client for the collaboration server.
 *
 * Replaces `backendCall.ts`, which minted a Firebase ID token per request and
 * threw from module scope when `VITE_MODAL_BASE_URL` was unset. Here an
 * unconfigured server is a normal, recoverable state: the app is fully usable
 * without one.
 */
import { getServerUrl } from './serverUrl';
import {
  getAccessToken,
  getRefreshToken,
  setRefreshToken,
  setSession,
  updateAccessToken,
} from '../auth/session';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The token is missing, expired, or rejected — signing in again fixes it. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export class NoServerConfiguredError extends Error {
  constructor() {
    super('No collaboration server is configured. Add one in Settings to sign in.');
    this.name = 'NoServerConfiguredError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send as form encoding rather than JSON. The token endpoint requires it. */
  form?: Record<string, string>;
  /** Skip the Authorization header, for endpoints used before signing in. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Set on the retry after a renewal, so one failure cannot loop. */
  noRetry?: boolean;
}

/**
 * Pulls a human-readable message out of an error response.
 *
 * The server speaks FastAPI's `detail`, which is a string for our own errors
 * and an array of field descriptors for validation failures. fastapi-users adds
 * a third shape, `{detail: {code, reason}}`. Handling all three here keeps the
 * unwrapping out of every call site.
 */
async function describeFailure(response: Response): Promise<{ message: string; code?: string }> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { message: `Request failed (${response.status}).` };
  }

  const detail = (payload as { detail?: unknown } | null)?.detail;

  if (typeof detail === 'string') {
    return { message: humanise(detail), code: detail };
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    return { message: first?.msg ?? `Request failed (${response.status}).` };
  }
  if (detail && typeof detail === 'object') {
    const structured = detail as { code?: string; reason?: unknown };
    const reason =
      typeof structured.reason === 'string'
        ? structured.reason
        : Array.isArray(structured.reason)
          ? String((structured.reason[0] as { message?: string })?.message ?? '')
          : '';
    return {
      message: reason || humanise(structured.code ?? '') || `Request failed (${response.status}).`,
      code: structured.code,
    };
  }
  return { message: `Request failed (${response.status}).` };
}

/** Turns the server's SCREAMING_SNAKE codes into something worth showing. */
function humanise(code: string): string {
  switch (code) {
    case 'REGISTER_USER_ALREADY_EXISTS':
      return 'An account with that email already exists.';
    case 'LOGIN_BAD_CREDENTIALS':
      return 'That email and password do not match.';
    case 'LOGIN_USER_NOT_VERIFIED':
      return 'Confirm your email address before signing in.';
    case 'RESET_PASSWORD_BAD_TOKEN':
    case 'VERIFY_USER_BAD_TOKEN':
      return 'That link has expired. Request a new one.';
    default:
      return code;
  }
}

/**
 * Renews the session, at most once at a time.
 *
 * Several requests routinely fail together the moment an access token expires —
 * a document opening does three at once. Without a shared in-flight promise
 * each would rotate the refresh token independently, and since rotation treats
 * a second use of a spent token as theft, the app would revoke its own session
 * and sign the user out. The shared promise is not an optimisation; it is what
 * stops the client from mugging itself.
 */
let renewal: Promise<boolean> | null = null;

async function renewSession(): Promise<boolean> {
  if (renewal) return renewal;

  renewal = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    const base = getServerUrl();
    if (!base) return false;

    try {
      const response = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;

      const renewed = (await response.json()) as { accessToken: string; refreshToken: string };
      // The new refresh token is stored first. If the process died between the
      // two writes, losing the access token costs a renewal; losing the refresh
      // token costs a sign-in.
      setRefreshToken(renewed.refreshToken);
      updateAccessToken(renewed.accessToken);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await renewal;
  } finally {
    renewal = null;
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getServerUrl();
  if (!base) throw new NoServerConfiguredError();

  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(options.form).toString();
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (!options.anonymous) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: options.signal,
    });
  } catch (cause) {
    throw new ApiError(
      `Could not reach the server at ${base}. Check that it is running and the URL is right.`,
      0,
    );
  }

  if (response.status === 401 && !options.anonymous && !options.noRetry) {
    // An expired access token is now the ordinary case rather than a failure —
    // they last an hour. Renew and try once more before concluding anything.
    if (await renewSession()) {
      return apiRequest<T>(path, { ...options, noRetry: true });
    }
    // Renewal failed, so the session really is over. Clearing it here means the
    // UI reacts once rather than every screen discovering it separately.
    setSession(null);
  }

  if (!response.ok) {
    const { message, code } = await describeFailure(response);
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
