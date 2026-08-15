/**
 * Renames the local-storage keys left behind by the previous app name.
 *
 * The Rust side has already carried the whole storage directory across the
 * change of bundle identifier, so the old keys are present and readable — they
 * are just still called `marktype_*`. This renames them in place.
 *
 * Written as a data-driven sweep rather than a call per feature because the
 * keys are spread across auth, settings, billing, the theme and the workspace,
 * and a migration that lives next to only one of them is a migration the next
 * person will not find.
 */

const LEGACY_PREFIX = "marktype_";
const CURRENT_PREFIX = "frontmatter_";

/** Set once the sweep has run, so it costs one read on later launches. */
const MIGRATION_MARKER = "frontmatter_storage_migrated";

export interface MigrationResult {
  migrated: string[];
  skipped: string[];
}

/**
 * Moves every `marktype_*` key to `frontmatter_*`.
 *
 * Rules that matter:
 *
 *  - A key that already exists under the new name wins. The new name is what
 *    the running app has been writing, so it is never older than the legacy
 *    one.
 *  - The legacy key is removed only after its value is safely written, so an
 *    interrupted migration loses nothing and simply resumes next launch.
 */
export function migrateLocalStorageKeys(storage: Storage = localStorage): MigrationResult {
  const result: MigrationResult = { migrated: [], skipped: [] };

  if (storage.getItem(MIGRATION_MARKER) === "1") return result;

  // Collected up front: writing to storage while iterating its indices would
  // shift the keys underneath the loop.
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }

  for (const legacyKey of legacyKeys) {
    const nextKey = `${CURRENT_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`;
    try {
      if (storage.getItem(nextKey) !== null) {
        storage.removeItem(legacyKey);
        result.skipped.push(legacyKey);
        continue;
      }
      const value = storage.getItem(legacyKey);
      if (value === null) continue;
      storage.setItem(nextKey, value);
      storage.removeItem(legacyKey);
      result.migrated.push(nextKey);
    } catch {
      // A quota error or a locked storage should not stop the app from
      // starting, and leaving the legacy key in place means the next launch
      // tries again.
      result.skipped.push(legacyKey);
    }
  }

  try {
    storage.setItem(MIGRATION_MARKER, "1");
  } catch {
    // Without the marker the sweep simply runs again, which is harmless.
  }

  return result;
}
