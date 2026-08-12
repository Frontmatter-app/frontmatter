import { describe, expect, it, vi } from 'vitest';
import { createRegistry, DuplicateFeatureError } from './registry';
import type { FeatureModule } from './types';

/** Minimal feature used to exercise wiring without touching CodeMirror or React. */
function feature<Ctx = Record<string, unknown>, Surface = unknown>(
  id: string,
  overrides: Partial<FeatureModule<Ctx, Surface>> = {},
): FeatureModule<Ctx, Surface> {
  return {
    id,
    name: id,
    selfTest: () => {},
    ...overrides,
  };
}

describe('createRegistry', () => {
  it('enables every feature whose dependencies are present', () => {
    const registry = createRegistry([
      feature('editor-core'),
      feature('outline', { requires: ['editor-core'] }),
    ]);

    expect(registry.enabled.map((f) => f.id)).toEqual(['editor-core', 'outline']);
    expect(registry.skipped).toEqual([]);
  });

  it('orders dependencies before the features that need them', () => {
    const registry = createRegistry([
      feature('outline', { requires: ['editor-core'] }),
      feature('editor-core'),
    ]);

    const order = registry.enabled.map((f) => f.id);
    expect(order.indexOf('editor-core')).toBeLessThan(order.indexOf('outline'));
  });

  it('rejects a manifest with duplicate ids', () => {
    expect(() => createRegistry([feature('dup'), feature('dup')])).toThrow(
      DuplicateFeatureError,
    );
  });

  // --- The core requirement: any feature can be deleted and the app still boots.

  it('skips a feature whose dependency is absent instead of throwing', () => {
    const registry = createRegistry([feature('outline', { requires: ['editor-core'] })]);

    expect(registry.enabled).toEqual([]);
    expect(registry.skipped).toEqual([
      { id: 'outline', reason: 'missing dependency: editor-core' },
    ]);
  });

  it('survives removal of any single feature from the manifest', () => {
    const manifest = [
      feature('editor-core'),
      feature('outline', { requires: ['editor-core'] }),
      feature('git', { requires: ['editor-core'] }),
      feature('collab', { requires: ['editor-core', 'outline'] }),
      feature('standalone'),
    ];

    for (const removed of manifest) {
      const reduced = manifest.filter((f) => f.id !== removed.id);
      expect(() => createRegistry(reduced)).not.toThrow();

      const registry = createRegistry(reduced);
      expect(registry.has(removed.id)).toBe(false);
      // Features that never depended on the removed one keep working.
      if (removed.id !== 'standalone') {
        expect(registry.has('standalone')).toBe(true);
      }
    }
  });

  it('transitively disables dependents of a missing feature', () => {
    const registry = createRegistry([
      feature('outline', { requires: ['editor-core'] }),
      feature('collab', { requires: ['outline'] }),
    ]);

    expect(registry.enabled).toEqual([]);
    expect(registry.skipped.map((s) => s.id).sort()).toEqual(['collab', 'outline']);
  });

  it('disables a dependency cycle rather than hanging', () => {
    const registry = createRegistry([
      feature('a', { requires: ['b'] }),
      feature('b', { requires: ['a'] }),
    ]);

    expect(registry.enabled).toEqual([]);
    expect(registry.skipped.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(registry.skipped.every((s) => s.reason.includes('cycle'))).toBe(true);
  });

  // --- Contributions

  it('collects editor extensions from enabled features only', () => {
    const registry = createRegistry([
      feature('editor-core', { editor: () => ['core-ext'] }),
      feature('orphan', { requires: ['nope'], editor: () => ['orphan-ext'] }),
    ]);

    expect(registry.editorExtensions({})).toEqual(['core-ext']);
  });

  it('collects surfaces from enabled features in dependency order', () => {
    const registry = createRegistry<Record<string, unknown>, string>([
      feature('shell', { surface: () => 'shell-ui' }),
      feature('panel', { requires: ['shell'], surface: () => 'panel-ui' }),
      feature('headless'),
    ]);

    expect(registry.surfaces()).toEqual(['shell-ui', 'panel-ui']);
  });

  it('omits surfaces belonging to skipped features', () => {
    const registry = createRegistry<Record<string, unknown>, string>([
      feature('shell', { surface: () => 'shell-ui' }),
      feature('orphan', { requires: ['gone'], surface: () => 'orphan-ui' }),
    ]);

    expect(registry.surfaces()).toEqual(['shell-ui']);
  });

  it('drops a surface that throws instead of blanking the shell', () => {
    const registry = createRegistry<Record<string, unknown>, string>([
      feature('broken', {
        surface: () => {
          throw new Error('render setup failed');
        },
      }),
      feature('healthy', { surface: () => 'healthy-ui' }),
    ]);

    expect(registry.surfaces()).toEqual(['healthy-ui']);
  });

  it('runs teardown in reverse activation order', () => {
    const order: string[] = [];
    const registry = createRegistry([
      feature('first', { setup: () => () => order.push('first') }),
      feature('second', {
        requires: ['first'],
        setup: () => () => order.push('second'),
      }),
    ]);

    const dispose = registry.activate({});
    dispose();

    expect(order).toEqual(['second', 'first']);
  });

  it('isolates a feature that throws during setup', () => {
    const healthy = vi.fn();
    const registry = createRegistry([
      feature('broken', {
        setup: () => {
          throw new Error('boom');
        },
      }),
      feature('healthy', { setup: healthy }),
    ]);

    expect(() => registry.activate({})).not.toThrow();
    expect(healthy).toHaveBeenCalled();
    expect(registry.failed.map((f) => f.id)).toEqual(['broken']);
  });
});
