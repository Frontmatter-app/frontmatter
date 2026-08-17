import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceFlowError,
  refreshAccessToken,
  GITHUB_DEVICE_FLOW,
  pollForToken,
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
  // Zero so the tests do not actually wait; the interval arithmetic is
  // asserted separately.
  interval: 0,
};

function respondWith(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestDeviceCode', () => {
  it('returns the code to show the user', async () => {
    respondWith({
      device_code: 'dc',
      user_code: 'WXYZ-9876',
      verification_uri: 'https://example.test/device',
      expires_in: 900,
      interval: 5,
    });

    const result = await requestDeviceCode(config);
    expect(result.userCode).toBe('WXYZ-9876');
    expect(result.deviceCode).toBe('dc');
    expect(result.interval).toBe(5);
  });

  it('defaults the interval to five seconds when the provider omits it', async () => {
    // Polling faster than the provider allows earns a slow_down, so an absent
    // interval must not become zero.
    respondWith({ device_code: 'dc', user_code: 'X', verification_uri: 'u', expires_in: 900 });
    expect((await requestDeviceCode(config)).interval).toBe(5);
  });

  it('refuses to start with no client id, before any network call', async () => {
    const fetchMock = respondWith({});
    await expect(requestDeviceCode({ ...config, clientId: '' })).rejects.toBeInstanceOf(
      DeviceFlowError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a provider error', async () => {
    respondWith({ error: 'device_flow_disabled', error_description: 'Device flow is not enabled' });
    await expect(requestDeviceCode(config)).rejects.toThrow('Device flow is not enabled');
  });
});

describe('pollForToken', () => {
  it('returns the token once the user authorises', async () => {
    respondWith({ access_token: 'gho_token' });
    await expect(pollForToken(config, grant)).resolves.toMatchObject({ accessToken: 'gho_token' });
  });

  it('keeps polling through authorization_pending', async () => {
    // The normal state for most of the loop — not an error, and treating it as
    // one would abort every sign-in that is not instantaneous.
    const fetchMock = respondWith(
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'gho_token' },
    );
    await expect(pollForToken(config, grant)).resolves.toMatchObject({ accessToken: 'gho_token' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through slow_down', async () => {
    const fetchMock = respondWith({ error: 'slow_down', interval: 0 }, { access_token: 'tok' });
    await expect(pollForToken(config, grant)).resolves.toMatchObject({ accessToken: 'tok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up when the code expires', async () => {
    respondWith({ error: 'expired_token' });
    await expect(pollForToken(config, grant)).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('gives up when the user declines', async () => {
    respondWith({ error: 'access_denied' });
    await expect(pollForToken(config, grant)).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('gives up on an unrecognised error rather than looping forever', async () => {
    respondWith({ error: 'incorrect_client_credentials' });
    await expect(pollForToken(config, grant)).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it('stops when the caller aborts', async () => {
    respondWith({ error: 'authorization_pending' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollForToken(config, grant, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('stops once the grant lifetime has elapsed', async () => {
    respondWith({ error: 'authorization_pending' });
    await expect(
      pollForToken(config, { ...grant, expiresIn: -1 }),
    ).rejects.toMatchObject({ code: 'expired_token' });
  });
});

describe('shipped GitHub configuration', () => {
  it('carries a client id, so the app connects without configuration', () => {
    // Public by construction in this grant: sent unauthenticated to start every
    // sign-in, with no accompanying secret.
    expect(GITHUB_DEVICE_FLOW.clientId).toBeTruthy();
  });

  it('requests the scopes committing actually needs', () => {
    // `repo` covers private repositories; without it, committing fails only for
    // some users, which is a miserable bug to diagnose.
    expect(GITHUB_DEVICE_FLOW.scope).toContain('repo');
    expect(GITHUB_DEVICE_FLOW.scope).toContain('read:user');
  });
});

describe('token sets', () => {
  it('captures the refresh token and expiry the provider issues', async () => {
    // The bug this exists for: an earlier version returned only the access
    // token, so a provider with expiration enabled worked for eight hours and
    // then failed for everybody with no way back but reconnecting by hand.
    respondWith({ access_token: 'gho_a', refresh_token: 'ghr_b', expires_in: 28800 });
    const tokens = await pollForToken(config, grant);
    expect(tokens.accessToken).toBe('gho_a');
    expect(tokens.refreshToken).toBe('ghr_b');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('treats a token with no expiry as non-expiring', async () => {
    respondWith({ access_token: 'gho_a' });
    const tokens = await pollForToken(config, grant);
    expect(tokens.expiresAt).toBeNull();
    expect(tokens.refreshToken).toBeNull();
  });

  it('expires slightly early, so an in-flight request cannot outlive the token', async () => {
    respondWith({ access_token: 'gho_a', expires_in: 3600 });
    const tokens = await pollForToken(config, grant);
    expect(tokens.expiresAt!).toBeLessThan(Date.now() + 3600 * 1000);
  });
});

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for a new set', async () => {
    respondWith({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 });
    const tokens = await refreshAccessToken(config, 'ghr_old');
    expect(tokens.accessToken).toBe('gho_new');
    // GitHub rotates the refresh token on every use, so the new one must be
    // carried through — reusing a spent one revokes the whole grant.
    expect(tokens.refreshToken).toBe('ghr_new');
  });

  it('reports a spent refresh token as needing reconnection', async () => {
    respondWith({ error: 'bad_refresh_token', error_description: 'expired' });
    await expect(refreshAccessToken(config, 'ghr_old')).rejects.toBeInstanceOf(DeviceFlowError);
  });
});
