import React from 'react';
import type { SettingsGroupSpec } from '../settingsNav';
import './settingsSidebar.css';

interface SettingsCategorySidebarProps {
  groups: SettingsGroupSpec[];
  activeCategory: string | undefined;
  onSelectCategory: (categoryId: string) => void;
  searchQuery: string;
}

/**
 * Grouped settings navigation.
 *
 * The panel previously listed every category flat, which gave no indication of
 * what related to what. Categories are now grouped under headings, and a
 * search that matches nothing says so rather than rendering an empty rail.
 */
export function SettingsCategorySidebar({
  groups,
  activeCategory,
  onSelectCategory,
  searchQuery,
}: SettingsCategorySidebarProps) {
  if (groups.length === 0) {
    return (
      <nav className="settings-nav" aria-label="Settings categories">
        <p className="settings-nav__empty">
          Nothing matches “{searchQuery.trim()}”.
        </p>
      </nav>
    );
  }

  return (
    <nav className="settings-nav" aria-label="Settings categories">
      {groups.map((group) => (
        <div key={group.id} className="settings-nav__group">
          <h3 className="settings-nav__heading">{group.label}</h3>
          <ul className="settings-nav__list">
            {group.categories.map((category) => {
              const Icon = category.icon;
              const isActive = category.id === activeCategory;
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    className="settings-nav__item"
                    data-active={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelectCategory(category.id)}
                  >
                    <Icon className="settings-nav__icon" aria-hidden="true" />
                    <span className="settings-nav__label">{category.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
