/**
 * Where the collaboration server lives.
 *
 * Resolution order, most specific first:
 *
 *   1. What the user typed in Settings. Pointing the app at your own server is
 *      a UI action, not a rebuild — that is the whole point of self-hosting.
 *   2. `VITE_SERVER_URL` from the build environment.
 *   3. Nothing. The app runs fully local: editor, workflow, prose linting, git
 *      and publishing all work with no server at all. Only collaboration and
 *      accounts need one.
 *
 * Returning `null` rather than throwing is deliberate. The previous code threw
 * `VITE_MODAL_BASE_URL is not configured` from module scope, which turned "no
 * cloud account" into a crash instead of a feature that is simply switched off.
 */

const SETTINGS_KEY = 'frontmatter_server_url';

function normalise(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** The configured server, or null when the app is running standalone. */
export function getServerUrl(): string | null {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = normalise(stored);
      if (parsed) return parsed;
    }
  } catch {
    // localStorage can be unavailable very early in startup; fall through.
  }

  const fromEnv = import.meta.env.VITE_SERVER_URL;
  return typeof fromEnv === 'string' ? normalise(fromEnv) : null;
}

export function setServerUrl(url: string | null): void {
  if (url === null || url.trim() === '') {
    localStorage.removeItem(SETTINGS_KEY);
    return;
  }
  const parsed = normalise(url);
  if (!parsed) throw new Error('Enter a full URL, for example https://sync.example.com');
  localStorage.setItem(SETTINGS_KEY, parsed);
}

export function hasServer(): boolean {
  return getServerUrl() !== null;
}

/**
 * The websocket URL for a collaboration room.
 *
 * `VITE_COLLAB_WS_URL` still wins when set, so an existing deployment that
 * splits the socket onto its own host keeps working.
 */
export function getCollabSocketUrl(): string | null {
  const explicit = import.meta.env.VITE_COLLAB_WS_URL;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, '');
  }

  const base = getServerUrl();
  if (!base) return null;
  return `${base.replace(/^http/, 'ws')}/collab`;
}
