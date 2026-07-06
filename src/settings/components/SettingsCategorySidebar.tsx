import type { LucideIcon } from 'lucide-react';

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SettingsCategorySidebarProps {
  activeCategory: string;
  categories: SettingsCategory[];
  searchQuery: string;
  categoryMatchCount: (categoryId: string) => number;
  onSelectCategory: (categoryId: string) => void;
}

export function SettingsCategorySidebar({
  activeCategory,
  categories,
  searchQuery,
  categoryMatchCount,
  onSelectCategory,
}: SettingsCategorySidebarProps) {
  return (
    <div className="w-[200px] border-r border-black/10 dark:border-white/10 flex-shrink-0 flex flex-col p-3 bg-black/5 dark:bg-white/2 select-none overflow-y-auto">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-3 mb-2 block">
        Categories
      </span>
      <div className="flex flex-col gap-1">
        {categories.map((category) => {
          const Icon = category.icon;
          const isActive = activeCategory === category.id;
          const matchesCount = searchQuery ? categoryMatchCount(category.id) : 0;
          return (
            <button
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70 hover:opacity-100'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-500' : 'opacity-70'}`} />
                <span className="truncate">{category.label}</span>
              </div>
              {searchQuery && (
                <span className="text-[9px] bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded-full font-mono">
                  {matchesCount}
                </span>
              )}
            </button>
          );
        })}
        {categories.length === 0 && (
          <div className="text-[11px] italic opacity-40 px-3 py-2 text-center">
            No matching categories
          </div>
        )}
      </div>
    </div>
  );
}
