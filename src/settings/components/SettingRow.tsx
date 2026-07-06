import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { Settings } from '../settingsStore';

interface SettingRowProps {
  key?: React.Key;
  settingKey: keyof Settings | string;
  label: string;
  description: string;
  modified: boolean;
  onReset: () => void;
  children: React.ReactNode;
}

export function SettingRow({
  settingKey,
  label,
  description,
  modified,
  onReset,
  children,
}: SettingRowProps) {
  return (
    <div
      className={`group relative flex flex-col md:flex-row md:items-start justify-between py-5 border-b border-black/5 dark:border-white/5 transition-all ${
        modified ? 'bg-blue-500/2 dark:bg-blue-500/1' : ''
      }`}
      style={{
        borderLeft: modified ? '3px solid var(--editor-link-color, #0969da)' : '3px solid transparent',
        paddingLeft: '1rem',
      }}
    >
      <div className="flex-1 pr-6">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm select-none">{label}</span>
          {modified && (
            <button
              onClick={onReset}
              title="Reset setting to default"
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-[#0969da] dark:text-[#58a6ff] hover:underline transition-all cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
        <p className="text-xs opacity-60 mt-1.5 leading-relaxed select-none">{description}</p>
        {settingKey && (
          <code className="text-[10px] opacity-40 mt-2 block font-mono">
            settings.{settingKey}
          </code>
        )}
      </div>
      <div className="mt-4 md:mt-0 flex-shrink-0 flex items-center min-w-[180px] justify-end">
        {children}
      </div>
    </div>
  );
}
