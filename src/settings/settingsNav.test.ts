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
  it('hides team settings without a team plan', () => {
    const visible = visibleSettingsNav(SETTINGS_NAV, { isTeam: false });
    expect(findCategory(visible, 'team')).toBeUndefined();
    expect(findCategory(visible, 'general')).toBeDefined();
  });

  it('shows team settings on a team plan', () => {
    const visible = visibleSettingsNav(SETTINGS_NAV, { isTeam: true });
    expect(findCategory(visible, 'team')).toBeDefined();
  });

  it('drops a group whose only category was gated away', () => {
    const groups = [
      { id: 'solo', label: 'Solo', categories: [SETTINGS_NAV[2].categories[1]] },
    ];
    expect(visibleSettingsNav(groups, { isTeam: false })).toEqual([]);
  });
});

describe('searchSettingsNav', () => {
  it('leaves the navigation untouched for an empty query', () => {
    expect(searchSettingsNav(SETTINGS_NAV, '')).toEqual(SETTINGS_NAV);
    expect(searchSettingsNav(SETTINGS_NAV, '   ')).toEqual(SETTINGS_NAV);
  });

  it('matches on the label', () => {
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'billing'));
    expect(results.map((c) => c.id)).toContain('billing');
  });

  it('matches on keywords that are not in the label', () => {
    // "katex" appears only in the Live Preview keywords.
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'katex'));
    expect(results.map((c) => c.id)).toEqual(['preview']);
  });

  it('matches on the description', () => {
    const results = flattenCategories(searchSettingsNav(SETTINGS_NAV, 'invoices'));
    expect(results.map((c) => c.id)).toContain('billing');
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
    const filtered = searchSettingsNav(SETTINGS_NAV, 'billing');
    expect(resolveActiveCategory(filtered, 'editor')).toBe('billing');
  });

  it('falls back when the plan no longer includes the stored category', () => {
    const visible = visibleSettingsNav(SETTINGS_NAV, { isTeam: false });
    expect(resolveActiveCategory(visible, 'team')).toBe('general');
  });

  it('returns undefined when nothing is available', () => {
    expect(resolveActiveCategory([], 'general')).toBeUndefined();
  });
});
