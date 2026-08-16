/**
 * Content-addressed assets.
 *
 * Images used to be uploaded to a Cloudflare R2 bucket through the backend and
 * read back through presigned URLs. That is gone, and its replacement is not
 * another bucket: **an image is a file in your git repository**, committed
 * alongside the markdown that references it. That arrives with git-backed
 * rooms.
 *
 * Removing the bucket removes a paid dependency from self-hosting, and it means
 * a cloned repository carries its own images rather than pointing at URLs that
 * expire or that a reader has no credentials for.
 *
 * The addressing scheme is unchanged and still local: an asset is identified by
 * the leading hex of its SHA-256, which is what makes deduplication and the
 * `-<digest>.<ext>` filename convention work. Only the transfer is gone.
 */

/** Characters of SHA-256 hex used to identify an asset. */
export const DIGEST_LENGTH = 16;

export interface SignedAssets {
  urls: Record<string, string>;
  expiresAt: number;
}

/** The asset's identity: the leading hex of its SHA-256. Purely local. */
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, DIGEST_LENGTH);
}

export async function uploadAsset(
  _bytes: Uint8Array,
  _contentType: string,
  _documentId: string,
  _digest: string,
): Promise<void> {
  // Throws rather than no-oping: an image the user believes was saved but was
  // not is worse than an error they can see.
  throw new Error(
    'Remote image storage has been removed. Images will be committed to your repository instead.',
  );
}

/**
 * Resolves to no URLs. Callers treat a missing entry as "not remotely
 * available" and fall back to the local copy, so an empty map degrades to
 * local-only rather than to an error.
 */
export async function signAssets(
  _documentId: string,
  _digests: string[],
): Promise<SignedAssets> {
  return { urls: {}, expiresAt: 0 };
}
