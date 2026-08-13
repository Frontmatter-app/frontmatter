import React, { useMemo, useState } from 'react';
import { getShortcutGroups } from '../keyboard/shortcuts';
import { DsInput, DsModal } from '../design/components';
import './keyboardShortcutsModal.css';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Filters groups to shortcuts matching `query`, dropping any left empty. */
export function filterShortcutGroups(
  groups: ReturnType<typeof getShortcutGroups>,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;

  return groups
    .map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter(
        (shortcut) =>
          shortcut.description.toLowerCase().includes(needle) ||
          shortcut.keys.join(' ').toLowerCase().includes(needle) ||
          group.title.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.shortcuts.length > 0);
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const [query, setQuery] = useState('');
  const allGroups = useMemo(() => getShortcutGroups(), []);
  const groups = useMemo(() => filterShortcutGroups(allGroups, query), [allGroups, query]);

  return (
    <DsModal
      open={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      subtitle="Every command available from the keyboard."
      wide
    >
      <div className="shortcuts__search">
        <DsInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          autoComplete="off"
        />
      </div>

      {groups.length === 0 ? (
        <p className="shortcuts__empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        <div className="shortcuts">
          {groups.map((group) => (
            <section key={group.title} className="shortcuts__group">
              <h3 className="shortcuts__heading">{group.title}</h3>
              <dl className="shortcuts__list">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.description} className="shortcuts__row">
                    <dt className="shortcuts__description">{shortcut.description}</dt>
                    <dd className="shortcuts__keys">
                      {shortcut.keys.map((key, index) => (
                        <kbd key={`${shortcut.description}-${index}`} className="shortcuts__key">
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </DsModal>
  );
}
