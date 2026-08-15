import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `convertFileSrc` needs the Tauri bridge, which does not exist under vitest.
 * Stubbing it lets these tests assert what path is handed to the asset protocol
 * — which is exactly where the bug was: the document directory was dropped, so
 * every locally stored image resolved against the filesystem root.
 */
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import { resolveImageUrl, setImageBaseDir } from './imageService';

describe('resolveImageUrl', () => {
  beforeEach(() => {
    setImageBaseDir('');
  });

  it('resolves a relative reference against the document directory', () => {
    const url = resolveImageUrl('./.assets/imgs/diagram-1a2b3c4d.webp', '/Users/me/notes');

    expect(url).toBe(
      `asset://localhost/${encodeURIComponent('/Users/me/notes/.assets/imgs/diagram-1a2b3c4d.webp')}`,
    );
  });

  it('uses the ambient base directory when no explicit one is given', () => {
    setImageBaseDir('/Users/me/notes');

    expect(resolveImageUrl('./.assets/imgs/a.webp')).toContain(
      encodeURIComponent('/Users/me/notes/.assets/imgs/a.webp'),
    );
  });

  it('encodes paths containing spaces and fragments', () => {
    const url = resolveImageUrl('./.assets/imgs/my photo #2.webp', '/Users/me/my notes');

    // The whole path is handed to convertFileSrc intact; encoding is its job.
    expect(url).toBe(
      `asset://localhost/${encodeURIComponent('/Users/me/my notes/.assets/imgs/my photo #2.webp')}`,
    );
  });

  it('passes absolute URLs and data URIs through untouched', () => {
    expect(resolveImageUrl('https://cdn.example.com/assets/abc.webp')).toBe(
      'https://cdn.example.com/assets/abc.webp',
    );
    expect(resolveImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('leaves a relative reference alone when there is no base directory', () => {
    // Better a visibly broken image than one silently pointed at the root of
    // the filesystem, which is what the previous implementation produced.
    expect(resolveImageUrl('./.assets/imgs/a.webp')).toBe('./.assets/imgs/a.webp');
  });

  it('treats an absolute filesystem path as already resolved', () => {
    expect(resolveImageUrl('/tmp/a.webp', '/Users/me/notes')).toBe(
      `asset://localhost/${encodeURIComponent('/tmp/a.webp')}`,
    );
  });

  it('returns empty for an empty reference', () => {
    expect(resolveImageUrl('')).toBe('');
  });
});
