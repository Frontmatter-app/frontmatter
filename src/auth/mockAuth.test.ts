import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_MOCK_KEY } from './mockAuth';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('clearStaleMockSession', () => {
  it('drops a mock session when mock auth is off', async () => {
    // The default test env is not a DEV build with mock auth opted in.
    localStorage.setItem(ACTIVE_MOCK_KEY, 'mock-google-1');
    const { clearStaleMockSession, MOCK_AUTH_ENABLED } = await import('./mockAuth');

    expect(MOCK_AUTH_ENABLED).toBe(false);
    clearStaleMockSession();

    expect(localStorage.getItem(ACTIVE_MOCK_KEY)).toBeNull();
  });

  it('keeps it when mock auth is explicitly enabled', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ALLOW_MOCK_AUTH', 'true');
    localStorage.setItem(ACTIVE_MOCK_KEY, 'mock-google-1');

    const { clearStaleMockSession } = await import('./mockAuth');
    clearStaleMockSession();

    expect(localStorage.getItem(ACTIVE_MOCK_KEY)).toBe('mock-google-1');
  });
});
