export const isTauri: boolean =
  typeof window !== 'undefined' &&
  (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ||
   typeof (window as any).__TAURI__ !== 'undefined');
