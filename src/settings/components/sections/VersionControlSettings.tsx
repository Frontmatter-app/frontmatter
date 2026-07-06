import React from 'react';
import { GitBranch } from 'lucide-react';
import { useSettingsStore, DEFAULT_VERSION_CONTROL, type VersionControlSettings } from '../../settingsStore';

interface Props {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function VersionControlSettings({ matches }: Props) {
  const { settings, updateSettings } = useSettingsStore();
  const vc = settings.versionControl;

  const updateVC = (partial: Partial<VersionControlSettings>) => {
    updateSettings({ versionControl: { ...vc, ...partial } });
  };

  const isModified = (key: keyof VersionControlSettings) =>
    JSON.stringify(vc[key]) !== JSON.stringify(DEFAULT_VERSION_CONTROL[key]);

  const resetVC = (key: keyof VersionControlSettings) => {
    updateVC({ [key]: DEFAULT_VERSION_CONTROL[key] });
  };

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!value)}
      className="cursor-pointer py-1.5 px-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl font-medium text-xs flex items-center gap-2 select-none hover:bg-black/10 hover:border-black/20 dark:hover:bg-white/10"
    >
      <span className={`w-2 h-2 rounded-full ${value ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
      {value ? 'Enabled' : 'Disabled'}
    </button>
  );

  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <GitBranch className="w-5 h-5 text-blue-500" />
        Version Control Settings
      </h3>

      {matches('Enable Version Control', 'Turn version control on or off for the current workspace', 'versionControl.enabled') && (
        <div className="group relative flex flex-col md:flex-row md:items-start justify-between py-5 border-b border-black/5 dark:border-white/5 transition-all"
          style={{
            borderLeft: isModified('enabled') ? '3px solid var(--editor-link-color, #0969da)' : '3px solid transparent',
            paddingLeft: '1rem',
          }}
        >
          <div className="flex-1 pr-6">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm select-none">Enable Version Control</span>
              {isModified('enabled') && (
                <button onClick={() => resetVC('enabled')} title="Reset to default" className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-[#0969da] dark:text-[#58a6ff] hover:underline transition-all cursor-pointer">
                  Reset
                </button>
              )}
            </div>
            <p className="text-xs opacity-60 mt-1.5 leading-relaxed select-none">Turn version control (git) on or off for the current workspace. When disabled, the Version Control panel is hidden from the sidebar.</p>
            <code className="text-[10px] opacity-40 mt-2 block font-mono">settings.versionControl.enabled</code>
          </div>
          <div className="mt-4 md:mt-0 flex-shrink-0 flex items-center min-w-[180px] justify-end">
            <Toggle value={vc.enabled} onChange={(v) => updateVC({ enabled: v })} />
          </div>
        </div>
      )}

    </div>
  );
}