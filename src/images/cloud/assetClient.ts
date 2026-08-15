/**
 * Talking to the asset store.
 *
 * Assets are keyed by a prefix of the SHA-256 of their bytes, which makes
 * uploads idempotent, deduplicates identical images, and means an annotated
 * copy is a new object rather than an overwrite of its original.
 *
 * Reads are authorized, not public: the bucket is private and the backend hands
 * out short-lived presigned URLs only for assets the caller's document actually
 * references. A public CDN would have meant anyone holding a URL kept access
 * indefinitely, and removing someone from a team would not have revoked the
 * images they had already loaded.
 */
import { getAuth } from 'firebase/auth';

const API_BASE = import.meta.env.VITE_R2_API_BASE_URL || '';

/**
 * 64 bits of the digest. Short enough to sit in a filename without making the
 * markdown unreadable, wide enough that a collision is not a practical concern.
 * Must match `DIGEST_LENGTH` in the backend.
 */
export const DIGEST_LENGTH = 16;

export interface SignedAssets {
  urls: Record<string, string>;
  /** Unix seconds. The backend signs against window boundaries, so a URL is
   *  byte-identical for every caller within the window and stays cacheable. */
  expiresAt: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

function requireBase(): string {
  if (!API_BASE) throw new Error('VITE_R2_API_BASE_URL is not configured.');
  return API_BASE.replace(/\/$/, '');
}

/** The asset's identity: the leading hex of its SHA-256. */
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, DIGEST_LENGTH);
}

/**
 * Uploads bytes, skipping the transfer when the store already holds them.
 *
 * `documentId` is what the upload is authorized against — the caller must be
 * able to write that document.
 */
export async function uploadAsset(
  bytes: Uint8Array,
  contentType: string,
  documentId: string,
  digest: string,
): Promise<void> {
  const base = requireBase();
  const headers = await authHeaders();

  // Content addressing makes this safe: a hit is the same bytes by definition.
  const existing = await fetch(`${base}/assets/${digest}/exists`, { headers })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (existing?.exists) return;

  const res = await fetch(`${base}/assets/${digest}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': contentType, 'x-document-id': documentId },
    body: new Blob([bytes as unknown as BlobPart], { type: contentType }),
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => body?.detail)
      .catch(() => null);
    throw new Error(detail || `Asset upload failed (${res.status}).`);
  }
}

/**
 * Presigned reads for the assets one document uses.
 *
 * Batched on purpose: a document with twenty images costs one round trip and
 * one authorization decision, not twenty.
 */
export async function signAssets(
  documentId: string,
  digests: string[],
): Promise<SignedAssets> {
  if (digests.length === 0) return { urls: {}, expiresAt: 0 };

  const base = requireBase();
  const headers = await authHeaders();

  const res = await fetch(`${base}/assets/sign`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, digests }),
  });

  if (!res.ok) {
    // A document the caller cannot read answers the same way as one that does
    // not exist, so there is nothing to distinguish here either.
    throw new Error(`Could not authorize images for this document (${res.status}).`);
  }
  return (await res.json()) as SignedAssets;
}
