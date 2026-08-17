/**
 * Connecting and disconnecting a git provider.
 *
 * Holds the device-flow state machine so the panel stays a rendering concern.
 * Two things are deliberate:
 *
 * **The token never enters React state.** It goes from the poll straight to the
 * keychain, and the account is read back through the adapter. Putting it in
 * state would leak it into React DevTools and any error reporter that
 * serialises component trees.
 *
 * **Disconnecting clears the cached token as well as the stored one.** The
 * keychain reader caches for thirty seconds to avoid an IPC round trip per
 * call; without an explicit clear, a disconnected provider would keep working
 * until that expired.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../filesystem/tauriCommands';
import {
  DeviceFlowError,
  GITHUB_DEVICE_FLOW,
  GITLAB_DEVICE_FLOW,
  pollForToken,
  requestDeviceCode,
  type DeviceCodeGrant,
  type DeviceFlowConfig,
} from './deviceFlow';
import { GitHubForge } from './github';
import { forgetToken, isConnected, keychainTokens, storeTokenSet } from "./tokenStore";
import type { ForgePort } from './ports';
import type { ForgeAccount, ForgeKind } from './types';

export type ConnectionStatus =
  | 'checking'
  | 'disconnected'
  | 'awaitingUser'
  | 'connecting'
  | 'connected'
  | 'error';

const CONFIGS: Record<ForgeKind, DeviceFlowConfig | null> = {
  github: GITHUB_DEVICE_FLOW,
  gitlab: GITLAB_DEVICE_FLOW,
  gitea: null,
};

export function forgeFor(kind: ForgeKind): ForgePort {
  // Only GitHub has an adapter so far. Returning a GitLab-shaped GitHub client
  // would fail confusingly at the first request, so this refuses up front.
  if (kind !== 'github') {
    throw new Error(`No adapter for ${kind} yet.`);
  }
  return new GitHubForge(keychainTokens(kind));
}

export function useForgeConnection(kind: ForgeKind = 'github') {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [account, setAccount] = useState<ForgeAccount | null>(null);
  const [grant, setGrant] = useState<DeviceCodeGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const tokensRef = useRef(keychainTokens(kind));

  const loadAccount = useCallback(async () => {
    if (!(await isConnected(kind))) {
      setStatus('disconnected');
      setAccount(null);
      return;
    }
    try {
      const resolved = await forgeFor(kind).getAccount();
      if (resolved) {
        setAccount(resolved);
        setStatus('connected');
      } else {
        // A stored token the provider no longer accepts — revoked, expired, or
        // from a deleted OAuth app. Presenting this as "connected" would mean
        // every later action failed for no visible reason.
        setStatus('disconnected');
        setAccount(null);
        setError('The stored connection is no longer valid. Connect again.');
      }
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not reach the provider.');
    }
  }, [kind]);

  useEffect(() => {
    void loadAccount();
    return () => abortRef.current?.abort();
  }, [loadAccount]);

  const connect = useCallback(async () => {
    const config = CONFIGS[kind];
    if (!config) {
      setStatus('error');
      setError(`${kind} is not supported yet.`);
      return;
    }

    setError(null);
    setStatus('connecting');

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const issued = await requestDeviceCode(config);
      setGrant(issued);
      setSecondsLeft(issued.expiresIn);
      setStatus('awaitingUser');

      // Opened in the system browser rather than a webview: the user is signing
      // in to their git provider, and they should be doing that somewhere they
      // can see the address bar and their existing session.
      await invoke('open_browser_url', { url: issued.verificationUri }).catch(() => {
        // Not fatal — the panel shows the URL to open by hand.
      });

      const token = await pollForToken(config, issued, {
        signal: controller.signal,
        onTick: setSecondsLeft,
      });

      // Straight to the keychain. Never into state.
      await storeTokenSet(kind, token);
      tokensRef.current.clear();

      setGrant(null);
      setSecondsLeft(null);
      await loadAccount();
    } catch (cause) {
      if (cause instanceof DeviceFlowError && cause.code === 'cancelled') {
        setStatus('disconnected');
        setGrant(null);
        return;
      }
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not connect.');
      setGrant(null);
    }
  }, [kind, loadAccount]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGrant(null);
    setSecondsLeft(null);
    setStatus('disconnected');
  }, []);

  const disconnect = useCallback(async () => {
    await forgetToken(kind);
    tokensRef.current.clear();
    setAccount(null);
    setGrant(null);
    setError(null);
    setStatus('disconnected');
  }, [kind]);

  return { status, account, grant, error, secondsLeft, connect, cancel, disconnect, refresh: loadAccount };
}
