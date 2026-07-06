import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import { usePlan } from '../billing/PlanProvider';
import { SlidersHorizontal, Type, Palette, Sliders, User, CreditCard, Users, RefreshCw, Code2, Eye, GitBranch } from 'lucide-react';
import { JsonSettingsEditor } from './components/JsonSettingsEditor';
import { SettingsCategorySidebar } from './components/SettingsCategorySidebar';
import { SettingsModalHeader } from './components/SettingsModalHeader';
import { GeneralSettings } from './components/sections/GeneralSettings';
import { EditorSettings } from './components/sections/EditorSettings';
import { AppearanceSettings } from './components/sections/AppearanceSettings';
import { ColorSettings } from './components/sections/ColorSettings';
import { AccountsSection } from './components/sections/AccountsSection';
import { BillingSection } from './components/sections/BillingSection';
import { TeamSection } from './components/sections/TeamSection';
import { UpdatesSection } from './components/sections/UpdatesSection';
import { CodeSettings } from './components/sections/CodeSettings';
import { LivePreviewSettings } from './components/sections/LivePreviewSettings';
import { VersionControlSettings } from './components/sections/VersionControlSettings';

interface SettingsModalProps { onClose?: () => void; }

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings, isSettingsOpen, activeSettingsCategory, openSettings, closeSettings } = useSettingsStore();
  const { isTeam } = usePlan();

  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<'ui' | 'json'>('ui');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'none' | 'available'>('idle');

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('menu-settings', () => openSettings('general')).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [openSettings]);

  useEffect(() => {
    try {
      if (jsonText) { const parsed = JSON.parse(jsonText); if (JSON.stringify(parsed) !== JSON.stringify(settings)) setJsonText(JSON.stringify(settings, null, 2)); }
      else setJsonText(JSON.stringify(settings, null, 2));
    } catch { setJsonText(JSON.stringify(settings, null, 2)); setJsonError(null); }
  }, [settings]);

  useEffect(() => { if (isSettingsOpen) { setJsonText(JSON.stringify(settings, null, 2)); setJsonError(null); setUpdateStatus('idle'); } }, [isSettingsOpen]);

  if (!isSettingsOpen) return null;

  const isDark = settings.themeType.startsWith('github_dark');
  const glassStyle: React.CSSProperties = { background: isDark ? 'rgba(15, 18, 25, 0.95)' : 'rgba(255, 255, 255, 0.98)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', color: 'var(--editor-text-color)' };

  const matches = (label: string, desc: string, key?: string) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return label.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || (key && key.toLowerCase().includes(q));
  };

  const categoryMatchCount = (catId: string) => {
    const CATEGORIES: Record<string, { label: string; desc: string; key: string }[]> = {
      general: [{ label: 'Auto Save', desc: 'Automatically save document edits', key: 'autoSave' }, { label: 'Auto Sync', desc: 'Automatically sync documents to cloud', key: 'autoSync' }, { label: 'Color Theme', desc: 'Choose color theme', key: 'themeType' }, { label: 'Editor Width', desc: 'Horizontal reading space width', key: 'editorWidth' }, { label: 'Icon Style', desc: 'Stroke weight of Lucide icons', key: 'iconStyle' }],
      editor: [{ label: 'Font Family', desc: 'Editor font family typography', key: 'fontFamily' }, { label: 'Font Size', desc: 'Editor font size', key: 'fontSize' }, { label: 'Line Height', desc: 'Line height multiplier', key: 'lineHeight' }, { label: 'Typewriter Mode', desc: 'Vertical cursor centering', key: 'typewriterMode' }, { label: 'Spell Check', desc: 'Native spell check', key: 'spellCheck' }, { label: 'Prose Lint', desc: 'Vale inline highlights', key: 'showProseLint' }],
      appearance: [{ label: 'Color Theme', desc: 'Choose color theme', key: 'themeType' }, { label: 'Icon Style', desc: 'Stroke weight', key: 'iconStyle' }],
      colors: [{ label: 'Text Color', desc: 'Custom primary text color hex', key: 'textColor' }, { label: 'Background Color', desc: 'Custom canvas background color hex', key: 'backgroundColor' }, { label: 'Secondary Background', desc: 'Custom sidebar background color hex', key: 'secondaryBgColor' }, { label: 'Note Background', desc: 'Custom note blocks color hex', key: 'noteBgColor' }, { label: 'Caret Color', desc: 'Custom editor cursor caret color hex', key: 'caretColor' }, { label: 'Selection Background', desc: 'Custom highlights selection background color hex', key: 'selectionBgColor' }, { label: 'Link Color', desc: 'Custom inline links color hex', key: 'linkColor' }],
      accounts: [{ label: 'Manage Accounts', desc: 'Toggle accounts or sign out', key: 'accounts' }],
      billing: [{ label: 'Plan Billing Subscription', desc: 'Manage subscription upgrade team seats', key: 'billing' }],
      updates: [{ label: 'Check for Updates', desc: 'Application updates client info version', key: 'updates' }],
      code: [{ label: 'Code Execution', desc: 'Runtime settings for code blocks', key: 'code' }],
      versionControl: [{ label: 'Enable Version Control', desc: 'Turn version control on or off', key: 'versionControl.enabled' }],
      preview: [
        { label: 'Headings', desc: 'Live-render ATX headings', key: 'livePreview.headings' },
        { label: 'Bold', desc: 'Render bold text', key: 'livePreview.bold' },
        { label: 'Italic', desc: 'Render italic text', key: 'livePreview.italic' },
        { label: 'Strikethrough', desc: 'Render strikethrough', key: 'livePreview.strikethrough' },
        { label: 'Inline Code', desc: 'Render inline code', key: 'livePreview.inlineCode' },
        { label: 'Links', desc: 'Render clickable links', key: 'livePreview.links' },
        { label: 'Images', desc: 'Render image widgets', key: 'livePreview.images' },
        { label: 'Checkboxes', desc: 'Render task checkboxes', key: 'livePreview.checkboxes' },
        { label: 'Tables', desc: 'Render table widgets', key: 'livePreview.tables' },
        { label: 'Code Blocks', desc: 'Style fenced code blocks', key: 'livePreview.fencedCode' },
        { label: 'Blockquotes', desc: 'Style blockquote lines', key: 'livePreview.blockquotes' },
        { label: 'Custom Block Tags', desc: 'Collapse custom block tags', key: 'livePreview.blockTags' },
      ],
    };
    return (CATEGORIES[catId] || []).filter(s => matches(s.label, s.desc, s.key)).length;
  };

  const categories = [
    { id: 'general', label: 'Commonly Used', icon: SlidersHorizontal },
    { id: 'editor', label: 'Text Editor', icon: Type },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'colors', label: 'Custom Colors', icon: Sliders },
    { id: 'preview', label: 'Live Preview', icon: Eye },
    { id: 'accounts', label: 'Accounts', icon: User },
    { id: 'billing', label: 'Plan & Billing', icon: CreditCard },
    { id: 'code', label: 'Code Execution', icon: Code2 },
    { id: 'versionControl', label: 'Version Control', icon: GitBranch },
    ...(isTeam ? [{ id: 'team', label: 'Teams', icon: Users }] : []),
    { id: 'updates', label: 'Application Updates', icon: RefreshCw },
  ];

  const visibleCategories = categories.filter(c => !searchQuery || categoryMatchCount(c.id) > 0);

  const handleJsonChange = (val: string) => {
    setJsonText(val);
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) {
        const requiredKeys = ['autoSave', 'autoSync', 'themeType', 'editorWidth', 'fontFamily', 'fontSize', 'lineHeight'];
        const missing = requiredKeys.filter(k => !(k in parsed));
        if (missing.length > 0) { setJsonError(`JSON is missing required settings keys: ${missing.join(', ')}`); return; }
        updateSettings(parsed); setJsonError(null);
      } else { setJsonError("Settings must be a valid JSON Object."); }
    } catch (e: any) { setJsonError(e.message || "Invalid JSON syntax"); }
  };

  const sectionProps = { matches };

  const renderSection = () => {
    switch (activeSettingsCategory) {
      case 'general': return <GeneralSettings {...sectionProps} />;
      case 'editor': return <EditorSettings {...sectionProps} />;
      case 'appearance': return <AppearanceSettings {...sectionProps} />;
      case 'colors': return <ColorSettings {...sectionProps} />;
      case 'accounts': return <AccountsSection />;
      case 'billing': return <BillingSection />;
      case 'team': return <TeamSection />;
      case 'preview': return <LivePreviewSettings matches={matches} />;
      case 'code': return <CodeSettings matches={matches} />;
      case 'updates': return <UpdatesSection checkingUpdates={checkingUpdates} updateStatus={updateStatus} onCheckUpdates={() => { setCheckingUpdates(true); setUpdateStatus('idle'); setTimeout(() => { setCheckingUpdates(false); setUpdateStatus(Math.random() > 0.5 ? 'available' : 'none'); }, 1500); }} onUpdateStatusChange={setUpdateStatus} />;
      case 'versionControl': return <VersionControlSettings {...sectionProps} />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[85vh] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden" style={glassStyle}>
        <SettingsModalHeader mode={mode} searchQuery={searchQuery} onModeChange={setMode} onSearchChange={setSearchQuery} onClose={() => { closeSettings(); onClose?.(); }} />
        <div className="flex-1 flex overflow-hidden w-full">
          {mode === 'ui' && <SettingsCategorySidebar activeCategory={activeSettingsCategory} categories={visibleCategories} searchQuery={searchQuery} categoryMatchCount={categoryMatchCount} onSelectCategory={openSettings} />}
          <div className="flex-1 overflow-y-auto bg-[var(--editor-bg-color)] p-6 md:p-8">
            {mode === 'ui' ? <div className="max-w-3xl flex flex-col gap-2">{renderSection()}</div> : (
              <JsonSettingsEditor jsonText={jsonText} jsonError={jsonError} onJsonChange={handleJsonChange} onResetAll={(next) => { updateSettings(next); setJsonText(JSON.stringify(next, null, 2)); setJsonError(null); }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
