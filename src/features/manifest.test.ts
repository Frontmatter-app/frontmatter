import { describe, expect, it } from 'vitest';
import { createRegistry } from './registry';
import { editorFeatures } from './editorFeatures';
import { shellFeatures } from './shellFeatures';
import type { FeatureModule } from './types';

/**
 * The gate contract.
 *
 * `predev` and `prebuild` run this file, so a feature that is mis-wired, whose
 * self-test fails, or whose removal would break a sibling blocks both
 * `npm run dev` and a production build.
 */
const manifests: Array<[string, FeatureModule<never, never>[]]> = [
  ['editor', editorFeatures as unknown as FeatureModule<never, never>[]],
  ['shell', shellFeatures as unknown as FeatureModule<never, never>[]],
];

describe.each(manifests)('%s feature manifest', (_label, manifest) => {
  it('registers every feature with no unresolved dependencies', () => {
    const registry = createRegistry(manifest);
    expect(registry.skipped).toEqual([]);
    expect(registry.enabled).toHaveLength(manifest.length);
  });

  it('gives every feature a unique, kebab-case id', () => {
    const ids = manifest.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  it('gives every feature a human-readable name', () => {
    for (const feature of manifest) {
      expect(feature.name.length).toBeGreaterThan(0);
    }
  });

  it('passes the self-test of every feature', async () => {
    for (const feature of manifest) {
      await expect(
        Promise.resolve().then(() => feature.selfTest()),
      ).resolves.not.toThrow();
    }
  });

  it('still boots with any single feature removed', () => {
    for (const removed of manifest) {
      const reduced = manifest.filter((f) => f.id !== removed.id);
      const registry = createRegistry(reduced);

      expect(registry.has(removed.id)).toBe(false);
      // No surviving feature may be collateral damage.
      expect(registry.skipped).toEqual([]);
      expect(registry.enabled).toHaveLength(reduced.length);
    }
  });
});
