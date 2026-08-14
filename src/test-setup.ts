// Adds DOM matchers (toHaveAttribute, toHaveAccessibleDescription, ...) used by
// the component tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when Vitest globals are enabled. They are
// not, so unmount explicitly — otherwise each render leaks into the next test
// and queries start finding duplicates.
afterEach(() => cleanup());

// jsdom 30 does not expose Web Storage unless it is constructed with a storage
// quota, so `localStorage` is undefined here while it always exists in a real
// webview. The app persists sessions and accounts through it, so tests get a
// working in-memory implementation rather than each suite stubbing its own.
if (typeof globalThis.localStorage === 'undefined') {
  const makeStorage = (): Storage => {
    let entries = new Map<string, string>();
    return {
      get length() { return entries.size; },
      key: (index) => Array.from(entries.keys())[index] ?? null,
      getItem: (key) => (entries.has(key) ? entries.get(key)! : null),
      setItem: (key, value) => { entries.set(String(key), String(value)); },
      removeItem: (key) => { entries.delete(key); },
      clear: () => { entries = new Map(); },
    } as Storage;
  };

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const storage = makeStorage();
    Object.defineProperty(globalThis, name, { value: storage, configurable: true });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, name, { value: storage, configurable: true });
    }
  }
}
