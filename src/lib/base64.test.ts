import { describe, expect, it } from 'vitest';
import { uint8ToBase64, base64ToUint8 } from './base64';

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([255, 0, 128, 64]),
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
    ]) {
      expect(base64ToUint8(uint8ToBase64(bytes))).toEqual(bytes);
    }
  });

  it('handles payloads larger than one chunk', () => {
    // Encoded CRDT state for a real document runs to hundreds of kilobytes, and
    // the chunking must not corrupt or truncate at a boundary.
    const bytes = new Uint8Array(0x8000 * 2 + 1234);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const restored = base64ToUint8(uint8ToBase64(bytes));

    expect(restored.length).toBe(bytes.length);
    expect(restored).toEqual(bytes);
  });

  it('produces standard base64', () => {
    expect(uint8ToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  });

  it('accepts the url-safe alphabet when decoding', () => {
    const bytes = new Uint8Array([251, 255, 190]);
    const urlSafe = uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_');

    expect(base64ToUint8(urlSafe)).toEqual(bytes);
  });
});
