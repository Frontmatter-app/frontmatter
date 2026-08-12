/**
 * A feature is a self-contained slice of the app that can be added to or
 * removed from the manifest without any other module importing it directly.
 *
 * Nothing outside `src/features/` may import a feature module by path. The
 * registry is the only wiring point, which is what makes deletion safe: remove
 * the directory, remove its line from the manifest, and the app still boots.
 */
export type FeatureId = string;

/** Anything a feature needs from the shell at activation time. */
export interface FeatureContext {
  [key: string]: unknown;
}

/** Cleanup returned from `setup`, run when the feature is torn down. */
export type Disposer = () => void;

export interface FeatureModule<Ctx = FeatureContext, Surface = unknown> {
  /** Stable, unique, kebab-case. Used in settings and diagnostics. */
  id: FeatureId;

  /** Human-readable name shown in the features panel. */
  name: string;

  /**
   * Ids this feature needs. If any is absent or itself disabled, this feature
   * is skipped — never thrown. That is the guarantee that lets any feature be
   * deleted safely.
   */
  requires?: FeatureId[];

  /**
   * CodeMirror extensions contributed to the editor. Typed as `unknown[]` here
   * so the registry stays free of an editor dependency.
   */
  editor?: (ctx: Ctx) => unknown[];

  /**
   * UI this feature contributes to the shell — a modal, an overlay, a panel.
   *
   * Generic so the registry never imports React; the shell layer binds
   * `Surface` to `ReactNode`.
   */
  surface?: () => Surface;

  /** Side effects owned by this feature. Return a disposer to undo them. */
  setup?: (ctx: Ctx) => Disposer | void;

  /**
   * Proves the feature is wired correctly. Run by the registry contract test,
   * which the `predev` / `prebuild` gate executes — a feature whose self-test
   * fails blocks both dev startup and a production build.
   */
  selfTest: () => void | Promise<void>;
}

export interface SkippedFeature {
  id: FeatureId;
  reason: string;
}

export interface Registry<Ctx = FeatureContext, Surface = unknown> {
  /** Activatable features, dependencies first. */
  enabled: FeatureModule<Ctx, Surface>[];
  /** Features left out, with why. */
  skipped: SkippedFeature[];
  /** Features whose `setup` threw during activation. */
  failed: FeatureModule<Ctx, Surface>[];
  has(id: FeatureId): boolean;
  editorExtensions(ctx: Ctx): unknown[];
  /** UI contributed by enabled features, in dependency order. */
  surfaces(): Surface[];
  /** Runs every `setup`; returns a disposer that tears down in reverse order. */
  activate(ctx: Ctx): Disposer;
}
