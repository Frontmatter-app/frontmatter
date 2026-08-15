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

      {matches('Prose Lint', 'Readability highlights for hard sentences, adverbs and passive voice', 'showProseLint') && (
        <SettingRow settingKey="showProseLint" label="Editor: Prose Lint" description="Highlights hard-to-read sentences, adverbs, passive voice and wordy phrases so you can see what is slowing a reader down." modified={isModified('showProseLint')} onReset={() => resetSetting('showProseLint')}>
          <Toggle settingKey="showProseLint" />
        </SettingRow>
      )}

      {matches('Grammar Check', 'Offline grammar and spelling checking', 'grammarCheck') && (
        <SettingRow settingKey="grammarCheck" label="Editor: Grammar Check" description="Checks grammar and spelling while revising. Runs entirely on this machine — nothing you write is sent anywhere." modified={isModified('grammarCheck')} onReset={() => resetSetting('grammarCheck')}>
          <Toggle settingKey="grammarCheck" />
        </SettingRow>
      )}

      {matches('Auto Correct', 'Fix typos and capitalization while revising', 'autoCorrect') && (
        <SettingRow settingKey="autoCorrect" label="Editor: Auto Correct" description="In Revise mode, fixes common misspellings, capitalizes the start of a sentence, and removes a stray double space. Never runs inside code, links or front matter." modified={isModified('autoCorrect')} onReset={() => resetSetting('autoCorrect')}>
          <Toggle settingKey="autoCorrect" />
        </SettingRow>
      )}

      {matches('Smart Punctuation', 'Curly quotes, em dashes and ellipses while revising', 'smartPunctuation') && (
        <SettingRow settingKey="smartPunctuation" label="Editor: Smart Punctuation" description="In Revise mode, converts straight quotes to curly ones, a double hyphen to an em dash, and three dots to an ellipsis." modified={isModified('smartPunctuation')} onReset={() => resetSetting('smartPunctuation')}>
          <Toggle settingKey="smartPunctuation" />
        </SettingRow>
      )}
    </div>
  );
}
