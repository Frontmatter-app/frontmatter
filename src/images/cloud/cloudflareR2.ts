/**
 * Content-addressed asset upload.
 *
 * Assets are keyed by the SHA-256 of their bytes, which makes uploads
 * idempotent, deduplicates identical images across documents, and means an
 * annotated copy is a *new* object rather than an overwrite of the original.
 *
 * Reads do not come through here at all — objects are served from a public CDN
 * domain bound to the bucket. The previous `/r2/public/{key}` endpoint required
 * a bearer token an `<img>` tag cannot send and returned JSON rather than image
 * bytes, so cloud images could never render.
 */
import { getAuth } from 'firebase/auth';

const API_BASE = import.meta.env.VITE_R2_API_BASE_URL || '';

export interface StoredAsset {
  /** Bucket key, e.g. `assets/<sha256>.webp`. */
  key: string;
  /** Public CDN URL, safe to put straight into an `<img src>`. */
  url: string;
  digest: string;
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

/** SHA-256 of the bytes, lowercase hex — the asset's identity. */
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Uploads bytes, skipping the transfer when the bucket already holds them.
 *
 * `documentId` is what the upload is authorized against: the caller must be
 * able to write that document.
 */
export async function uploadAsset(
  bytes: Uint8Array,
  contentType: string,
  documentId: string,
): Promise<StoredAsset> {
  const base = requireBase();
  const digest = await digestBytes(bytes);
  const headers = await authHeaders();

  // Content addressing makes this safe: a hit is the same bytes by definition.
  const existing = await fetch(`${base}/assets/${digest}/exists`, { headers })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (existing?.exists) {
    return { key: existing.key, url: existing.url, digest };
  }

  const res = await fetch(`${base}/assets/${digest}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': contentType,
      'x-document-id': documentId,
    },
    body: new Blob([bytes as unknown as BlobPart], { type: contentType }),
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => body?.detail)
      .catch(() => null);
    throw new Error(detail || `Asset upload failed (${res.status}).`);
  }

  const stored = await res.json();
  return { key: stored.key, url: stored.url, digest };
}
