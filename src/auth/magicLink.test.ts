import { afterEach, describe, expect, it, vi } from 'vitest';

const setTauri = (value: boolean) => {
  vi.doMock('../lib/env', () => ({ isTauri: value }));
};

async function load() {
  return import('./magicLink');
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('magicLinkContinueUrl', () => {
  it('returns the current page on the web', async () => {
    setTauri(false);
    const { magicLinkContinueUrl } = await load();
    expect(magicLinkContinueUrl()).toBe(
      `${window.location.protocol}//${window.location.host}${window.location.pathname}`,
    );
  });

  it('drops the query string, so account tokens are not echoed into the link', async () => {
    setTauri(false);
    window.history.replaceState({}, '', '/index.html?account_token=secret');
    const { magicLinkContinueUrl } = await load();
    expect(magicLinkContinueUrl()).not.toContain('secret');
    window.history.replaceState({}, '', '/');
  });

  it('has no usable URL in the desktop app, which Firebase would reject', async () => {
    setTauri(true);
    const { magicLinkContinueUrl } = await load();
    expect(magicLinkContinueUrl()).toBeNull();
  });

  it('uses the configured hosted URL when the desktop build has one', async () => {
    setTauri(true);
    vi.stubEnv('VITE_MAGIC_LINK_CONTINUE_URL', 'https://app.example.com/finish');
    const { magicLinkContinueUrl } = await load();
    expect(magicLinkContinueUrl()).toBe('https://app.example.com/finish');
  });
});

describe('isProbablyEmail', () => {
  it('accepts an ordinary address', async () => {
    const { isProbablyEmail } = await load();
    expect(isProbablyEmail('someone@example.com')).toBe(true);
    expect(isProbablyEmail('  someone@example.com  ')).toBe(true);
  });

  it.each(['', 'someone', 'someone@', '@example.com', 'someone@example', 'a b@example.com'])(
    'rejects %j',
    async (value) => {
      const { isProbablyEmail } = await load();
      expect(isProbablyEmail(value)).toBe(false);
    },
  );
});
