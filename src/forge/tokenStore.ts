/**
 * Forge tokens, in the operating system keychain.
 *
 * Not `localStorage`, which is where this app's session tokens have lived. A
 * forge token can push to the user's repositories, so the blast radius of it
 * leaking is their source history rather than a sync session — a different
 * class of secret deserving a different class of storage.
 *
 * Keyed by provider so connecting GitHub does not evict GitLab.
 */
import { invoke } from '../filesystem/tauriCommands';
import type { ForgeKind } from './types';
import type { TokenProvider } from './ports';

function accountKey(kind: ForgeKind): string {
  return `forge:${kind}`;
}

export async function storeToken(kind: ForgeKind, token: string): Promise<void> {
  await invoke('credential_set', { account: accountKey(kind), secret: token });
}

export async function readToken(kind: ForgeKind): Promise<string | null> {
  return (await invoke<string | null>('credential_get', { account: accountKey(kind) })) ?? null;
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
 * keychain read is an IPC round trip; on some platforms it can also prompt. It
 * is cleared on disconnect so a signed-out provider cannot keep serving a
 * cached secret.
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
