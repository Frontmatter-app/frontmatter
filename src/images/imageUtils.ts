export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function fetchImageAsDataURL(
  imageUrl: string
): Promise<{ dataURL: string; blob: Blob; width: number; height: number }> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const dataURL = await blobToDataURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataURL;
  });
  return { dataURL, blob, width: img.width, height: img.height };
}

export function getImageBaseName(imageUrl: string, imageAlt: string | null): string {
  const url = imageUrl.split(/[?#]/)[0];
  const parts = url.split('/');
  const lastPart = parts[parts.length - 1];
  const name = lastPart.includes('.') ? lastPart.replace(/\.[^.]+$/, '') : imageAlt || 'image';
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'image';
}

export function generateId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  return map[mimeType] || 'png';
}

export function isLocalPath(path: string): boolean {
  return !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('data:');
}
