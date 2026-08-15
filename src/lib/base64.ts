/**
 * Chunked so the intermediate string is built in slices rather than one
 * character at a time.
 *
 * This runs on every document save, over the whole encoded CRDT state, on the
 * main thread. Appending a character at a time is quadratic in practice for
 * large documents; `String.fromCharCode` over a slice is not. The chunk stays
 * well under the argument-count limit that makes `apply`-style spreading throw
 * on large inputs.
 */
const CHUNK = 0x8000;

export function uint8ToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

export function base64ToUint8(b64: string): Uint8Array {
  let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 2) normalized += '==';
  else if (padding === 3) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
