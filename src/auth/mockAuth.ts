/**
 * Gate for the local mock-account escape hatch.
 *
 * Lives in its own module because two places need the same answer: the sign-in
 * paths that may *create* a mock session, and the startup path that may
 * *restore* one. When only the former was gated, a mock account created in a
 * dev build stayed in localStorage and was restored by every later build —
 * including production — leaving the app permanently signed in as a user that
 * could never sync.
 */
export const MOCK_AUTH_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_MOCK_AUTH === 'true';

export const ACTIVE_MOCK_KEY = 'frontmatter_active_mock_id';

/** Drops a mock session left behind by a build that had mock auth enabled. */
export function clearStaleMockSession() {
  if (MOCK_AUTH_ENABLED) return;
  localStorage.removeItem(ACTIVE_MOCK_KEY);
}
