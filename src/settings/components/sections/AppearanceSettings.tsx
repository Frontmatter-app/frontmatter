import React from 'react';
import { Palette } from 'lucide-react';
import { useSettingsStore, DEFAULT_SETTINGS, Settings, GitHubThemeId } from '../../settingsStore';
import { SettingRow } from '../SettingRow';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function AppearanceSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const isModified = (key: keyof Settings) => JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]);
  const resetSetting = (key: keyof Settings) => updateSettings({ [key]: DEFAULT_SETTINGS[key] });

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <Palette className="w-5 h-5 text-blue-500" />
        Appearance Panel
      </h3>

      {matches('Color Theme', 'Choose color theme for the editor and application', 'themeType') && (
        <SettingRow settingKey="themeType" label="Appearance: Color Theme" description="Select the visual color scheme for the workspaces, editor context, panels, and margins." modified={isModified('themeType')} onReset={() => resetSetting('themeType')}>
          <select
            value={settings.themeType}
            onChange={(e) => updateSettings({ themeType: e.target.value as GitHubThemeId })}
            className="p-2 text-xs font-semibold rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 outline-none text-[var(--editor-text-color)] max-w-full cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
          >
            <option value="github_light_default">GitHub Light Default</option>
            <option value="github_light_high_contrast">GitHub Light High Contrast</option>
            <option value="github_light_colorblind">GitHub Light Colorblind</option>
            <option value="github_light_legacy">GitHub Light (legacy)</option>
            <option value="github_dark_default">GitHub Dark Default</option>
            <option value="github_dark_high_contrast">GitHub Dark High Contrast</option>
            <option value="github_dark_colorblind">GitHub Dark Colorblind</option>
            <option value="github_dark_dimmed">GitHub Dark Dimmed</option>
            <option value="github_dark_legacy">GitHub Dark (legacy)</option>
            <option value="custom">Custom Theme colors</option>
          </select>
        </SettingRow>
      )}

      {matches('Icon Style', 'Stroke weight of Lucide icons', 'iconStyle') && (
        <SettingRow settingKey="iconStyle" label="Appearance: Icon Style" description="Customize the visual stroke weight and sizing format for navigation sidebar icons." modified={isModified('iconStyle')} onReset={() => resetSetting('iconStyle')}>
          <div className="flex gap-1 border border-black/10 dark:border-white/10 rounded-xl p-0.5 bg-black/5 dark:bg-white/5">
            {(['clean', 'minimal', 'bold'] as const).map((style) => (
              <button
                key={style}
                onClick={() => updateSettings({ iconStyle: style })}
                className={`py-1 px-2.5 rounded-lg text-[10px] font-bold capitalize transition cursor-pointer ${
                  settings.iconStyle === style
                    ? 'bg-[var(--editor-bg-color)] shadow-sm text-blue-500'
                    : 'opacity-65 hover:opacity-100'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </SettingRow>
      )}
    </div>
  );
}
