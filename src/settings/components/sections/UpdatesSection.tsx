import React from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  checkingUpdates: boolean;
  updateStatus: 'idle' | 'none' | 'available';
  onCheckUpdates: () => void;
  onUpdateStatusChange: (s: 'idle' | 'none' | 'available') => void;
}

export function UpdatesSection({ checkingUpdates, updateStatus, onCheckUpdates, onUpdateStatusChange }: Props) {
  return (
    <div>
      <h3 className="text-base font-bold mb-4 flex items-center gap-2">
        <RefreshCw className="w-5 h-5 text-blue-500" /> Application Updates
      </h3>
      <div className="border border-black/5 dark:border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4 bg-black/5 dark:bg-white/2">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
          <RefreshCw className={`w-6 h-6 ${checkingUpdates ? 'animate-spin' : ''}`} />
        </div>
        <div>
          <span className="font-bold text-sm block">Frontmatter Workspace App</span>
          <span className="text-xs opacity-50 block mt-0.5">Current Version: v1.0.0</span>
        </div>
        {checkingUpdates && <p className="text-xs text-blue-500 font-semibold animate-pulse">Contacting updates server...</p>}
        {!checkingUpdates && updateStatus === 'idle' && (
          <button onClick={onCheckUpdates} className="py-2 px-5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm">
            Check for Updates
          </button>
        )}
        {updateStatus === 'none' && (
          <div className="text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-4 py-2 rounded-2xl border border-emerald-500/10">
            ✓ You are using the latest release of Frontmatter.
          </div>
        )}
        {updateStatus === 'available' && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-semibold text-blue-500 bg-blue-500/10 px-4 py-2 rounded-2xl border border-blue-500/10">★ New update available (v1.0.1)</div>
            <span className="text-[10px] opacity-50 block max-w-sm mt-1 leading-relaxed">
              Includes improved visual theme variables, bi-directional settings syncing, and CodeMirror editor font rendering enhancements.
            </span>
            <button onClick={() => onUpdateStatusChange('idle')} className="py-1.5 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer mt-2">
              Install v1.0.1
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
