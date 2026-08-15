/**
 * The image pipeline: one way in, one way out.
 *
 * Every image — pasted, dropped, picked, downloaded, or exported from the
 * annotation canvas — goes through `ingestImage`, and every image is displayed
 * through `resolveImageUrl`. That split is the point:
 *
 *  - **Ingest** normalises: it validates the type, caps the size, downscales and
 *    re-encodes to WebP, and names the result by the SHA-256 of its bytes.
 *    Content addressing means identical images are stored once, and an
 *    annotated copy is a *new* object instead of an overwrite of its original.
 *
 *  - **Resolve** happens at render time, not write time. The document stores a
 *    portable reference; what URL that becomes depends on where it is being
 *    viewed. Previously the transport URL was baked into the markdown, which is
 *    why local images resolved against the filesystem root and cloud images
 *    pointed at an endpoint no `<img>` tag could authenticate to.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { getExtensionFromMime } from './imageUtils';
import type { ImageContext, ImageResult } from './imageTypes';
import { useImageStore } from './imageStore';
import { uploadAsset, digestBytes } from './cloud/cloudflareR2';

const ASSETS_DIR = '.assets';
const IMGS_DIR = `${ASSETS_DIR}/imgs`;

/** Reject anything larger than this before decoding it. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Longest edge kept when re-encoding. Enough for a retina full-width figure. */
const MAX_EDGE_PX = 2560;
const WEBP_QUALITY = 0.82;

/** Formats that must not be re-encoded: animation and vector would be destroyed. */
const PASSTHROUGH_TYPES = new Set(['image/gif', 'image/svg+xml']);

/**
 * The directory relative image references resolve against.
 *
 * Module-level because the CodeMirror image widgets are constructed deep inside
 * the extension and have no access to workspace context — the same shape as
 * `setCurrentExcalidrawDocumentId` and friends in the inline-preview extension.
 */
let imageBaseDir = '';

export function setImageBaseDir(dir: string | undefined | null) {
  imageBaseDir = dir || '';
}

function assetsDir(docDir: string): string {
  return `${docDir}/${IMGS_DIR}`;
}

async function writeFileLocal(path: string, data: Uint8Array): Promise<void> {
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
  const dir = path.substring(0, path.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
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

/**
 * Turns a stored reference into something the webview can load.
 *
 * Absolute URLs (the CDN, or a data URI) pass through. Relative references are
 * resolved against the document's directory using Tauri's own `convertFileSrc`,
 * which percent-encodes correctly — the previous implementation built
 * `https://asset.localhost/...` by string concatenation, dropped the document
 * directory entirely so every local image resolved against the filesystem root,
 * and broke outright on paths containing spaces or `#`.
 */
export function resolveImageUrl(path: string, docDir?: string): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('asset:')
  ) {
    return path;
  }

  const base = docDir || imageBaseDir;
  const cleaned = path.replace(/^file:\/\//, '');

  // Without a base directory a relative reference cannot be resolved at all.
  // Returning it unchanged renders a broken image, which is the honest outcome.
  if (!cleaned.startsWith('/') && !base) return cleaned;

  const absolute = cleaned.startsWith('/')
    ? cleaned
    : `${base.replace(/\/$/, '')}/${cleaned.replace(/^\.\//, '')}`;

  try {
    return convertFileSrc(absolute);
  } catch {
    // No Tauri bridge (tests, or a browser build): produce the same shape the
    // asset protocol would, correctly encoded.
    return `https://asset.localhost${encodeURI(absolute)}`;
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

/**
 * The single entry point for getting an image into a document.
 *
 * Returns the reference to write into the markdown: a CDN URL for cloud
 * documents, a workspace-relative path for local ones.
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
    useImageStore.getState().updateProgress(uploadId, 50);

    if (context.isCloud) {
      const stored = await uploadAsset(bytes, contentType, context.documentId);
      useImageStore.getState().updateProgress(uploadId, 100);
      return { url: stored.url, isExternal: false, isCloud: true };
    }

    const docDir = context.docDir || '';
    if (!docDir) {
      throw new Error('This document has no folder on disk yet; save it before adding images.');
    }

    // The digest is in the filename so the same image is written once, and so
    // an edited copy never overwrites its original.
    const digest = await digestBytes(bytes);
    const safeName = displayName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'image';
    const fileName = `${safeName}-${digest.slice(0, 8)}.${extension}`;
    const savePath = `${assetsDir(docDir)}/${fileName}`;

    if (!(await fileExists(savePath))) {
      await writeFileLocal(savePath, bytes);
    }

    useImageStore.getState().updateProgress(uploadId, 100);
    return {
      url: `./${IMGS_DIR}/${fileName}`,
      localPath: savePath,
      isExternal: false,
      isCloud: false,
    };
  } finally {
    useImageStore.getState().removeUpload(uploadId);
  }
}

/** Picked or pasted file. */
export async function uploadImage(file: File, context: ImageContext): Promise<ImageResult> {
  return ingestImage(file, context, file.name);
}

/**
 * Brings an image referenced by URL into the document's own storage.
 *
 * Already-ingested references (a CDN URL, or a path already under `.assets`)
 * are returned untouched — they are content-addressed and immutable, so there
 * is nothing to copy.
 */
export async function importToAssets(
  sourceUrl: string,
  context: ImageContext,
): Promise<ImageResult> {
  const alreadyStored = context.isCloud
    ? sourceUrl.startsWith('http')
    : sourceUrl.includes(`${IMGS_DIR}/`);
  if (alreadyStored) {
    return { url: sourceUrl, isExternal: false, isCloud: !!context.isCloud };
  }

  const response = await fetch(resolveImageUrl(sourceUrl, context.docDir));
  if (!response.ok) throw new Error(`Could not read image: ${response.status}`);
  const blob = await response.blob();

  const name = sourceUrl.split(/[?#]/)[0].split('/').pop() || 'image';
  return ingestImage(blob, context, name);
}

/**
 * Stores an annotated or newly drawn image.
 *
 * Always a new asset. Annotation used to derive the filename from the source
 * image and write it back to the same path, destroying the original — and
 * because the URL was unchanged, the markdown was never updated either, so the
 * edit appeared not to have applied at all. New drawings were all saved as
 * `drawing.png`, so each one replaced the last.
 */
export async function saveAnnotatedImage(
  blob: Blob,
  baseName: string,
  context: ImageContext,
): Promise<ImageResult> {
  return ingestImage(blob, context, baseName);
}
