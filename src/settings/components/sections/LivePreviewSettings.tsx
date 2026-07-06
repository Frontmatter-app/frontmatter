import React from 'react';
import { Eye } from 'lucide-react';
import { useSettingsStore, DEFAULT_LIVE_PREVIEW, DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX } from '../../settingsStore';
import type { LivePreviewElementKey, LivePreviewHideSyntaxKey } from '../../settingsStore';
import { SettingRow } from '../SettingRow';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function LivePreviewSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const livePreview = settings.livePreview;

  const toggle = (key: LivePreviewElementKey) => {
    updateSettings({
      livePreview: { ...livePreview, [key]: !livePreview[key] },
    });
  };

  const toggleHideSyntax = (key: LivePreviewHideSyntaxKey) => {
    updateSettings({
      livePreview: {
        ...livePreview,
        hideSyntax: {
          ...livePreview.hideSyntax,
          [key]: !livePreview.hideSyntax[key],
        },
      },
    });
  };

  const canHideSyntax = (key: LivePreviewElementKey): key is LivePreviewHideSyntaxKey =>
    key !== 'tables' && key !== 'fencedCode' && key !== 'diagrams';

  const isModified = (key: LivePreviewElementKey) =>
    livePreview[key] !== DEFAULT_LIVE_PREVIEW[key] ||
    (canHideSyntax(key) && livePreview.hideSyntax[key] !== DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX[key]);

  const resetSetting = (key: LivePreviewElementKey) => {
    updateSettings({
      livePreview: {
        ...livePreview,
        [key]: DEFAULT_LIVE_PREVIEW[key],
        hideSyntax: canHideSyntax(key)
          ? {
              ...livePreview.hideSyntax,
              [key]: DEFAULT_LIVE_PREVIEW_HIDE_SYNTAX[key],
            }
          : livePreview.hideSyntax,
      },
    });
  };

  const Toggle = ({ settingKey }: { settingKey: LivePreviewElementKey }) => (
    <button
      onClick={() => toggle(settingKey)}
      className="cursor-pointer py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10"
    >
      <span className={`w-2 h-2 rounded-full ${livePreview[settingKey] ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {livePreview[settingKey] ? 'On' : 'Off'}
    </button>
  );

  const HideSyntaxToggle = ({ settingKey }: { settingKey: LivePreviewHideSyntaxKey }) => {
    const disabled = !livePreview[settingKey];

    return (
      <button
        onClick={() => !disabled && toggleHideSyntax(settingKey)}
        disabled={disabled}
        title={disabled ? 'Enable preview first' : 'Toggle markdown syntax visibility'}
        className={`py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none ${
          disabled
            ? 'opacity-40 cursor-not-allowed'
            : 'cursor-pointer hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${livePreview.hideSyntax[settingKey] ? 'bg-emerald-500' : 'bg-gray-400'}`} />
        Hide syntax {livePreview.hideSyntax[settingKey] ? 'On' : 'Off'}
      </button>
    );
  };

  const items: { key: LivePreviewElementKey; label: string; desc: string }[] = [
    { key: 'headings', label: 'Headings', desc: 'Live-render ATX headings (##, ###, etc.) with styled font sizes and weight.' },
    { key: 'bold', label: 'Bold', desc: 'Render **bold** and __bold__ text with bold font weight.' },
    { key: 'italic', label: 'Italic', desc: 'Render *italic* and _italic_ text with italic font style.' },
    { key: 'strikethrough', label: 'Strikethrough', desc: 'Render ~~strikethrough~~ text with line-through decoration.' },
    { key: 'inlineCode', label: 'Inline Code', desc: 'Render `inline code` with monospace font and background highlight.' },
    { key: 'links', label: 'Links', desc: 'Render [markdown links](url) as clickable anchor elements with underline.' },
    { key: 'images', label: 'Images', desc: 'Render ![image alt](url) as inline or block-level image widgets.' },
    { key: 'checkboxes', label: 'Checkboxes', desc: 'Render task list - [x] markers as interactive checkbox widgets.' },
    { key: 'tables', label: 'Tables', desc: 'Render markdown tables as styled HTML table widgets when not actively editing.' },
    { key: 'fencedCode', label: 'Code Blocks', desc: 'Apply distinct styling to fenced code block fences and content lines.' },
    { key: 'math', label: 'Math', desc: 'Render inline $math$ and block $$ math $$ with KaTeX.' },
    { key: 'diagrams', label: 'Diagrams', desc: 'Render ```mermaid fenced blocks as diagram previews when not actively editing.' },
    { key: 'blockquotes', label: 'Blockquotes', desc: 'Apply blockquote line styling to > quoted lines.' },
    { key: 'blockTags', label: 'Custom Block Tags', desc: 'Collapse <note>, <warning>, <tabs>, and other custom block tags.' },
  ];

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <Eye className="w-5 h-5 text-blue-500" />
        Live Preview Elements
      </h3>

      {items.map(({ key, label, desc }) =>
        matches(label, desc, `livePreview.${key}`) ? (
          <SettingRow
            key={key}
            settingKey={`livePreview.${key}`}
            label={label}
            description={desc}
            modified={isModified(key)}
            onReset={() => resetSetting(key)}
          >
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Toggle settingKey={key} />
              {canHideSyntax(key) && <HideSyntaxToggle settingKey={key} />}
            </div>
          </SettingRow>
        ) : null
      )}
    </div>
  );
}
