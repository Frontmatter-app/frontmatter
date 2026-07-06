import React from 'react';
import { Sliders } from 'lucide-react';
import { useSettingsStore, DEFAULT_SETTINGS, Settings } from '../../settingsStore';
import { SettingRow } from '../SettingRow';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

const COLOR_FIELDS = [
  { key: 'textColor' as const, label: 'Custom: Text Color', desc: 'Hex value overrides for editor and general workspace text layout color.', hasPicker: true },
  { key: 'backgroundColor' as const, label: 'Custom: Canvas Background Color', desc: 'Overrides the default primary page text block container background.', hasPicker: true },
  { key: 'secondaryBgColor' as const, label: 'Custom: Secondary Background Color', desc: 'Secondary colors overrides sidebars background, folder lists, context containers.', hasPicker: true },
  { key: 'noteBgColor' as const, label: 'Custom: Note Background Color', desc: 'Background color overrides for side cards, annotation labels, draft notes background.', hasPicker: true },
  { key: 'caretColor' as const, label: 'Custom: Caret Color', desc: 'Hex value overrides for editor writing blinking cursor line.', hasPicker: true },
  { key: 'selectionBgColor' as const, label: 'Custom: Selection Background Color', desc: 'Selection overlays color when text blocks are highlighted inside editor.', hasPicker: false },
  { key: 'linkColor' as const, label: 'Custom: Link Color', desc: 'Color overrides for clickable hyperlinks embedded within pages.', hasPicker: true },
] as const;

export function ColorSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const isColorModified = (colorKey: keyof Settings['customColors']) => settings.customColors[colorKey] !== DEFAULT_SETTINGS.customColors[colorKey];
  const resetColorSetting = (colorKey: keyof Settings['customColors']) => {
    updateSettings({ themeType: 'custom', customColors: { ...settings.customColors, [colorKey]: DEFAULT_SETTINGS.customColors[colorKey] } });
  };
  const updateColor = (colorKey: keyof Settings['customColors'], value: string) => {
    updateSettings({ themeType: 'custom', customColors: { ...settings.customColors, [colorKey]: value } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 border-b border-black/10 dark:border-white/10 pb-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Sliders className="w-5 h-5 text-blue-500" />
          Custom Palette Override
        </h3>
        <button
          onClick={() => updateSettings({ themeType: 'custom', customColors: { ...DEFAULT_SETTINGS.customColors } })}
          className="py-1 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-semibold text-[10px] flex items-center gap-1.5 select-none hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer text-gray-500"
        >
          Reset All Colors
        </button>
      </div>

      <p className="text-xs opacity-60 mb-6 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/10 rounded-2xl p-4.5">
        Customizing any of these values automatically switches the primary theme type to <strong>"Custom Theme colors"</strong>.
      </p>

      <div className="flex flex-col">
        {COLOR_FIELDS.map(({ key, label, desc, hasPicker }) =>
          matches(label.split(': ')[1], desc, key) && (
            <SettingRow key={key} settingKey={`customColors.${key}`} label={label} description={desc} modified={isColorModified(key)} onReset={() => resetColorSetting(key)}>
              <div className="flex items-center gap-2">
                {hasPicker && (
                  <input
                    type="color"
                    value={settings.customColors[key]}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="w-7 h-7 rounded border border-black/10 outline-none cursor-pointer"
                  />
                )}
                <input
                  type="text"
                  value={settings.customColors[key]}
                  onChange={(e) => updateColor(key, e.target.value)}
                  className="p-1.5 text-xs bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl outline-none font-mono text-center max-w-[80px]"
                />
              </div>
            </SettingRow>
          )
        )}
      </div>
    </div>
  );
}
