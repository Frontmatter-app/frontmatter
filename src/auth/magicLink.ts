import { isTauri } from '../lib/env';

/**
 * Where Firebase should send the user after they click an email sign-in link.
 *
 * Firebase requires this to be an http(s) URL on an authorised domain. Inside
 * the desktop webview `window.location.href` is `tauri://localhost/...`, which
 * Firebase rejects outright — so the desktop build has to be told a real hosted
 * URL to come back to. Without one, magic-link sign-in cannot work on desktop
 * and the UI should say so rather than sending a link that goes nowhere.
 */
export function magicLinkContinueUrl(): string | null {
  const configured = import.meta.env.VITE_MAGIC_LINK_CONTINUE_URL;
  if (configured) return configured;
  if (isTauri) return null;
  // On the web the app is already on an authorised domain; come back to the
  // same page without whatever query string is currently on it.
  const { protocol, host, pathname } = window.location;
  return `${protocol}//${host}${pathname}`;
}

/** Fails closed: anything this rejects, Firebase would reject too. */
export function isProbablyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
