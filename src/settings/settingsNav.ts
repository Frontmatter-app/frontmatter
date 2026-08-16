import {
  Code2,
  CreditCard,
  Eye,
  GitBranch,
  Palette,
  RefreshCw,
  Sliders,
  SlidersHorizontal,
  Type,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Settings navigation, as data.
 *
 * The panel used to present eleven categories as one flat list, which gave no
 * sense of what belonged with what. Grouping, gating and search are expressed
 * here as pure functions so they can be tested without rendering the modal.
 */

/** Entitlement a category needs before it is worth showing. */
export type SettingsRequirement = 'team';

export interface SettingsCategorySpec {
  id: string;
  label: string;
  /** One line describing the category, shown under the heading. */
  description: string;
  icon: LucideIcon;
  requires?: SettingsRequirement;
  /** Extra search terms that do not appear in the label. */
  keywords?: string[];
}

export interface SettingsGroupSpec {
  id: string;
  label: string;
  categories: SettingsCategorySpec[];
}

export const SETTINGS_NAV: SettingsGroupSpec[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    categories: [
      {
        id: 'general',
        label: 'General',
        description: 'Startup, autosave, and file handling.',
        icon: SlidersHorizontal,
        keywords: ['autosave', 'startup', 'files', 'recent'],
      },
      {
        id: 'editor',
        label: 'Editor',
        description: 'Typing, wrapping, and cursor behaviour.',
        icon: Type,
        keywords: ['font', 'wrap', 'cursor', 'indent', 'spellcheck'],
      },
      {
        id: 'preview',
        label: 'Live Preview',
        description: 'How Markdown renders as you write.',
        icon: Eye,
        keywords: ['markdown', 'math', 'katex', 'mermaid', 'diagram', 'inline'],
      },
      {
        id: 'code',
        label: 'Code Blocks',
        description: 'Syntax highlighting and runtimes for executable blocks.',
        icon: Code2,
        keywords: ['syntax', 'highlight', 'runtime', 'execute', 'python'],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    categories: [
      {
        id: 'appearance',
        label: 'Theme',
        description: 'Light and dark themes, icons, and density.',
        icon: Palette,
        keywords: ['dark', 'light', 'theme', 'icon'],
      },
      {
        id: 'colors',
        label: 'Colours',
        description: 'Fine-grained editor colour overrides.',
        icon: Sliders,
        keywords: ['colour', 'color', 'accent', 'highlight', 'palette'],
      },
    ],
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    categories: [
      {
        id: 'versionControl',
        label: 'Version Control',
        description: 'Git integration, commits, and remotes.',
        icon: GitBranch,
        keywords: ['git', 'commit', 'branch', 'remote', 'push', 'pull'],
      },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    categories: [
      {
        id: 'accounts',
        label: 'Accounts',
        description: 'Signed-in accounts and workspace switching.',
        icon: User,
        keywords: ['sign in', 'sign out', 'google', 'switch', 'profile'],
      },
      {
        id: 'updates',
        label: 'Updates',
        description: 'Application version and update channel.',
        icon: RefreshCw,
        keywords: ['version', 'upgrade', 'release', 'changelog'],
      },
    ],
  },
];

export interface Entitlements {
  isTeam: boolean;
}

/** Drops categories the current plan cannot use, and any group left empty. */
export function visibleSettingsNav(
  groups: SettingsGroupSpec[],
  entitlements: Entitlements,
): SettingsGroupSpec[] {
  return groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter(
        (category) => category.requires !== 'team' || entitlements.isTeam,
      ),
    }))
    .filter((group) => group.categories.length > 0);
}

function categoryMatches(category: SettingsCategorySpec, query: string): boolean {
  const haystack = [category.label, category.description, ...(category.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Narrows the navigation to categories matching `query`.
 *
 * An empty or whitespace-only query leaves the navigation untouched, so search
 * never hides everything just because the field was focused.
 */
export function searchSettingsNav(
  groups: SettingsGroupSpec[],
  query: string,
): SettingsGroupSpec[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;

  return groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((category) => categoryMatches(category, needle)),
    }))
    .filter((group) => group.categories.length > 0);
}

/** All categories across every group, in display order. */
export function flattenCategories(groups: SettingsGroupSpec[]): SettingsCategorySpec[] {
  return groups.flatMap((group) => group.categories);
}

export function findCategory(
  groups: SettingsGroupSpec[],
  id: string,
): SettingsCategorySpec | undefined {
  return flattenCategories(groups).find((category) => category.id === id);
}

/**
 * Picks the category to show.
 *
 * Falls back to the first available one when the stored selection has been
 * filtered away — by a search, or by a plan that no longer includes it.
 */
export function resolveActiveCategory(
  groups: SettingsGroupSpec[],
  requested: string | undefined,
): string | undefined {
  if (requested && findCategory(groups, requested)) return requested;
  return flattenCategories(groups)[0]?.id;
}
