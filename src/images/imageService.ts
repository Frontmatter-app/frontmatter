import { isLocalPath, getImageBaseName, getExtensionFromMime } from './imageUtils';
import type { ImageContext, ImageResult } from './imageTypes';
import { useImageStore } from './imageStore';

const ASSETS_DIR = '.assets';
const IMGS_DIR = `${ASSETS_DIR}/imgs`;

function getDocDir(context: ImageContext): string {
  return context.docDir || '';
}

async function writeFileLocal(path: string, data: Uint8Array): Promise<void> {
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
  const dir = path.substring(0, path.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(path, data);
}

async function readFileLocal(path: string): Promise<Uint8Array | null> {
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return await readFile(path);
  } catch {
    return null;
  }
}

function assetsDir(docDir: string): string {
  return `${docDir}/${IMGS_DIR}`;
}
function r2PublicUrl(r2Key: string): string {
  const base = import.meta.env.VITE_R2_API_BASE_URL || '';
  return `${base}/public/${encodeURIComponent(r2Key)}`;
}

function isR2Url(url: string): boolean {
  return url.includes('/r2/public/');
}

export function resolveImageUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }
  const cleanPath = path.replace('file://', '').replace(/^\.\//, '/');
  return `https://asset.localhost${cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath}`;
}

export async function uploadImage(
  file: File,
  context: ImageContext
): Promise<ImageResult> {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  useImageStore.getState().enqueueUpload(id, file.name, file.size);

  const ext = getExtensionFromMime(file.type);
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'uploaded';
  const fileName = `${baseName}-${Date.now()}.${ext}`;

  try {
    useImageStore.getState().updateProgress(id, 50);

    if (context.isCloud) {
      const { uploadToR2 } = await import('./cloud/cloudflareR2');
      const arrayBuffer = await file.arrayBuffer();
      const r2Key = `${context.documentId}/${fileName}`;
      await uploadToR2(r2Key, new Uint8Array(arrayBuffer), file.type, context.teamId || '');

      useImageStore.getState().updateProgress(id, 100);
      useImageStore.getState().removeUpload(id);
      return { url: r2PublicUrl(r2Key), isExternal: false, isCloud: true };
    }

    const docDir = getDocDir(context);
    const savePath = `${assetsDir(docDir)}/${fileName}`;
    const arrayBuffer = await file.arrayBuffer();
    await writeFileLocal(savePath, new Uint8Array(arrayBuffer));

    useImageStore.getState().updateProgress(id, 100);
    useImageStore.getState().removeUpload(id);
    return { url: `./${IMGS_DIR}/${fileName}`, localPath: savePath, isExternal: false, isCloud: false };
  } catch (err) {
    useImageStore.getState().removeUpload(id);
    throw err;
  }
}

export async function importToAssets(
  sourceUrl: string,
  context: ImageContext
): Promise<ImageResult> {
  if (context.isCloud && isR2Url(sourceUrl)) {
    return { url: sourceUrl, isExternal: false, isCloud: true };
  }

  if (!isLocalPath(sourceUrl)) {
    return downloadExternalToAssets(sourceUrl, context);
  }

  if (context.isCloud) {
    const resolved = resolveImageUrl(sourceUrl);
    const response = await fetch(resolved);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const baseName = getImageBaseName(sourceUrl, null);
    const fileName = `${baseName}.png`;

    const { uploadToR2 } = await import('./cloud/cloudflareR2');
    const r2Key = `${context.documentId}/${fileName}`;
    await uploadToR2(r2Key, bytes, 'image/png', context.teamId || '');

    return { url: r2PublicUrl(r2Key), isExternal: false, isCloud: true };
  }

  const docDir = getDocDir(context);
  const baseName = getImageBaseName(sourceUrl, null);
  const fileName = `${baseName}.png`;
  const destPath = `${assetsDir(docDir)}/${fileName}`;

  try {
    const relayPath = sourceUrl.startsWith('./') ? `${docDir}/${sourceUrl.slice(2)}` : sourceUrl;
    const data = await readFileLocal(relayPath);
    if (data) {
      const exists = await readFileLocal(destPath).then(Boolean).catch(() => false);
      if (!exists) {
        await writeFileLocal(destPath, data);
      }
    }
    return { url: `./${IMGS_DIR}/${fileName}`, localPath: destPath, isExternal: false, isCloud: false };
  } catch {
    return { url: sourceUrl, isExternal: false, isCloud: false };
  }
}

async function downloadExternalToAssets(
  url: string,
  context: ImageContext
): Promise<ImageResult> {
  const resolvedUrl = resolveImageUrl(url);
  const response = await fetch(resolvedUrl);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const baseName = getImageBaseName(url, null);
  const ext = getExtensionFromMime(blob.type);
  const fileName = `${baseName}.${ext}`;

  if (context.isCloud) {
    const { uploadToR2 } = await import('./cloud/cloudflareR2');
    const r2Key = `${context.documentId}/${fileName}`;
    await uploadToR2(r2Key, bytes, blob.type, context.teamId || '');
    return { url: r2PublicUrl(r2Key), isExternal: false, isCloud: true };
  }

  const docDir = getDocDir(context);
  const destPath = `${assetsDir(docDir)}/${fileName}`;
  await writeFileLocal(destPath, bytes);

  return { url: `./${IMGS_DIR}/${fileName}`, localPath: destPath, isExternal: false, isCloud: false };
}

export async function saveAnnotatedImage(
  blob: Blob,
  baseName: string,
  context: ImageContext
): Promise<ImageResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const fileName = `${baseName}.png`;

  if (context.isCloud) {
    const { uploadToR2 } = await import('./cloud/cloudflareR2');
    const r2Key = `${context.documentId}/${fileName}`;
    await uploadToR2(r2Key, bytes, 'image/png', context.teamId || '');
    return { url: r2PublicUrl(r2Key), isExternal: false, isCloud: true };
  }

  const docDir = getDocDir(context);
  const destPath = `${assetsDir(docDir)}/${fileName}`;
  await writeFileLocal(destPath, bytes);

  return { url: `./${IMGS_DIR}/${fileName}`, localPath: destPath, isExternal: false, isCloud: false };
}


