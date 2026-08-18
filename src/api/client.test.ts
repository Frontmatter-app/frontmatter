import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = {
  access: 'access-1' as string | null,
  refresh: 'refresh-1' as string | null,
  cleared: false,
};

vi.mock('./serverUrl', () => ({
  getServerUrl: () => 'https://sync.example.com',
}));

vi.mock('../auth/session', () => ({
  getAccessToken: () => session.access,
  getRefreshToken: () => session.refresh,
  setRefreshToken: (token: string | null) => { session.refresh = token; },
  updateAccessToken: (token: string) => { session.access = token; },
  setSession: (value: unknown) => {
    if (value === null) {
      session.cleared = true;
      session.access = null;
      session.refresh = null;
    }
  },
}));

const { apiRequest } = await import('./client');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  session.access = 'access-1';
  session.refresh = 'refresh-1';
  session.cleared = false;
  vi.restoreAllMocks();
});

describe('renewing an expired session', () => {
  it('renews and retries, so an expired hour is invisible', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/documents')).resolves.toEqual({ ok: true });

    expect(session.access).toBe('access-2');
    expect(session.refresh).toBe('refresh-2');
    expect(session.cleared).toBe(false);
  });

  it('carries the renewed token on the retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/documents');

    const retry = fetchMock.mock.calls[2];
    expect((retry[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer access-2',
    });
  });

  it('renews once for several requests failing together', async () => {
    // The bug this prevents: a document opening fires three requests, all three
    // get a 401, all three rotate the refresh token. Rotation treats a second
    // use of a spent token as theft — so the app revokes its own session and
    // signs the user out for doing nothing wrong.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      return session.access === 'access-1' ? jsonResponse({}, 401) : jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      apiRequest('/one'),
      apiRequest('/two'),
      apiRequest('/three'),
    ]);

    const renewals = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(renewals).toHaveLength(1);
    expect(session.cleared).toBe(false);
  });
});

describe('when renewal cannot help', () => {
  it('clears the session when the refresh token is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: 'expired' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/documents')).rejects.toThrow();
    expect(session.cleared).toBe(true);
  });

  it('clears the session when there is no refresh token at all', async () => {
    session.refresh = null;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/documents')).rejects.toThrow();
    expect(session.cleared).toBe(true);
    // No point asking a server to renew something we do not hold.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry more than once', async () => {
    // A server answering 401 to everything must not become an infinite loop.
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/auth/refresh')
        ? jsonResponse({ accessToken: 'access-2', refreshToken: 'refresh-2' })
        : jsonResponse({}, 401),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/documents')).rejects.toThrow();

    const attempts = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/documents'));
    expect(attempts).toHaveLength(2);
  });

  it('leaves anonymous requests alone', async () => {
    // A failed sign-in is a wrong password, not an expired session.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'bad' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/auth/jwt/login', { anonymous: true })).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.cleared).toBe(false);
  });
});
