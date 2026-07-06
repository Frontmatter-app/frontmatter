import React from 'react';
import { Type } from 'lucide-react';
import { useSettingsStore, DEFAULT_SETTINGS, Settings } from '../../settingsStore';
import { SettingRow } from '../SettingRow';
import { FontPicker } from '../FontPicker';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function EditorSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const isModified = (key: keyof Settings) => JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]);
  const resetSetting = (key: keyof Settings) => updateSettings({ [key]: DEFAULT_SETTINGS[key] });

  const Toggle = ({ settingKey }: { settingKey: keyof Settings }) => (
    <button
      onClick={() => updateSettings({ [settingKey]: !settings[settingKey] } as any)}
      className="cursor-pointer py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10"
    >
      <span className={`w-2 h-2 rounded-full ${settings[settingKey] ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {settings[settingKey] ? 'Enabled' : 'Disabled'}
    </button>
  );

  const NumberInput = ({ settingKey }: { settingKey: keyof Settings }) => (
    <input
      type="text"
      value={settings[settingKey] as string}
      onChange={(e) => updateSettings({ [settingKey]: e.target.value } as any)}
      className="p-1.5 text-xs bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl outline-none text-center max-w-[80px]"
    />
  );

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <Type className="w-5 h-5 text-blue-500" />
        Text Editor Configuration
      </h3>

      {matches('Font Family', 'Editor font family typography', 'fontFamily') && (
        <SettingRow settingKey="fontFamily" label="Editor: Font Family" description="Choose the editor font from all fonts installed on your computer." modified={isModified('fontFamily')} onReset={() => resetSetting('fontFamily')}>
          <FontPicker value={settings.fontFamily} onChange={(fontFamily) => updateSettings({ fontFamily })} />
        </SettingRow>
      )}

      {matches('Font Size', 'Editor font size', 'fontSize') && (
        <SettingRow settingKey="fontSize" label="Editor: Font Size" description="Controls the general font size in pixels for content character styling." modified={isModified('fontSize')} onReset={() => resetSetting('fontSize')}>
          <NumberInput settingKey="fontSize" />
        </SettingRow>
      )}

      {matches('Line Height', 'Line height multiplier', 'lineHeight') && (
        <SettingRow settingKey="lineHeight" label="Editor: Line Height" description="Controls the vertical spacing multiplier for readable editor line flow." modified={isModified('lineHeight')} onReset={() => resetSetting('lineHeight')}>
          <NumberInput settingKey="lineHeight" />
        </SettingRow>
      )}

      {matches('Typewriter Mode', 'Vertical cursor centering centering', 'typewriterMode') && (
        <SettingRow settingKey="typewriterMode" label="Editor: Typewriter Mode" description="Forces the cursor line to remain centered vertically inside the viewport canvas." modified={isModified('typewriterMode')} onReset={() => resetSetting('typewriterMode')}>
          <Toggle settingKey="typewriterMode" />
        </SettingRow>
      )}

      {matches('Spell Check', 'Native spell check', 'spellCheck') && (
        <SettingRow settingKey="spellCheck" label="Editor: Spell Check" description="Enables or disables native browser spell checker underlining inside the writing window." modified={isModified('spellCheck')} onReset={() => resetSetting('spellCheck')}>
          <Toggle settingKey="spellCheck" />
        </SettingRow>
      )}

      {matches('Prose Lint', 'Vale inline highlights for grammar and style issues', 'showProseLint') && (
        <SettingRow settingKey="showProseLint" label="Editor: Prose Lint" description="Shows colored squiggly underlines for Vale style, grammar, and accessibility issues." modified={isModified('showProseLint')} onReset={() => resetSetting('showProseLint')}>
          <Toggle settingKey="showProseLint" />
        </SettingRow>
      )}
    </div>
  );
}
