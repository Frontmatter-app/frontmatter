import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The device flow runs through the native side, because the provider's OAuth
// endpoints send no CORS headers and a webview fetch is blocked before the
// request ever leaves. The seam under test is therefore `invoke`, not `fetch`.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../filesystem/tauriCommands', () => ({ invoke }));

import {
  DeviceFlowError,
  GITHUB_DEVICE_FLOW,
  pollForToken,
  refreshAccessToken,
  requestDeviceCode,
  type DeviceCodeGrant,
  type DeviceFlowConfig,
} from './deviceFlow';

const config: DeviceFlowConfig = {
  kind: 'github',
  clientId: 'test-client',
  deviceCodeUrl: 'https://example.test/device/code',
  tokenUrl: 'https://example.test/oauth/token',
  scope: 'repo',
};

const grant: DeviceCodeGrant = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://example.test/device',
  deviceCode: 'device-code',
  expiresIn: 60,
  // Zero so the tests do not actually wait.
  interval: 0,
};

beforeEach(() => invoke.mockReset());
afterEach(() => vi.clearAllMocks());

describe('requestDeviceCode', () => {
  it('returns the code to show the user', async () => {
    invoke.mockResolvedValueOnce({
      userCode: 'WXYZ-9876',
      verificationUri: 'https://example.test/device',
      deviceCode: 'dc',
      expiresIn: 900,
      interval: 5,
    });

    const result = await requestDeviceCode(config);
    expect(result.userCode).toBe('WXYZ-9876');
    expect(invoke).toHaveBeenCalledWith('forge_device_code', {
      deviceCodeUrl: config.deviceCodeUrl,
      clientId: config.clientId,
      scope: config.scope,
    });
  });

  it('refuses to start with no client id, before reaching the network', async () => {
    await expect(requestDeviceCode({ ...config, clientId: '' })).rejects.toBeInstanceOf(
      DeviceFlowError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces a provider error', async () => {
    invoke.mockRejectedValueOnce('Device flow is not enabled');
    await expect(requestDeviceCode(config)).rejects.toThrow(/Device flow is not enabled/);
  });
});

describe('pollForToken', () => {
  it('returns the token once the user authorises', async () => {
    invoke.mockResolvedValueOnce({ accessToken: 'gho_token', refreshToken: null, expiresIn: null });
    await expect(pollForToken(config, grant)).resolves.toMatchObject({ accessToken: 'gho_token' });
  });

  it('keeps polling while the native side reports "not yet"', async () => {
    // null is the normal state for most of this loop: the native side folds
    // authorization_pending and slow_down into it, because both mean keep
    // waiting. Treating either as an error would abort every sign-in that is
    // not instantaneous — which is all of them.
    invoke
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: 'gho_token', refreshToken: null, expiresIn: null });

    await expect(pollForToken(config, grant)).resolves.toMatchObject({ accessToken: 'gho_token' });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('reports an expired code', async () => {
    invoke.mockRejectedValueOnce('expired_token');
    await expect(pollForToken(config, grant)).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('reports a declined authorisation', async () => {
    invoke.mockRejectedValueOnce('access_denied');
    await expect(pollForToken(config, grant)).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('gives up on an unrecognised failure rather than looping', async () => {
    invoke.mockRejectedValueOnce('incorrect_client_credentials');
    await expect(pollForToken(config, grant)).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it('stops when the caller aborts', async () => {
    invoke.mockResolvedValue(null);
    const controller = new AbortController();
    controller.abort();
    await expect(pollForToken(config, grant, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('stops once the grant lifetime has elapsed', async () => {
    invoke.mockResolvedValue(null);
    await expect(pollForToken(config, { ...grant, expiresIn: -1 })).rejects.toMatchObject({
      code: 'expired_token',
    });
  });
});

describe('token sets', () => {
  it('captures the refresh token and expiry', async () => {
    // The bug this exists for: an earlier version kept only the access token,
    // so a provider with expiration enabled worked for eight hours and then
    // failed for everybody, with reconnecting by hand as the only way back.
    invoke.mockResolvedValueOnce({
      accessToken: 'gho_a',
      refreshToken: 'ghr_b',
      expiresIn: 28800,
    });

    const tokens = await pollForToken(config, grant);
    expect(tokens.refreshToken).toBe('ghr_b');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('treats a token with no expiry as non-expiring', async () => {
    invoke.mockResolvedValueOnce({ accessToken: 'gho_a', refreshToken: null, expiresIn: null });
    expect((await pollForToken(config, grant)).expiresAt).toBeNull();
  });

  it('expires slightly early, so an in-flight request cannot outlive the token', async () => {
    invoke.mockResolvedValueOnce({ accessToken: 'gho_a', refreshToken: null, expiresIn: 3600 });
    const tokens = await pollForToken(config, grant);
    expect(tokens.expiresAt!).toBeLessThan(Date.now() + 3600 * 1000);
  });
});

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for a new set', async () => {
    invoke.mockResolvedValueOnce({
      accessToken: 'gho_new',
      refreshToken: 'ghr_new',
      expiresIn: 28800,
    });

    const tokens = await refreshAccessToken(config, 'ghr_old');
    expect(tokens.accessToken).toBe('gho_new');
    // GitHub rotates the refresh token on every use, so the new one must be
    // carried through — reusing a spent one revokes the whole grant.
    expect(tokens.refreshToken).toBe('ghr_new');
  });

  it('reports a spent refresh token as needing reconnection', async () => {
    invoke.mockRejectedValueOnce('bad_refresh_token');
    await expect(refreshAccessToken(config, 'ghr_old')).rejects.toBeInstanceOf(DeviceFlowError);
  });
});

describe('shipped GitHub configuration', () => {
  it('carries a client id, so the app connects without configuration', () => {
    expect(GITHUB_DEVICE_FLOW.clientId).toBeTruthy();
  });

  it('requests the scopes committing actually needs', () => {
    // `repo` covers private repositories; without it committing fails only for
    // some users, which is a miserable bug to diagnose.
    expect(GITHUB_DEVICE_FLOW.scope).toContain('repo');
    expect(GITHUB_DEVICE_FLOW.scope).toContain('read:user');
  });
});
