import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

const existingFiles = new Set<string>();
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => existingFiles.has(path),
}));

const cached = new Map<string, string>();
vi.mock('./assetCache', () => ({
  cachedAssetPath: async (digest: string) => cached.get(digest) ?? null,
}));

const signAssets = vi.fn();
vi.mock('./cloud/assetClient', () => ({
  DIGEST_LENGTH: 16,
  signAssets: (...args: unknown[]) => signAssets(...args),
}));

import {
  __resetAssetResolver,
  absolutePathFor,
  digestFromRef,
  extractImageRefs,
  noteLocalAsset,
  prepareAssets,
  resolveImageUrl,
  setImageBaseDir,
} from './assetResolver';

const DIGEST = '4f3a9c21b70e5d88';
const REF = `./.assets/imgs/diagram-${DIGEST}.webp`;
const DOC_DIR = '/Users/me/notes';
const ABS = `${DOC_DIR}/.assets/imgs/diagram-${DIGEST}.webp`;

beforeEach(() => {
  __resetAssetResolver();
  existingFiles.clear();
  cached.clear();
  signAssets.mockReset();
  signAssets.mockResolvedValue({ urls: {}, expiresAt: 0 });
});

describe('reference parsing', () => {
  it('extracts every distinct image reference', () => {
    const refs = extractImageRefs(
      `![a](${REF})\n[not an image](./x.webp)\n![b](https://cdn/x.webp)\n![c](${REF})`,
    );
    expect(refs).toEqual([REF, 'https://cdn/x.webp']);
  });

  it('reads the digest out of a content-addressed filename', () => {
    expect(digestFromRef(REF)).toBe(DIGEST);
    expect(digestFromRef('./images/legacy.png')).toBeNull();
    expect(digestFromRef('./.assets/imgs/short-abc.webp')).toBeNull();
  });

  it('resolves a relative reference against the document directory', () => {
    expect(absolutePathFor(REF, DOC_DIR)).toBe(ABS);
    expect(absolutePathFor('images/a.png', DOC_DIR)).toBe(`${DOC_DIR}/images/a.png`);
    expect(absolutePathFor('/tmp/a.png', DOC_DIR)).toBe('/tmp/a.png');
    expect(absolutePathFor('https://cdn/a.png', DOC_DIR)).toBeNull();
  });
});

describe('resolveImageUrl', () => {
  it('passes absolute URLs and data URIs through', () => {
    expect(resolveImageUrl('https://cdn/a.webp')).toBe('https://cdn/a.webp');
    expect(resolveImageUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
  });

  it('uses the local file once one is known', () => {
    noteLocalAsset(REF, ABS);
    expect(resolveImageUrl(REF)).toBe(`asset://localhost/${encodeURIComponent(ABS)}`);
  });

  it('falls back to the document-relative path before anything is resolved', () => {
    setImageBaseDir(DOC_DIR);
    expect(resolveImageUrl(REF)).toBe(`asset://localhost/${encodeURIComponent(ABS)}`);
  });

  it('forgets local paths when the base directory changes', () => {
    // References are document-relative, so the same string means a different
    // file once a different document is open.
    setImageBaseDir(DOC_DIR);
    noteLocalAsset(REF, ABS);
    setImageBaseDir('/Users/me/other');

    expect(resolveImageUrl(REF)).toBe(
      `asset://localhost/${encodeURIComponent(`/Users/me/other/.assets/imgs/diagram-${DIGEST}.webp`)}`,
    );
  });
});

describe('prepareAssets', () => {
  it('prefers a local file and never asks the server for it', async () => {
    existingFiles.add(ABS);

    const changed = await prepareAssets([REF], {
      documentId: 'doc1',
      isCloud: true,
      docDir: DOC_DIR,
    });

    expect(changed).toBe(true);
    expect(signAssets).not.toHaveBeenCalled();
    expect(resolveImageUrl(REF)).toContain(encodeURIComponent(ABS));
  });

  it('uses the on-disk cache before signing', async () => {
    const cachePath = `/cache/${DIGEST}.webp`;
    cached.set(DIGEST, cachePath);

    await prepareAssets([REF], { documentId: 'doc1', isCloud: true, docDir: DOC_DIR });

    expect(signAssets).not.toHaveBeenCalled();
    expect(resolveImageUrl(REF)).toContain(encodeURIComponent(cachePath));
  });

  it('signs what is missing, batched into one call', async () => {
    const second = 'aaaabbbbccccdddd';
    const refB = `./.assets/imgs/other-${second}.webp`;
    signAssets.mockResolvedValue({
      urls: { [DIGEST]: 'https://r2/signed-a', [second]: 'https://r2/signed-b' },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    await prepareAssets([REF, refB], { documentId: 'doc1', isCloud: true, docDir: DOC_DIR });

    expect(signAssets).toHaveBeenCalledTimes(1);
    expect(signAssets).toHaveBeenCalledWith('doc1', expect.arrayContaining([DIGEST, second]));
    expect(resolveImageUrl(REF)).toBe('https://r2/signed-a');
    expect(resolveImageUrl(refB)).toBe('https://r2/signed-b');
  });

  it('never signs for a local document', async () => {
    // A document with no cloud home has nothing on the server to authorize.
    await prepareAssets([REF], { documentId: 'doc1', isCloud: false, docDir: DOC_DIR });
    expect(signAssets).not.toHaveBeenCalled();
  });

  it('ignores a signature the server withheld', async () => {
    // The backend drops digests the document does not reference, and answers a
    // document the caller cannot read the same way as one that does not exist.
    signAssets.mockResolvedValue({
      urls: {},
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    await prepareAssets([REF], { documentId: 'doc1', isCloud: true, docDir: DOC_DIR });

    expect(resolveImageUrl(REF)).not.toContain('https://r2/');
  });

  it('stops using a signed URL once the window has closed', async () => {
    signAssets.mockResolvedValue({
      urls: { [DIGEST]: 'https://r2/signed' },
      expiresAt: Math.floor(Date.now() / 1000) - 1, // already expired
    });

    await prepareAssets([REF], { documentId: 'doc1', isCloud: true, docDir: DOC_DIR });

    expect(resolveImageUrl(REF)).not.toBe('https://r2/signed');
  });

  it('survives a signing failure without throwing', async () => {
    signAssets.mockRejectedValue(new Error('offline'));

    await expect(
      prepareAssets([REF], { documentId: 'doc1', isCloud: true, docDir: DOC_DIR }),
    ).resolves.toBe(false);
  });

  it('does not try to sign a reference with no digest', async () => {
    // Pre-existing images keep working through the local path; there is no
    // content address to authorize them by.
    await prepareAssets(['./images/legacy.png'], {
      documentId: 'doc1',
      isCloud: true,
      docDir: DOC_DIR,
    });

    expect(signAssets).not.toHaveBeenCalled();
  });
});
