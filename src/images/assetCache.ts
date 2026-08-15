/**
 * A bounded on-disk cache for cloud assets.
 *
 * Deliberately a cache and not a mirror. Mirroring every image a team document
 * references would pull an unbounded amount onto every member's disk, so this
 * holds a capped, least-recently-used working set instead. The consequence is
 * honest and worth stating: images you have looked at recently work offline,
 * others do not.
 *
 * Safe to keep indefinitely until evicted, because the key is a hash of the
 * bytes — what a digest names never changes.
 *
 * Your own local documents do not come through here at all. Those files are
 * yours, live beside the document, and are neither capped nor evicted.
 */

const CACHE_DIR = 'asset-cache';

/** Default ceiling for the cached working set. */
export const DEFAULT_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;

let cacheRoot: string | null = null;

async function root(): Promise<string | null> {
  if (cacheRoot) return cacheRoot;
  try {
    const { appCacheDir } = await import('@tauri-apps/api/path');
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    const dir = `${(await appCacheDir()).replace(/\/$/, '')}/${CACHE_DIR}`;
    await mkdir(dir, { recursive: true });
    cacheRoot = dir;
    return dir;
  } catch {
    // No Tauri bridge: caching is simply unavailable, which is not an error.
    return null;
  }
}

/**
 * Path of a cached asset, or null.
 *
 * Touches the file's access time on a hit so eviction can tell a working set
 * from a one-off.
 */
export async function cachedAssetPath(digest: string): Promise<string | null> {
  const dir = await root();
  if (!dir) return null;

  try {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dir);
    const hit = entries.find((entry) => entry.isFile && entry.name.startsWith(`${digest}.`));
    if (!hit) return null;
    void touch(`${dir}/${hit.name}`);
    return `${dir}/${hit.name}`;
  } catch {
    return null;
  }
}

/** Stores bytes under their digest, then trims the cache back under its limit. */
export async function cacheAsset(
  digest: string,
  extension: string,
  bytes: Uint8Array,
  limitBytes: number = DEFAULT_CACHE_LIMIT_BYTES,
): Promise<string | null> {
  const dir = await root();
  if (!dir) return null;

  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = `${dir}/${digest}.${extension}`;
    await writeFile(path, bytes);
    void evictBeyond(limitBytes);
    return path;
  } catch (err) {
    console.warn('[assets] Could not cache asset:', err);
    return null;
  }
}

/** Rewrites a file's timestamps by copying it over itself. */
async function touch(path: string): Promise<void> {
  try {
    const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, await readFile(path));
  } catch {
    // Only affects eviction ordering; not worth surfacing.
  }
}

/**
 * Evicts least-recently-used entries until the cache fits.
 *
 * Ordering comes from modification time, which `touch` refreshes on every hit —
 * access times are not reliably exposed across platforms.
 */
export async function evictBeyond(limitBytes: number): Promise<number> {
  const dir = await root();
  if (!dir) return 0;

  try {
    const { readDir, stat, remove } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dir);

    const files: { path: string; size: number; mtime: number }[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const path = `${dir}/${entry.name}`;
      const info = await stat(path).catch(() => null);
      if (!info) continue;
      files.push({
        path,
        size: info.size ?? 0,
        mtime: info.mtime ? new Date(info.mtime).getTime() : 0,
      });
    }

    let total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= limitBytes) return 0;

    files.sort((a, b) => a.mtime - b.mtime); // oldest first
    let evicted = 0;
    for (const file of files) {
      if (total <= limitBytes) break;
      try {
        await remove(file.path);
        total -= file.size;
        evicted += 1;
      } catch {
        // A file in use is skipped rather than failing the sweep.
      }
    }
    return evicted;
  } catch {
    return 0;
  }
}

/** Test seam. */
export function __resetAssetCacheRoot(): void {
  cacheRoot = null;
}
