import { describe, expect, it } from 'vitest';
import { isDarkThemeId } from './useChromeTheme';

describe('isDarkThemeId', () => {
  it('recognises the dark GitHub themes', () => {
    for (const id of [
      'github_dark_default',
      'github_dark_dimmed',
      'github_dark_high_contrast',
      'github_dark_colorblind',
    ]) {
      expect(isDarkThemeId(id)).toBe(true);
    }
  });

  it('treats the light themes as light', () => {
    for (const id of ['github_light_default', 'github_light_high_contrast']) {
      expect(isDarkThemeId(id)).toBe(false);
    }
  });

  it('falls back to light when the setting is missing', () => {
    expect(isDarkThemeId(undefined)).toBe(false);
    expect(isDarkThemeId('')).toBe(false);
  });
});
