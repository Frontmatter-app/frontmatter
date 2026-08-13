import { useEffect } from 'react';
import { useSettingsStore } from '../settings/settingsStore';

/**
 * Keeps the neumorphic chrome in step with the editor theme.
 *
 * The design system is scoped to chrome — title bar, menus, modals, settings —
 * and deliberately does not restyle the editor, which keeps its own GitHub
 * themes. The two only need to agree on light versus dark, which is what this
 * stamps onto the root element as `data-nm-theme`.
 */
export function isDarkThemeId(themeType: string | undefined): boolean {
  return typeof themeType === 'string' && themeType.includes('dark');
}

export function useChromeTheme(): void {
  const themeType = useSettingsStore((state) => state.settings.themeType);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-nm-theme', isDarkThemeId(themeType) ? 'dark' : 'light');
  }, [themeType]);
}
