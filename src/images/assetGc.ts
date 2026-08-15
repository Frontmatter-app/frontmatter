import * as Y from 'yjs';

/**
 * Finding assets a document no longer references.
 *
 * Nothing ever cleaned these up: deleting an image from the markdown left the
 * file in `.assets/imgs` (or the object in the bucket) forever, and the delete
 * endpoint that existed was never called from anywhere.
 *
 * Collection is deliberately conservative and local-only for now:
 *
 *  - **Local files are moved to `.assets/trash`, not deleted.** A reference this
 *    scan cannot see — in an older snapshot, an unopened document, a
 *    collaborator's in-flight edit — would otherwise cost the user their image.
 *  - **Bucket objects are left alone.** Assets are content-addressed, so the
 *    same bytes are shared across every document that uses them; deciding an
 *    object is unreferenced needs a view of all documents, not one. Doing it
 *    from a single client would delete images out of other people's documents.
 */

const IMGS_DIR = '.assets/imgs';
const TRASH_DIR = '.assets/trash';

/** Matches the path portion of a markdown image reference. */
const IMAGE_REFERENCE = /!\[[^\]]*\]\(([^)\s]+)/g;

/** Filenames referenced by the document's markdown and its drawing scenes. */
export function referencedAssetNames(ydoc: Y.Doc): Set<string> {
  const names = new Set<string>();

  const collect = (value: string | undefined) => {
    if (!value) return;
    for (const match of value.matchAll(IMAGE_REFERENCE)) {
      const url = match[1];
      if (!url) continue;
      const name = url.split(/[?#]/)[0].split('/').pop();
      if (name) names.add(decodeURIComponent(name));
    }
  };

  collect(ydoc.getText('markdown').toString());
  collect(ydoc.getText('draft').toString());

  // Scene images are references now, so they appear as ordinary URLs.
  ydoc.getMap<any>('excalidraw-files').forEach((entry) => {
    if (entry?.assetRef) collect(`![](${entry.assetRef})`);
  });

  return names;
}

export interface SweepResult {
  scanned: number;
  trashed: string[];
}

/**
 * A file must be unreferenced *and* older than this before it is collected.
 *
 * Being unreferenced right now is weak evidence: cutting an image and pasting
 * it back, or deleting and undoing, both leave it briefly unreferenced. Waiting
 * a day means an image is only collected long after the edit that orphaned it.
 */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Moves unreferenced images in a document's asset folder to `.assets/trash`.
 *
 * @param docDir Absolute path of the folder holding the document.
 * @param minAgeMs Override the age threshold; 0 collects regardless of age.
 */
export async function sweepLocalAssets(
  ydoc: Y.Doc,
  docDir: string,
  minAgeMs: number = MIN_AGE_MS,
): Promise<SweepResult> {
  if (!docDir) return { scanned: 0, trashed: [] };

  const { readDir, mkdir, rename, exists, stat } = await import('@tauri-apps/plugin-fs');
  const imgsDir = `${docDir}/${IMGS_DIR}`;

  if (!(await exists(imgsDir).catch(() => false))) {
    return { scanned: 0, trashed: [] };
  }

  const referenced = referencedAssetNames(ydoc);
  const entries = await readDir(imgsDir).catch(() => []);
  const trashed: string[] = [];
  const now = Date.now();
  let scanned = 0;

  for (const entry of entries) {
    if (!entry.isFile) continue;
    scanned += 1;
    if (referenced.has(entry.name)) continue;

    if (minAgeMs > 0) {
      const info = await stat(`${imgsDir}/${entry.name}`).catch(() => null);
      const modified = info?.mtime ? new Date(info.mtime).getTime() : null;
      // Unknown age is treated as too recent: never collect what cannot be dated.
      if (modified === null || now - modified < minAgeMs) continue;
    }

    if (trashed.length === 0) {
      await mkdir(`${docDir}/${TRASH_DIR}`, { recursive: true });
    }
    try {
      await rename(`${imgsDir}/${entry.name}`, `${docDir}/${TRASH_DIR}/${entry.name}`);
      trashed.push(entry.name);
    } catch (err) {
      console.warn('[assets] Could not move unreferenced image to trash:', entry.name, err);
    }
  }

  return { scanned, trashed };
}
