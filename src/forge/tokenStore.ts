/**
 * Forge tokens, in the operating system keychain.
 *
 * Not `localStorage`, which is where this app's session tokens live. A forge
 * token can push to the user's repositories, so the blast radius of it leaking
 * is their source history rather than a sync session — a different class of
 * secret deserving a different class of storage.
 *
 * The whole token set is stored, not just the access token. GitHub OAuth apps
 * can be configured to expire tokens after eight hours and issue a refresh
 * token alongside; keeping only the access token means the connection works for
 * one session and then fails for everybody, with reconnecting by hand as the
 * only way back. Refresh happens transparently in `keychainTokens`.
 *
 * Keyed by provider so connecting GitHub does not evict GitLab.
 */
import { invoke } from '../filesystem/tauriCommands';
import {
  GITHUB_DEVICE_FLOW,
  GITLAB_DEVICE_FLOW,
  refreshAccessToken,
  type DeviceFlowConfig,
  type TokenSet,
} from './deviceFlow';
import type { ForgeKind } from './types';
import type { TokenProvider } from './ports';

function accountKey(kind: ForgeKind): string {
  return `forge:${kind}`;
}

function configFor(kind: ForgeKind): DeviceFlowConfig | null {
  if (kind === 'github') return GITHUB_DEVICE_FLOW;
  if (kind === 'gitlab') return GITLAB_DEVICE_FLOW;
  return null;
}

export async function storeTokenSet(kind: ForgeKind, tokens: TokenSet): Promise<void> {
  await invoke('credential_set', {
    account: accountKey(kind),
    secret: JSON.stringify(tokens),
  });
}

export async function readTokenSet(kind: ForgeKind): Promise<TokenSet | null> {
  const raw = await invoke<string | null>('credential_get', { account: accountKey(kind) });
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accessToken === 'string') return parsed as TokenSet;
  } catch {
    // Not JSON. An older build stored the bare access token, so treat the
    // whole value as one rather than making the user reconnect.
  }
  return { accessToken: raw, refreshToken: null, expiresAt: null };
}

/**
 * A usable access token, refreshed if it has expired.
 *
 * Returns null when there is no connection, or when the refresh token is spent
 * — the caller's correct response to both is to ask the user to connect.
 */
export async function readToken(kind: ForgeKind): Promise<string | null> {
  const stored = await readTokenSet(kind);
  if (!stored) return null;

  const expired = stored.expiresAt !== null && Date.now() >= stored.expiresAt;
  if (!expired) return stored.accessToken;

  const config = configFor(kind);
  if (!config || !stored.refreshToken) {
    // Expired with no way to renew. Clear it so the UI reports a disconnected
    // provider rather than one that fails every request.
    await forgetToken(kind);
    return null;
  }

  try {
    const renewed = await refreshAccessToken(config, stored.refreshToken);
    // GitHub rotates the refresh token on every use, so the new set must be
    // stored — reusing a spent refresh token revokes the whole grant.
    await storeTokenSet(kind, renewed);
    return renewed.accessToken;
  } catch {
    await forgetToken(kind);
    return null;
  }
}

export async function forgetToken(kind: ForgeKind): Promise<void> {
  await invoke('credential_delete', { account: accountKey(kind) });
}

/** Whether a provider is connected, without pulling the secret into the webview. */
export async function isConnected(kind: ForgeKind): Promise<boolean> {
  return (await invoke<boolean>('credential_exists', { account: accountKey(kind) })) ?? false;
}

/**
 * A `TokenProvider` reading from the keychain, with a short-lived cache.
 *
 * The cache exists because a single screen can issue many forge calls and each
 * keychain read is an IPC round trip. It is deliberately shorter than any token
 * lifetime, so a refresh is never bypassed, and is cleared on disconnect so a
 * signed-out provider cannot keep serving a cached secret.
 */
export function keychainTokens(kind: ForgeKind): TokenProvider & { clear(): void } {
  let cached: string | null = null;
  let readAt = 0;
  const TTL_MS = 30_000;

  return {
    async getToken() {
      const now = Date.now();
      if (cached !== null && now - readAt < TTL_MS) return cached;
      cached = await readToken(kind);
      readAt = now;
      return cached;
    },
    clear() {
      cached = null;
      readAt = 0;
    },
  };
}
