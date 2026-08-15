/**
 * Turning a stored reference into a URL that works right now.
 *
 * Markdown holds a path, never a transport URL:
 *
 *     ![Diagram](./.assets/imgs/diagram-4f3a9c21b70e5d88.webp)
 *                               └─ slug ─┘└─── digest ────┘
 *
 * That path is the same whether the document is local, synced, personal, or on
 * a team — which is what lets a document move between them without rewriting.
 * It also has to be a path rather than a URL for a second reason: cloud reads
 * are presigned and expire, so a URL baked into the document would go stale.
 *
 * Resolution order is local file, then cache, then a presigned URL. Signing is
 * batched per document and the results are held until the signature window
 * closes, so a document with twenty images costs one authorization round trip.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { DIGEST_LENGTH, signAssets } from './cloud/assetClient';
import { cachedAssetPath } from './assetCache';

/** Matches the path portion of a markdown image reference. */
const IMAGE_REFERENCE = /!\[[^\]]*\]\(([^)\s]+)/g;

const DIGEST_IN_NAME = new RegExp(`-([0-9a-f]{${DIGEST_LENGTH}})\\.[a-z0-9]+$`);

/** Absolute paths of references known to exist on disk, keyed by reference. */
const localPaths = new Map<string, string>();
/** Presigned URLs keyed by digest, valid until `signedUntil`. */
const signedUrls = new Map<string, string>();
let signedUntil = 0;

/**
 * The directory relative references resolve against.
 *
 * Module-level because the CodeMirror image widgets are constructed deep inside
 * the extension and have no route to workspace context.
 */
let baseDir = '';

export function setImageBaseDir(dir: string | undefined | null): void {
  if ((dir || '') === baseDir) return;
  baseDir = dir || '';
  // References are relative to the document, so they mean different files now.
  localPaths.clear();
}

export function getImageBaseDir(): string {
  return baseDir;
}

/** The digest embedded in a content-addressed filename, if there is one. */
export function digestFromRef(ref: string): string | null {
  const name = ref.split(/[?#]/)[0].split('/').pop() || '';
  return DIGEST_IN_NAME.exec(name)?.[1] ?? null;
}

export function extractImageRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const match of markdown.matchAll(IMAGE_REFERENCE)) {
    if (match[1]) refs.add(match[1]);
  }
  return Array.from(refs);
}

function isAbsolute(ref: string): boolean {
  return (
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('data:') ||
    ref.startsWith('asset:')
  );
}

/** Absolute filesystem path a relative reference points at, if resolvable. */
export function absolutePathFor(ref: string, docDir?: string): string | null {
  if (isAbsolute(ref)) return null;
  const cleaned = ref.replace(/^file:\/\//, '');
  if (cleaned.startsWith('/')) return cleaned;
  const base = docDir || baseDir;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${cleaned.replace(/^\.\//, '')}`;
}

/**
 * Synchronous best-known URL for a reference.
 *
 * Called from the editor's image widgets, which cannot await. Returns an empty
 * string when nothing is known yet; `prepareAssets` fills the gap and the
 * editor re-renders.
 */
export function resolveImageUrl(ref: string, docDir?: string): string {
  if (!ref) return '';
  if (isAbsolute(ref)) return ref;

  const known = localPaths.get(ref);
  if (known) return safeConvert(known);

  const digest = digestFromRef(ref);
  if (digest && Date.now() / 1000 < signedUntil) {
    const signed = signedUrls.get(digest);
    if (signed) return signed;
  }

  // Not yet checked. Optimistically point at the local path — for local
  // documents that is the answer, and for cloud ones the widget's error
  // handler shows a placeholder until `prepareAssets` resolves it.
  const absolute = absolutePathFor(ref, docDir);
  return absolute ? safeConvert(absolute) : ref;
}

function safeConvert(absolutePath: string): string {
  try {
    return convertFileSrc(absolutePath);
  } catch {
    // No Tauri bridge (tests, browser build): same shape, correctly encoded.
    return `https://asset.localhost${encodeURI(absolutePath)}`;
  }
}

export interface PrepareOptions {
  documentId: string;
  isCloud: boolean;
  docDir?: string;
}

/**
 * Works out where each of a document's images actually lives.
 *
 * Local files win: they need no network and work offline. Anything missing
 * locally is looked up in the on-disk cache, and whatever is still missing is
 * signed in one batched call.
 *
 * @returns true when something changed and the editor should re-render.
 */
export async function prepareAssets(
  refs: string[],
  { documentId, isCloud, docDir }: PrepareOptions,
): Promise<boolean> {
  let changed = false;
  const unresolved: string[] = [];

  for (const ref of refs) {
    if (isAbsolute(ref) || localPaths.has(ref)) continue;

    const absolute = absolutePathFor(ref, docDir);
    if (absolute && (await fileExists(absolute))) {
      localPaths.set(ref, absolute);
      changed = true;
      continue;
    }

    const digest = digestFromRef(ref);
    if (!digest) continue;

    const cached = await cachedAssetPath(digest);
    if (cached) {
      localPaths.set(ref, cached);
      changed = true;
      continue;
    }

    unresolved.push(ref);
  }

  if (!isCloud || unresolved.length === 0) return changed;

  const digests = Array.from(
    new Set(unresolved.map(digestFromRef).filter((d): d is string => !!d)),
  );
  const stillValid = Date.now() / 1000 < signedUntil;
  const missing = stillValid ? digests.filter((d) => !signedUrls.has(d)) : digests;
  if (missing.length === 0) return changed;

  try {
    const { urls, expiresAt } = await signAssets(documentId, missing);
    if (!stillValid) signedUrls.clear();
    for (const [digest, url] of Object.entries(urls)) {
      signedUrls.set(digest, url);
      changed = true;
    }
    signedUntil = expiresAt;
  } catch (err) {
    console.warn('[assets] Could not authorize images for this document:', err);
  }

  return changed;
}

/** Records a freshly written asset so it resolves without a round trip. */
export function noteLocalAsset(ref: string, absolutePath: string): void {
  localPaths.set(ref, absolutePath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(path);
  } catch {
    return false;
  }
}

/** Test seam. */
export function __resetAssetResolver(): void {
  localPaths.clear();
  signedUrls.clear();
  signedUntil = 0;
  baseDir = '';
}
