import type { ProjectConfig, ThemeOption as GeneratedThemeOption } from '../ipc/generated';

/** The site kinds a workspace can be published as. */
export type PublishType =
  | 'docs'
  | 'blog'
  | 'book'
  | 'slide'
  | 'wiki'
  | 'portfolio'
  | 'changelog'
  | 'kb';

export const PUBLISH_TYPES: PublishType[] = [
  'docs',
  'blog',
  'book',
  'slide',
  'wiki',
  'portfolio',
  'changelog',
  'kb',
];

export interface PublishTypeInfo {
  title: string;
  description: string;
}

/**
 * Each type is backed by a real theme directory under `themes/<slug>/`. Adding
 * one here without a theme behind it would put an empty picker in front of the
 * user at step two.
 */
export const PUBLISH_TYPE_INFO: Record<PublishType, PublishTypeInfo> = {
  docs: {
    title: 'Documentation',
    description:
      'A reference site. Folders become a navigation sidebar, headings become an on-page table of contents, and pages link to what comes next.',
  },
  blog: {
    title: 'Blog',
    description:
      'Posts listed newest first, with excerpts, tags, and reading time. Best when each document stands on its own.',
  },
  book: {
    title: 'Book',
    description:
      'One continuous read. Chapters are numbered in your order and every page carries previous and next navigation.',
  },
  slide: {
    title: 'Slides',
    description:
      'Each document becomes a deck and horizontal rules split it into slides. Arrow keys navigate, F goes fullscreen.',
  },
  wiki: {
    title: 'Wiki',
    description:
      'Interlinked notes browsed by name rather than order. Every page lists what links back to it, so the connections you already wrote become navigation.',
  },
  portfolio: {
    title: 'Portfolio',
    description:
      'Work shown as a grid of cards with cover images, opening into a full case study per project. Tags become filters.',
  },
  changelog: {
    title: 'Changelog',
    description:
      'Dated entries grouped by release, each independently linkable. Publishes a feed readers can subscribe to.',
  },
  kb: {
    title: 'Knowledge base',
    description:
      'A support site that opens on search. Articles sit in categories and each one points to related reading.',
  },
};

export function isPublishType(value: string): value is PublishType {
  return (PUBLISH_TYPES as string[]).includes(value);
}

/** The control a theme-declared setting renders as. */
export type ThemeFieldKind = 'text' | 'textarea' | 'boolean' | 'color' | 'select';

export interface ThemeOptionField {
  key: string;
  label?: string | null;
  type?: ThemeFieldKind;
  default?: unknown;
  help?: string | null;
  choices?: string[];
}

/**
 * `source` and the field `type` come through the generated bindings as
 * `unknown` — the generator cannot resolve Rust enums — so they are narrowed
 * here once rather than at every use.
 */
export type ThemeOption = Omit<GeneratedThemeOption, 'source' | 'options'> & {
  source: 'workspace' | 'bundled';
  options: ThemeOptionField[];
};

export interface PublishResult {
  success: boolean;
  output_dir: string;
  public_dir: string;
  preview_url: string | null;
  page_count: number;
  error: string | null;
}

/** `config.yml` parsed as a generic tree, so no key is lost on save. */
export type ConfigValues = Record<string, unknown>;

/** Where theme authoring is documented. */
export const THEME_DOCS_URL = 'https://frontmatter.app/docs/themes';

export type { ProjectConfig };
