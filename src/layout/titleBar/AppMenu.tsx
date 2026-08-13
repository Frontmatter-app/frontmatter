import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { NmMenu, NmMenuItem, NmMenuLabel, NmMenuSeparator } from '../../design/components';
import { APP_MENUS, splitEventAndPayload, type MenuSpec } from './menuSpec';
import './appMenu.css';

interface AppMenuProps {
  hasDocument: boolean;
  hasWorkspace: boolean;
}

/**
 * In-window application menu.
 *
 * Dispatches the same Tauri events as the native menu, so every command has one
 * implementation. On macOS the native menu bar is authoritative and this is a
 * convenience; on Windows and Linux it is the only menu.
 */
export function AppMenu({ hasDocument, hasWorkspace }: AppMenuProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenMenuId(null), []);

  useEffect(() => {
    if (!openMenuId) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuId, close]);

  const isDisabled = (item: { needsDocument?: boolean; needsWorkspace?: boolean }) =>
    (item.needsDocument === true && !hasDocument) ||
    (item.needsWorkspace === true && !hasWorkspace);

  const run = useCallback(
    (rawEvent: string) => {
      close();
      const [name, payload] = splitEventAndPayload(rawEvent);
      emit(name, payload).catch((error) => {
        console.error(`[menu] could not dispatch ${name}`, error);
      });
    },
    [close],
  );

  const renderMenu = (menu: MenuSpec) => (
    <div key={menu.id} className="app-menu__slot">
      <button
        type="button"
        className="app-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={openMenuId === menu.id}
        data-open={openMenuId === menu.id}
        onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
        // Once one menu is open, hovering another switches to it, as menu bars do.
        onMouseEnter={() => setOpenMenuId((current) => (current ? menu.id : current))}
      >
        {menu.label}
      </button>

      {openMenuId === menu.id && (
        <div className="app-menu__dropdown">
          <NmMenu aria-label={menu.label}>
            {menu.groups.map((group, groupIndex) => (
              <React.Fragment key={group.label ?? groupIndex}>
                {groupIndex > 0 && !group.label && <NmMenuSeparator />}
                {group.label && <NmMenuLabel>{group.label}</NmMenuLabel>}
                {group.items.map((item) => (
                  <NmMenuItem
                    key={item.event}
                    shortcut={item.shortcut}
                    danger={item.danger}
                    disabled={isDisabled(item)}
                    onClick={() => run(item.event)}
                  >
                    {item.label}
                  </NmMenuItem>
                ))}
              </React.Fragment>
            ))}
          </NmMenu>
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="app-menu" role="menubar" aria-label="Application">
      {APP_MENUS.map(renderMenu)}
    </div>
  );
}
