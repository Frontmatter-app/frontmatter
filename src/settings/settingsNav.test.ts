import { describe, expect, it } from 'vitest';
import {
  SETTINGS_NAV,
  findCategory,
  flattenCategories,
  resolveActiveCategory,
  searchSettingsNav,
  visibleSettingsNav,
} from './settingsNav';

describe('settings navigation spec', () => {
  it('gives every category a unique id', () => {
    const ids = flattenCategories(SETTINGS_NAV).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every category a label, description and icon', () => {
    for (const category of flattenCategories(SETTINGS_NAV)) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
      expect(category.icon).toBeTruthy();
    }
  });

  it('never leaves a group empty', () => {
    for (const group of SETTINGS_NAV) {
      expect(group.categories.length).toBeGreaterThan(0);
    }
  });
});

describe('visibleSettingsNav', () => {
  // No shipped category is gated today: the open-source build has every
  // capability, so `requires` has no consumer in SETTINGS_NAV. The mechanism
  // is kept because teams return with the git-backed work, derived from
  // repository collaborators — so it is exercised against a synthetic fixture
  // rather than by pinning a real category that is not gated any more.
  const gatedNav = [
    {
      id: 'synthetic',
      label: 'Synthetic',
      categories: [
        { id: 'open', label: 'Open', description: '', icon: undefined as never, keywords: [] },
        {
          id: 'gated',
          label: 'Gated',
          description: '',
          icon: undefined as never,
          requires: 'team' as const,
          keywords: [],
        },
      ],
    },
  ];

  it('hides a gated category without the capability', () => {
    const visible = visibleSettingsNav(gatedNav, { isTeam: false });
    expect(findCategory(visible, 'gated')).toBeUndefined();
    expect(findCategory(visible, 'open')).toBeDefined();
  });

  it('shows a gated category with the capability', () => {
    expect(findCategory(visibleSettingsNav(gatedNav, { isTeam: true }), 'gated')).toBeDefined();
  });

  it('gates nothing in the shipped navigation', () => {
    // Every capability is available, so filtering must be a no-op.
    expect(visibleSettingsNav(SETTINGS_NAV, { isTeam: false })).toEqual(SETTINGS_NAV);
  });

  it('drops a group whose only category was gated away', () => {
    const groups = [{ id: 'solo', label: 'Solo', categories: [gatedNav[0].categories[1]] }];
    expect(visibleSettingsNav(groups, { isTeam: false })).toEqual([]);
  });
});

describe('searchSettingsNav', () => {
  it('leaves the navigation untouched for an empty query', () => {
    expect(searchSettingsNav(SETTINGS_NAV, '')).toEqual(SETTINGS_NAV);
    expect(searchSettingsNav(SETTINGS_NAV, '   ')).toEqual(SETTINGS_NAV);
  });

  it('matches on the label', () => {
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'Version Control'));
    expect(results.map((c) => c.id)).toContain('versionControl');
  });

  it('matches on keywords that are not in the label', () => {
    // "katex" appears only in the Live Preview keywords.
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'katex'));
    expect(results.map((c) => c.id)).toEqual(['preview']);
  });

  it('matches on the description', () => {
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'remotes'));
    expect(results.map((c) => c.id)).toContain('versionControl');
  });

  it('is case insensitive and ignores surrounding space', () => {
    expect(flattenCategories(searchSettingsNav(SETTINGS_NAV, '  GIT  ')).length).toBeGreaterThan(0);
  });

  it('accepts both spellings of colour', () => {
    expect(flattenCategories(searchSettingsNav(SETTINGS_NAV, 'color')).map((c) => c.id))
      .toContain('colors');
    expect(flattenCategories(searchSettingsNav(SETTINGS_NAV, 'colour')).map((c) => c.id))
      .toContain('colors');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchSettingsNav(SETTINGS_NAV, 'zzzznotasetting')).toEqual([]);
  });
});

describe('resolveActiveCategory', () => {
  it('keeps the requested category when it is available', () => {
    expect(resolveActiveCategory(SETTINGS_NAV, 'editor')).toBe('editor');
  });

  it('falls back to the first category when the request was filtered away', () => {
    const filtered = searchSettingsNav(SETTINGS_NAV, 'remotes');
    expect(resolveActiveCategory(filtered, 'editor')).toBe('versionControl');
  });

  it('falls back when the stored category is not available', () => {
    expect(resolveActiveCategory(SETTINGS_NAV, 'no-such-category')).toBe('general');
  });

  it('returns undefined when nothing is available', () => {
    expect(resolveActiveCategory([], 'general')).toBeUndefined();
  });
});
