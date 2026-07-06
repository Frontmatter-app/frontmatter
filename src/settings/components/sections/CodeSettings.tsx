import React, { useState, useEffect } from 'react';
import { invoke } from '../../../filesystem/tauriCommands';
import { RuntimeListItem } from '../../../types';
import { useSettingsStore } from '../../settingsStore';
import { SettingRow } from '../SettingRow';

interface CodeSettingsProps {
  matches: (label: string, desc: string, key?: string) => boolean;
}

export function CodeSettings({ matches }: CodeSettingsProps) {
  const [runtimes, setRuntimes] = useState<RuntimeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLanguage, setNewLanguage] = useState('');
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadRuntimes = async () => {
    try {
      const data = await invoke<RuntimeListItem[]>('list_runtimes');
      setRuntimes(data);
    } catch (e) {
      console.error('Failed to load runtimes:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRuntimes();
  }, []);

  const addRuntime = async () => {
    if (!newLanguage.trim() || !newPath.trim()) return;
    setError(null);
    try {
      await invoke('add_runtime', {
        language: newLanguage.trim(),
        executablePath: newPath.trim(),
        runtimeType: 'system',
      });
      setNewLanguage('');
      setNewPath('');
      await loadRuntimes();
    } catch (e: any) {
      setError(e.message || 'Failed to add runtime');
    }
  };

  const removeRuntime = async (language: string) => {
    try {
      await invoke('remove_runtime', { language });
      await loadRuntimes();
    } catch (e: any) {
      setError(e.message || 'Failed to remove runtime');
    }
  };

  const setDefault = async (language: string, executablePath: string) => {
    try {
      await invoke('set_default_runtime', { language, executablePath });
      await loadRuntimes();
    } catch (e: any) {
      setError(e.message || 'Failed to set default');
    }
  };

  if (!matches('Code Execution', 'Runtime settings for code blocks')) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-semibold text-[var(--editor-text-color)]">Code Execution</div>
      <p className="text-sm text-[var(--editor-muted-color,#6a737d)]">
        Configure runtimes for executing code blocks. Provide the path to the executable, or use a system-installed runtime.
      </p>

      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {runtimes.map((rt) => (
          <div key={rt.language} className="flex items-center justify-between rounded-xl border border-[var(--editor-border,#e1e4e8)] bg-[var(--editor-bg-color)] px-4 py-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--editor-text-color)]">{rt.language}</span>
                {rt.is_default && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Default</span>
                )}
              </div>
              <div className="text-xs text-[var(--editor-muted-color,#6a737d)]">
                {rt.runtime_type} · {rt.executable_path}
                {rt.version && ` · ${rt.version}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!rt.is_default && (
                <button
                  onClick={() => setDefault(rt.language, rt.executable_path)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[var(--editor-code-bg,#f6f8fa)] hover:bg-[var(--editor-border,#e1e4e8)] transition-colors"
                >
                  Set Default
                </button>
              )}
              <button
                onClick={() => removeRuntime(rt.language)}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {runtimes.length === 0 && !loading && (
          <div className="text-sm text-[var(--editor-muted-color,#6a737d)] italic">
            No runtimes configured. Add one below to enable code execution.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-4 border-t border-[var(--editor-border,#e1e4e8)]">
        <div className="text-sm font-medium text-[var(--editor-text-color)]">Add Runtime</div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Language (e.g. python, node)"
            value={newLanguage}
            onChange={(e) => setNewLanguage(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--editor-border,#e1e4e8)] bg-[var(--editor-bg-color)] text-sm text-[var(--editor-text-color)] focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Executable path (e.g. /usr/bin/python3)"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--editor-border,#e1e4e8)] bg-[var(--editor-bg-color)] text-sm text-[var(--editor-text-color)] focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={addRuntime}
            disabled={!newLanguage.trim() || !newPath.trim()}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-[var(--editor-muted-color,#6a737d)]">
          Provide the path to the runtime executable. Marktype will use this to run code blocks.
        </p>
      </div>
    </div>
  );
}
