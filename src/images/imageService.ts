/**
 * The image pipeline: one way in, one way out.
 *
 * Every image — pasted, dropped, picked, downloaded, or exported from the
 * annotation canvas — goes through `ingestImage`, and every image is displayed
 * through `resolveImageUrl`. That split is the point:
 *
 *  - **Ingest** normalises: it validates the type, caps the size, downscales and
 *    re-encodes to WebP, and names the result by a prefix of the SHA-256 of its
 *    bytes. Identical images are stored once, and an annotated copy is a *new*
 *    file instead of an overwrite of its original.
 *
 *  - **Resolve** happens at render time, not write time, and lives in
 *    `assetResolver`. The document stores a path; what URL that becomes depends
 *    on where it is being viewed.
 *
 * Bytes follow the document's homes: a document with a folder on disk keeps its
 * images beside it, a cloud-backed document uploads them, and one that is both
 * does both. The reference written into the markdown is identical either way,
 * which is what lets a document move between local, personal, and team without
 * anything being rewritten.
 */
import { getExtensionFromMime } from './imageUtils';
import type { ImageContext, ImageResult } from './imageTypes';
import { useImageStore } from './imageStore';
import { uploadAsset, digestBytes } from './cloud/assetClient';
import { noteLocalAsset } from './assetResolver';

const ASSETS_DIR = '.assets';
const IMGS_DIR = `${ASSETS_DIR}/imgs`;

/** Reject anything larger than this before decoding it. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Longest edge kept when re-encoding. Enough for a retina full-width figure. */
const MAX_EDGE_PX = 2560;
const WEBP_QUALITY = 0.82;

/** Formats that must not be re-encoded: animation and vector would be destroyed. */
const PASSTHROUGH_TYPES = new Set(['image/gif', 'image/svg+xml']);

export { resolveImageUrl, setImageBaseDir } from './assetResolver';

function assetsDir(docDir: string): string {
  return `${docDir}/${IMGS_DIR}`;
}

async function writeFileLocal(path: string, data: Uint8Array): Promise<void> {
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
  await mkdir(path.substring(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, data);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(path);
  } catch {
    return false;
  }
}

interface NormalisedImage {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

/**
 * Downscales and re-encodes to WebP, leaving animated and vector formats alone.
 *
 * Falls back to the original bytes whenever the browser cannot decode the
 * image — a slightly larger upload is far better than a failed one.
 */
async function normalise(blob: Blob): Promise<NormalisedImage> {
  const original = new Uint8Array(await blob.arrayBuffer());
  const type = blob.type || 'image/png';

  if (PASSTHROUGH_TYPES.has(type) || typeof createImageBitmap !== 'function') {
    return { bytes: original, contentType: type, extension: getExtensionFromMime(type) };
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });

    const ctx = (canvas as OffscreenCanvas).getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const encoded =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY })
        : await new Promise<Blob | null>((resolve) =>
            (canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', WEBP_QUALITY),
          );
    if (!encoded) throw new Error('encode failed');

    // Re-encoding is not always a win — a small PNG can grow as WebP.
    const reencoded = new Uint8Array(await encoded.arrayBuffer());
    if (reencoded.byteLength >= original.byteLength && scale === 1) {
      return { bytes: original, contentType: type, extension: getExtensionFromMime(type) };
    }
    return { bytes: reencoded, contentType: 'image/webp', extension: 'webp' };
  } catch {
    return { bytes: original, contentType: type, extension: getExtensionFromMime(type) };
  }
}

/** `<slug>-<digest>.<ext>` — the filename is the content address. */
export function assetFileName(displayName: string, digest: string, extension: string): string {
  const slug = displayName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'image';
  return `${slug.slice(0, 40)}-${digest}.${extension}`;
}

/**
 * The single entry point for getting an image into a document.
 *
 * Always returns the same document-relative reference, whatever the document's
 * storage happens to be.
 */
export async function ingestImage(
  source: Blob,
  context: ImageContext,
  displayName = 'image',
): Promise<ImageResult> {
  if (source.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `That image is ${(source.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_SOURCE_BYTES / 1024 / 1024}MB.`,
    );
  }

  const uploadId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  useImageStore.getState().enqueueUpload(uploadId, displayName, source.size);

  try {
    const { bytes, contentType, extension } = await normalise(source);
    useImageStore.getState().updateProgress(uploadId, 40);

    const digest = await digestBytes(bytes);
    const fileName = assetFileName(displayName, digest, extension);
    const reference = `./${IMGS_DIR}/${fileName}`;

    // A document with a folder keeps its own copy: no network to view it, and
    // it stays readable by anything else that opens the file.
    let localPath: string | undefined;
    if (context.docDir) {
      localPath = `${assetsDir(context.docDir)}/${fileName}`;
      if (!(await fileExists(localPath))) {
        await writeFileLocal(localPath, bytes);
      }
      noteLocalAsset(reference, localPath);
    }

    useImageStore.getState().updateProgress(uploadId, 70);

    if (context.isCloud) {
      await uploadAsset(bytes, contentType, context.documentId, digest);
    }

    if (!context.docDir && !context.isCloud) {
      throw new Error('This document has nowhere to keep images yet; save it first.');
    }

    useImageStore.getState().updateProgress(uploadId, 100);
    return { url: reference, localPath, isExternal: false, isCloud: !!context.isCloud, digest };
  } finally {
    useImageStore.getState().removeUpload(uploadId);
  }
}

/** Picked, pasted, or dropped file. */
export async function uploadImage(file: File, context: ImageContext): Promise<ImageResult> {
  return ingestImage(file, context, file.name);
}

/**
 * Brings an image referenced by URL into the document's own storage.
 *
 * Already-ingested references are returned untouched — they are
 * content-addressed and immutable, so there is nothing to copy.
 */
export async function importToAssets(
  sourceUrl: string,
  context: ImageContext,
): Promise<ImageResult> {
  if (sourceUrl.includes(`${IMGS_DIR}/`)) {
    return { url: sourceUrl, isExternal: false, isCloud: !!context.isCloud };
  }

  const { resolveImageUrl } = await import('./assetResolver');
  const response = await fetch(resolveImageUrl(sourceUrl, context.docDir));
  if (!response.ok) throw new Error(`Could not read image: ${response.status}`);

  const name = sourceUrl.split(/[?#]/)[0].split('/').pop() || 'image';
  return ingestImage(await response.blob(), context, name);
}

/**
 * Stores an annotated or newly drawn image.
 *
 * Always a new asset. Annotation used to derive the filename from the source
 * image and write it back to the same path, destroying the original — and
 * because the URL was unchanged, the markdown was never updated either, so the
 * edit appeared not to have applied at all.
 */
export async function saveAnnotatedImage(
  blob: Blob,
  baseName: string,
  context: ImageContext,
): Promise<ImageResult> {
  return ingestImage(blob, context, baseName);
}
