import type {
  Disposer,
  FeatureContext,
  FeatureId,
  FeatureModule,
  Registry,
  SkippedFeature,
} from './types';

/**
 * Two features claiming the same id is a programming error in the manifest, not
 * a runtime condition — it is the one case the registry refuses to paper over.
 */
export class DuplicateFeatureError extends Error {
  constructor(public readonly id: FeatureId) {
    super(`Duplicate feature id: "${id}"`);
    this.name = 'DuplicateFeatureError';
  }
}

interface Resolution {
  enabled: FeatureId[];
  skipped: SkippedFeature[];
}

/**
 * Decides which features can run, in an order where every dependency precedes
 * its dependents.
 *
 * Uses an iterative fixpoint rather than a recursive walk so a dependency cycle
 * simply fails to resolve instead of overflowing the stack.
 */
function resolve(modules: Map<FeatureId, FeatureModule<never>>): Resolution {
  const enabled: FeatureId[] = [];
  const placed = new Set<FeatureId>();
  const skipped: SkippedFeature[] = [];
  const rejected = new Map<FeatureId, string>();

  let pending = [...modules.keys()];

  // Each pass places every feature whose dependencies are already placed. When
  // a pass places nothing, whatever is left is unsatisfiable.
  for (;;) {
    const stillPending: FeatureId[] = [];
    let progressed = false;

    for (const id of pending) {
      const requires = modules.get(id)?.requires ?? [];

      const missing = requires.find((dep) => !modules.has(dep));
      if (missing !== undefined) {
        rejected.set(id, `missing dependency: ${missing}`);
        continue;
      }

      const brokenDep = requires.find((dep) => rejected.has(dep));
      if (brokenDep !== undefined) {
        rejected.set(id, `disabled dependency: ${brokenDep}`);
        continue;
      }

      if (requires.every((dep) => placed.has(dep))) {
        enabled.push(id);
        placed.add(id);
        progressed = true;
      } else {
        stillPending.push(id);
      }
    }

    pending = stillPending;
    if (pending.length === 0) break;

    if (!progressed) {
      // No feature advanced and none were newly rejected: the remainder is a
      // dependency cycle (or depends on one).
      const advanced = stillPending.some((id) => rejected.has(id));
      if (!advanced) {
        for (const id of pending) {
          rejected.set(id, `dependency cycle involving: ${id}`);
        }
        break;
      }
    }
  }

  for (const [id, reason] of rejected) {
    skipped.push({ id, reason });
  }

  return { enabled, skipped };
}

/**
 * Builds the feature graph for a manifest.
 *
 * The only hard error is a duplicate id. Everything else — a missing
 * dependency, a disabled dependency, a cycle, a feature that throws during
 * setup — degrades to that feature being skipped so the rest of the app boots.
 */
export function createRegistry<Ctx = FeatureContext, Surface = unknown>(
  manifest: FeatureModule<Ctx, Surface>[],
): Registry<Ctx, Surface> {
  const modules = new Map<FeatureId, FeatureModule<Ctx, Surface>>();
  for (const module of manifest) {
    if (modules.has(module.id)) {
      throw new DuplicateFeatureError(module.id);
    }
    modules.set(module.id, module);
  }

  const { enabled: enabledIds, skipped } = resolve(
    modules as unknown as Map<FeatureId, FeatureModule<never>>,
  );
  const enabled = enabledIds.map((id) => modules.get(id)!);
  const failed: FeatureModule<Ctx, Surface>[] = [];

  return {
    enabled,
    skipped,
    failed,

    has: (id) => enabledIds.includes(id),

    editorExtensions(ctx) {
      return enabled.flatMap((feature) => {
        if (!feature.editor) return [];
        try {
          return feature.editor(ctx);
        } catch (error) {
          console.error(`[features] "${feature.id}" failed to build extensions`, error);
          return [];
        }
      });
    },

    surfaces() {
      const rendered: Surface[] = [];
      for (const feature of enabled) {
        if (!feature.surface) continue;
        try {
          rendered.push(feature.surface());
        } catch (error) {
          // A modal that cannot even be constructed must not blank the shell.
          console.error(`[features] "${feature.id}" failed to build its surface`, error);
        }
      }
      return rendered;
    },

    activate(ctx) {
      const disposers: Disposer[] = [];

      for (const feature of enabled) {
        if (!feature.setup) continue;
        try {
          const disposer = feature.setup(ctx);
          if (typeof disposer === 'function') disposers.push(disposer);
        } catch (error) {
          // One broken feature must not take down the shell.
          console.error(`[features] "${feature.id}" failed to activate`, error);
          failed.push(feature);
        }
      }

      return () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose();
          } catch (error) {
            console.error('[features] teardown failed', error);
          }
        }
      };
    },
  };
}
