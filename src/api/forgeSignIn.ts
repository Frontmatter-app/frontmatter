/**
 * Signing in with a git provider, from the desktop app.
 *
 * The browser does the sign-in and the app collects the result, because a
 * desktop application cannot receive an OAuth redirect without registering a
 * URL scheme — which has to be done per platform, breaks inside sandboxes, and
 * when it fails leaves the user staring at a browser tab with no way to
 * continue. Polling for a pairing code works everywhere, and is the same shape
 * as the device flow people already meet when connecting a provider.
 *
 * The browser is the *system* browser, deliberately, not a webview: somebody is
 * being asked for their git provider credentials, and they should be able to
 * see the address bar and their existing session while they do it.
 */
import { apiRequest } from './client';
import { acquireRefreshToken, establish } from './auth';
import { setRefreshToken, type Session } from '../auth/session';

export class ForgeSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgeSignInError';
  }
}

interface StartResponse {
  pairingCode: string;
  authorizeUrl: string;
  expiresIn: number;
}

interface ClaimResponse {
  status: 'pending' | 'ready' | 'failed';
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
}

/** How often to ask whether the browser has finished. */
const POLL_INTERVAL_MS = 1500;

export interface ForgeSignInHandles {
  /** Shown so somebody can open it by hand if the browser did not. */
  authorizeUrl: string;
  /** Resolves when the sign-in completes, rejects if it fails or is abandoned. */
  session: Promise<Session>;
}

/**
 * Begins a sign-in and returns once the browser has somewhere to go.
 *
 * Split in two so the caller can render the URL immediately rather than showing
 * a spinner until the whole round trip finishes — if the browser fails to open,
 * that link is the only way forward.
 */
export async function beginForgeSignIn(
  provider: string,
  options: { signal?: AbortSignal; openBrowser?: (url: string) => void | Promise<void> } = {},
): Promise<ForgeSignInHandles> {
  const started = await apiRequest<StartResponse>(`/auth/forge/${provider}/start`, {
    method: 'POST',
    anonymous: true,
    signal: options.signal,
  });

  // Opening the browser is best-effort: the panel shows the URL either way, and
  // a failure to launch must not abandon a sign-in that is otherwise fine.
  void Promise.resolve(options.openBrowser?.(started.authorizeUrl)).catch(() => {});

  return {
    authorizeUrl: started.authorizeUrl,
    session: pollForSession(started, options.signal),
  };
}

async function pollForSession(started: StartResponse, signal?: AbortSignal): Promise<Session> {
  const deadline = Date.now() + started.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ForgeSignInError('Sign-in was cancelled.');
    await delay(POLL_INTERVAL_MS, signal);
    if (signal?.aborted) throw new ForgeSignInError('Sign-in was cancelled.');

    let claimed: ClaimResponse;
    try {
      claimed = await apiRequest<ClaimResponse>('/auth/forge/claim', {
        method: 'POST',
        anonymous: true,
        body: { pairingCode: started.pairingCode },
        signal,
      });
    } catch (error) {
      // A 404 means the pairing is gone — expired, or already claimed. Anything
      // else is most likely the network wobbling, and is worth another try.
      if ((error as { status?: number }).status === 404) {
        throw new ForgeSignInError('That sign-in expired. Try again.');
      }
      continue;
    }

    if (claimed.status === 'failed') {
      throw new ForgeSignInError(claimed.error || 'The provider did not complete the sign-in.');
    }
    if (claimed.status === 'ready' && claimed.accessToken) {
      // Stored before the session is established, so that if `/users/me` fails
      // the renewal credential is already safe rather than lost with the
      // attempt.
      if (claimed.refreshToken) setRefreshToken(claimed.refreshToken);

      // Straight into the session store, and never returned to the caller as a
      // raw token: it is a bearer credential for this whole server.
      const session = await establish(claimed.accessToken);
      // Older servers hand back no refresh token with the claim; ask for one.
      if (!claimed.refreshToken) await acquireRefreshToken();
      return session;
    }
  }

  throw new ForgeSignInError('That sign-in expired. Try again.');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
