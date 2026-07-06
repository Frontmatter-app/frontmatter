import { Check, Code } from 'lucide-react';
import { DEFAULT_SETTINGS, Settings } from '../settingsStore';
import { showConfirmDialog } from '../../lib/tauriDialog';

interface JsonSettingsEditorProps {
  jsonText: string;
  jsonError: string | null;
  onJsonChange: (value: string) => void;
  onResetAll: (settings: Settings) => void;
}

export function JsonSettingsEditor({
  jsonText,
  jsonError,
  onJsonChange,
  onResetAll,
}: JsonSettingsEditorProps) {
  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Code className="w-5 h-5 text-purple-500" />
            settings.json
          </h3>
          <p className="text-xs opacity-50 mt-1 select-none">
            Directly edit configuration values. Syntactical changes are parsed and validated in real-time.
          </p>
        </div>
        <button
          onClick={async () => {
            const confirmed = await showConfirmDialog('Reset Settings', 'Reset ALL settings to default values? This cannot be undone.');
            if (confirmed) onResetAll(DEFAULT_SETTINGS);
          }}
          className="py-1 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 hover:text-red-600 rounded-xl font-bold text-xs select-none cursor-pointer"
        >
          Reset All Defaults
        </button>
      </div>

      <div className="flex-1 flex flex-col relative min-h-[300px]">
        <textarea
          value={jsonText}
          onChange={(event) => onJsonChange(event.target.value)}
          className="w-full h-full flex-1 p-5 font-mono text-xs bg-black/5 dark:bg-white/5 rounded-2xl border border-black/10 dark:border-white/10 outline-none text-[var(--editor-text-color)] resize-none"
          style={{
            fontFamily: 'var(--font-mono), monospace',
            lineHeight: '1.6',
          }}
          placeholder="// Settings JSON loading..."
          spellCheck={false}
        />

        {jsonError && (
          <div className="mt-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 font-mono text-[11px] leading-relaxed select-none">
            <strong>Syntax Error:</strong> {jsonError}
          </div>
        )}
        {!jsonError && (
          <div className="mt-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-semibold text-[11px] select-none flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> settings.json parsed successfully. App configuration synchronized.
          </div>
        )}
      </div>
    </div>
  );
}
