import React from 'react';
import { GitBranch } from 'lucide-react';
import { useSettingsStore, DEFAULT_VERSION_CONTROL, type VersionControlSettings } from '../../settingsStore';
import { ConnectForgePanel } from '../../../forge/ConnectForgePanel';
import { DsSelect } from '../../../design/components';
import { COMMIT_POLICY_LABELS, type CommitPolicy } from '../../../forge/commitPolicy';

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

      {/* The provider connection belongs with git rather than under Accounts:
          it authorises pushing to repositories, not signing in to Frontmatter,
          and those are different grants with different consequences. */}
      {matches('Git provider', 'Connect GitHub to open repositories and commit', 'forge.connection') && (
        <div className="py-5 border-b border-black/5 dark:border-white/5" style={{ paddingLeft: '1rem' }}>
          <ConnectForgePanel kind="github" />
        </div>
      )}

      {/* Explicit by default. The room's own default is `on-empty`, which fits a
          document whose only home is the repository; a workspace document is
          also a file on disk, so a commit appearing because someone closed a
          tab would be a surprise rather than a safeguard. */}
      {matches('Automatic commits', 'When an open document is committed to its repository', 'versionControl.commitPolicy') && (
        <div className="group relative flex flex-col md:flex-row md:items-start justify-between py-5 border-b border-black/5 dark:border-white/5 transition-all"
          style={{
            borderLeft: isModified('commitPolicy') ? '3px solid var(--editor-link-color, #0969da)' : '3px solid transparent',
            paddingLeft: '1rem',
          }}
        >
          <div className="flex-1 pr-6">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm select-none">Automatic commits</span>
              {isModified('commitPolicy') && (
                <button onClick={() => resetVC('commitPolicy')} title="Reset to default" className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-[#0969da] dark:text-[#58a6ff] hover:underline transition-all cursor-pointer">
                  Reset
                </button>
              )}
            </div>
            <p className="text-xs opacity-60 mt-1.5 leading-relaxed select-none">
              When the open document is committed to its repository through your connected provider.
              Committing yourself always works, whatever this is set to.
            </p>
            <code className="text-[10px] opacity-40 mt-2 block font-mono">settings.versionControl.commitPolicy</code>
          </div>
          <div className="mt-4 md:mt-0 flex-shrink-0 flex items-center min-w-[180px] justify-end">
            <DsSelect
              value={vc.commitPolicy}
              aria-label="Automatic commits"
              onChange={(e) => updateVC({ commitPolicy: e.target.value as CommitPolicy })}
            >
              {(Object.keys(COMMIT_POLICY_LABELS) as CommitPolicy[]).map((policy) => (
                <option key={policy} value={policy}>
                  {COMMIT_POLICY_LABELS[policy]}
                </option>
              ))}
            </DsSelect>
          </div>
        </div>
      )}

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