import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useSettingsStore, DEFAULT_SETTINGS, Settings, GitHubThemeId } from '../../settingsStore';
import { SettingRow } from '../SettingRow';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function GeneralSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const isModified = (key: keyof Settings) => JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]);
  const resetSetting = (key: keyof Settings) => updateSettings({ [key]: DEFAULT_SETTINGS[key] });

  const Toggle = ({ settingKey, label }: { settingKey: keyof Settings; label: string }) => (
    <button
      onClick={() => updateSettings({ [settingKey]: !settings[settingKey] } as any)}
      className="cursor-pointer py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10"
    >
      <span className={`w-2 h-2 rounded-full ${settings[settingKey] ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
      {settings[settingKey] ? 'Enabled' : 'Disabled'}
    </button>
  );

  const Segmented = ({ settingKey, options }: { settingKey: keyof Settings; options: readonly string[] }) => (
    <div className="flex gap-1 border border-black/10 dark:border-white/10 rounded-xl p-0.5 bg-black/5 dark:bg-white/5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => updateSettings({ [settingKey]: opt } as any)}
          className={`py-1 px-2.5 rounded-lg text-[10px] font-bold capitalize transition cursor-pointer ${
            (settings as any)[settingKey] === opt
              ? 'bg-[var(--editor-bg-color)] shadow-sm text-blue-500'
              : 'opacity-65 hover:opacity-100'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <SlidersHorizontal className="w-5 h-5 text-blue-500" />
        Commonly Used Settings
      </h3>

      {matches('Auto Save', 'Automatically save document edits', 'autoSave') && (
        <SettingRow settingKey="autoSave" label="Editor: Auto Save" description="Controls whether modified documents are automatically saved as you type. Real-time file write updates are applied." modified={isModified('autoSave')} onReset={() => resetSetting('autoSave')}>
          <Toggle settingKey="autoSave" label="Auto Save" />
        </SettingRow>
      )}

      {matches('Auto Sync', 'Automatically sync documents to cloud', 'autoSync') && (
        <SettingRow settingKey="autoSync" label="Cloud: Auto Sync" description="Controls whether documents are automatically synced to the cloud when you edit them." modified={isModified('autoSync')} onReset={() => resetSetting('autoSync')}>
          <button
            onClick={() => updateSettings({ autoSync: !settings.autoSync })}
            className="cursor-pointer py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10"
          >
            <span className={`w-2 h-2 rounded-full ${settings.autoSync ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`} />
            {settings.autoSync ? 'Enabled' : 'Disabled'}
          </button>
        </SettingRow>
      )}

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

      {matches('Editor Width', 'Horizontal reading space width', 'editorWidth') && (
        <SettingRow settingKey="editorWidth" label="Editor: Width" description="Controls the maximum width of the editor canvas inside the viewport column." modified={isModified('editorWidth')} onReset={() => resetSetting('editorWidth')}>
          <Segmented settingKey="editorWidth" options={['narrow', 'medium', 'wide', 'full']} />
        </SettingRow>
      )}

      {matches('Icon Style', 'Stroke weight of Lucide icons', 'iconStyle') && (
        <SettingRow settingKey="iconStyle" label="Appearance: Icon Style" description="Customize the visual stroke weight and sizing format for navigation sidebar icons." modified={isModified('iconStyle')} onReset={() => resetSetting('iconStyle')}>
          <Segmented settingKey="iconStyle" options={['clean', 'minimal', 'bold']} />
        </SettingRow>
      )}
    </div>
  );
}
