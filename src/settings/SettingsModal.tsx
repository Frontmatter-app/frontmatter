import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import {
  SETTINGS_NAV,
  findCategory,
  resolveActiveCategory,
  searchSettingsNav,
  visibleSettingsNav,
} from './settingsNav';
import '../design/system.css';
import { usePlan } from '../billing/PlanProvider';
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

  const availableNav = visibleSettingsNav(SETTINGS_NAV, { isTeam });
  const navGroups = searchSettingsNav(availableNav, searchQuery);
  const activeCategory = resolveActiveCategory(navGroups, activeSettingsCategory);
  const activeSpec = activeCategory ? findCategory(availableNav, activeCategory) : undefined;

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
    switch (activeCategory) {
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
    <div className="ds-overlay">
      <div className="ds-modal ds-modal--wide" role="dialog" aria-modal="true" aria-label="Settings" style={{ height: '85vh', maxHeight: '85vh' }}>
        <SettingsModalHeader
          mode={mode}
          searchQuery={searchQuery}
          onModeChange={setMode}
          onSearchChange={setSearchQuery}
          onClose={() => { closeSettings(); onClose?.(); }}
        />

        <div className="flex-1 flex gap-4 overflow-hidden w-full px-4 pb-4 min-h-0">
          {mode === 'ui' && (
            <SettingsCategorySidebar
              groups={navGroups}
              activeCategory={activeCategory}
              searchQuery={searchQuery}
              onSelectCategory={openSettings}
            />
          )}

          <div className="flex-1 overflow-y-auto min-w-0">
            {mode === 'ui' ? (
              <div className="max-w-3xl flex flex-col gap-2 p-2">
                {activeSpec && (
                  <header className="mb-2">
                    <h2 className="ds-modal__title">{activeSpec.label}</h2>
                    <p className="ds-modal__subtitle">{activeSpec.description}</p>
                  </header>
                )}
                {renderSection()}
              </div>
            ) : (
              <JsonSettingsEditor
                jsonText={jsonText}
                jsonError={jsonError}
                onJsonChange={handleJsonChange}
                onResetAll={(next) => { updateSettings(next); setJsonText(JSON.stringify(next, null, 2)); setJsonError(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
