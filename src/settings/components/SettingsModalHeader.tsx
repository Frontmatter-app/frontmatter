import { Code, Layout, Search, Settings as SettingsIcon, X } from 'lucide-react';

interface SettingsModalHeaderProps {
  mode: 'ui' | 'json';
  searchQuery: string;
  onModeChange: (mode: 'ui' | 'json') => void;
  onSearchChange: (query: string) => void;
  onClose: () => void;
}

export function SettingsModalHeader({
  mode,
  searchQuery,
  onModeChange,
  onSearchChange,
  onClose,
}: SettingsModalHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 flex-shrink-0 bg-black/5 dark:bg-white/2">
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        <SettingsIcon className="w-5 h-5 text-blue-500" />
        <h2 className="font-bold text-base select-none">Settings</h2>

        <div className="relative flex-1 ml-4">
          <Search className="w-4 h-4 opacity-40 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full pl-9 pr-8 py-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-[var(--editor-bg-color)] text-[var(--editor-text-color)] text-xs outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-2 text-xs opacity-50 hover:opacity-100 cursor-pointer"
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center bg-black/10 dark:bg-white/10 rounded-xl p-0.5 border border-black/5 dark:border-white/5">
          <button
            onClick={() => onModeChange('ui')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition cursor-pointer ${
              mode === 'ui'
                ? 'bg-[var(--editor-bg-color)] text-[var(--editor-text-color)] shadow-sm'
                : 'opacity-60 hover:opacity-100'
            }`}
          >
            <Layout className="w-3.5 h-3.5 text-blue-500" />
            UI
          </button>
          <button
            onClick={() => onModeChange('json')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition cursor-pointer ${
              mode === 'json'
                ? 'bg-[var(--editor-bg-color)] text-[var(--editor-text-color)] shadow-sm'
                : 'opacity-60 hover:opacity-100'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-purple-500" />
            JSON
          </button>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-red-500 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
