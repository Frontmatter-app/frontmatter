/**
 * OAuth device flow.
 *
 * The right grant for a desktop app: the user is shown a short code, types it
 * into a browser they already trust, and the app polls until they finish. There
 * is no redirect URI, so nothing has to bind a loopback listener, register a
 * custom URL scheme, or hold a client secret — the app is a public client and
 * the flow is designed for exactly that.
 *
 * What it replaces for Google sign-in was a loopback listener bound in Rust, a
 * port handed back to the frontend, a `state` nonce checked by hand, and a
 * code-for-token exchange proxied through a backend that held the client
 * secret. This needs none of that, and self-hosters can register their own
 * OAuth app without our involvement.
 *
 * Reference: RFC 8628.
 */
import type { ForgeKind } from './types';

export interface DeviceCodeGrant {
  /** Shown to the user to type in. */
  userCode: string;
  /** Where they type it. */
  verificationUri: string;
  /** Opaque handle the app polls with. Never shown. */
  deviceCode: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds the provider requires between polls. */
  interval: number;
}

export interface DeviceFlowConfig {
  kind: ForgeKind;
  clientId: string;
  deviceCodeUrl: string;
  tokenUrl: string;
  scope: string;
}

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DeviceFlowError';
  }
}

/**
 * What the provider issues on success.
 *
 * `refreshToken` is present only when the OAuth app has token expiration
 * enabled — which is the default for GitHub Apps and an option for OAuth apps.
 * Discarding it, as an earlier version of this did, means the connection works
 * perfectly until the access token expires eight hours later and then fails for
 * everybody with no way back but reconnecting by hand.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds, or null when the token does not expire. */
  expiresAt: number | null;
}

function toTokenSet(raw: Record<string, unknown>): TokenSet {
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : null;
  return {
    accessToken: String(raw.access_token),
    refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : null,
    // A minute of slack, so a token is treated as expired slightly before it
    // is — a request that starts valid can still land after expiry.
    expiresAt: expiresIn ? Date.now() + (expiresIn - 60) * 1000 : null,
  };
}

/**
 * Providers ship their own client id, which is public by definition in this
 * grant — there is no secret to protect. A self-hoster can override these to
 * point at their own OAuth app.
 *
 * `repo` is requested because committing needs write access to private
 * repositories. `read:user` resolves the account; `read:org` is what makes
 * organisation repositories visible in the picker.
 */
/**
 * Frontmatter's own GitHub OAuth app.
 *
 * Shipped as a literal rather than kept in an env var, because in the device
 * flow the client id is public by construction: it is sent unauthenticated to
 * begin every sign-in, and there is no accompanying secret. Treating it as a
 * secret would buy nothing and would mean the app could not connect out of the
 * box. Override it to point at your own OAuth app.
 */
export const GITHUB_DEVICE_FLOW: DeviceFlowConfig = {
  kind: 'github',
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID || 'Ov23lioKyZe16OROpwdy',
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scope: 'repo read:user read:org',
};

export const GITLAB_DEVICE_FLOW: DeviceFlowConfig = {
  kind: 'gitlab',
  clientId: import.meta.env.VITE_GITLAB_CLIENT_ID ?? '',
  deviceCodeUrl: 'https://gitlab.com/oauth/authorize_device',
  tokenUrl: 'https://gitlab.com/oauth/token',
  scope: 'api read_user',
};

/** Step one: ask the provider for a code to show the user. */
export async function requestDeviceCode(config: DeviceFlowConfig): Promise<DeviceCodeGrant> {
  if (!config.clientId) {
    throw new DeviceFlowError(
      `No OAuth client id is configured for ${config.kind}. Register an OAuth app and set it in Settings.`,
      'no_client_id',
    );
  }

  const response = await fetch(config.deviceCodeUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, scope: config.scope }).toString(),
  });

  if (!response.ok) {
    throw new DeviceFlowError(
      `${config.kind} refused to start sign-in (${response.status}).`,
      'device_code_failed',
    );
  }

  const raw = await response.json();
  if (raw.error) throw new DeviceFlowError(raw.error_description ?? raw.error, raw.error);

  return {
    userCode: raw.user_code,
    verificationUri: raw.verification_uri ?? raw.verification_uri_complete,
    deviceCode: raw.device_code,
    expiresIn: raw.expires_in ?? 900,
    // Providers may omit the interval; five seconds is the RFC's default and
    // polling faster earns a `slow_down`.
    interval: raw.interval ?? 5,
  };
}

/**
 * Step two: poll until the user finishes, or the code expires.
 *
 * `authorization_pending` is the normal state for most of this loop, not an
 * error. `slow_down` means the provider wants a longer interval and must be
 * honoured or it starts refusing outright.
 */
export async function pollForToken(
  config: DeviceFlowConfig,
  grant: DeviceCodeGrant,
  options: { signal?: AbortSignal; onTick?: (secondsLeft: number) => void } = {},
): Promise<TokenSet> {
  let intervalMs = grant.interval * 1000;
  const deadline = Date.now() + grant.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DeviceFlowError('Sign-in cancelled.', 'cancelled');

    await sleep(intervalMs, options.signal);
    options.onTick?.(Math.max(0, Math.round((deadline - Date.now()) / 1000)));

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: grant.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });

    const raw = await response.json().catch(() => ({ error: 'bad_response' }));

    if (raw.access_token) return toTokenSet(raw);

    switch (raw.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        // Additive, per RFC 8628 §3.5. Ignoring this gets the poll rejected.
        intervalMs += (raw.interval ? raw.interval * 1000 : 5000);
        continue;
      case 'expired_token':
        throw new DeviceFlowError('The code expired. Start again.', 'expired_token');
      case 'access_denied':
        throw new DeviceFlowError('Access was declined.', 'access_denied');
      default:
        throw new DeviceFlowError(
          raw.error_description ?? raw.error ?? 'Sign-in failed.',
          raw.error ?? 'unknown',
        );
    }
  }

  throw new DeviceFlowError('The code expired. Start again.', 'expired_token');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DeviceFlowError('Sign-in cancelled.', 'cancelled'));
      },
      { once: true },
    );
  });
}


/**
 * Exchanges a refresh token for a fresh access token.
 *
 * GitHub rotates the refresh token on every use, so the new one must be stored
 * or the next refresh fails. Reusing a spent refresh token is treated as theft
 * by some providers and revokes the whole grant.
 */
export async function refreshAccessToken(
  config: DeviceFlowConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  const raw = await response.json().catch(() => ({ error: 'bad_response' }));
  if (!raw.access_token) {
    throw new DeviceFlowError(
      raw.error_description ?? 'The connection expired. Connect the account again.',
      raw.error ?? 'refresh_failed',
    );
  }
  return toTokenSet(raw);
}
