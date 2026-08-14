import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A positioned context menu.
 *
 * It used to take one optional callback per possible action plus eight booleans
 * describing the clicked node, and decide internally which combination to
 * render — so adding an action meant touching both the menu and every caller,
 * and the folder and file branches drifted apart. It now renders the items it
 * is handed; deciding which items exist is the caller's job.
 */

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  muted?: boolean;
  accent?: string;
}

export type ContextMenuEntry = ContextMenuItem | { id: string; divider: true };

const isDivider = (entry: ContextMenuEntry): entry is { id: string; divider: true } =>
  'divider' in entry;

interface SidebarContextMenuProps {
  position: { x: number; y: number } | null;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function SidebarContextMenu({ position, items, onClose }: SidebarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape key or clicking outside
  useEffect(() => {
    if (!position) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 80);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
      clearTimeout(t);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Drop leading, trailing, and doubled dividers so callers can emit them
  // unconditionally around optional groups.
  const entries = items.filter((entry, index) => {
    if (!isDivider(entry)) return true;
    const before = items.slice(0, index).filter(e => !isDivider(e)).length;
    const after = items.slice(index + 1).filter(e => !isDivider(e)).length;
    if (before === 0 || after === 0) return false;
    return !isDivider(items[index - 1]);
  });

  if (entries.length === 0) return null;

  const MENU_W = 220;
  const estimatedHeight = entries.length * 34 + 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = position.x + 4;
  let y = position.y + 4;
  if (x + MENU_W > vw - 12) x = position.x - MENU_W - 4;
  if (y + estimatedHeight > vh - 12) y = Math.max(8, vh - estimatedHeight - 12);
  x = Math.max(8, x);
  y = Math.max(8, y);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: y,
    left: x,
    width: MENU_W,
    zIndex: 99999,
    borderRadius: 12,
    overflow: 'hidden',
    background: 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)',
    backdropFilter: 'blur(20px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
    border: '1px solid var(--editor-border, rgba(128,128,128,0.15))',
    boxShadow: '0 10px 30px color-mix(in srgb, var(--editor-text-color, #000) 12%, transparent), 0 2px 6px color-mix(in srgb, var(--editor-text-color, #000) 6%, transparent)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    userSelect: 'none',
    padding: '4px 0',
  };

  const dividerStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--editor-border, rgba(128,128,128,0.12))',
    margin: '4px 0',
  };

  const itemStyle = (item: ContextMenuItem): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: item.danger
      ? 'var(--editor-error, #e11d48)'
      : item.accent
        ? item.accent
        : item.muted
          ? 'color-mix(in srgb, var(--editor-text-color, #111827) 55%, transparent)'
          : 'var(--editor-text-color, #111827)',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    transition: 'background 0.08s',
  });

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'rgba(128,128,128,0.08)';
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
  };

  return createPortal(
    <div ref={menuRef} style={menuStyle} role="menu">
      {entries.map(entry => isDivider(entry) ? (
        <div key={entry.id} style={dividerStyle} />
      ) : (
        <button
          key={entry.id}
          role="menuitem"
          style={itemStyle(entry)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={() => { entry.onSelect(); onClose(); }}
        >
          {entry.icon}
          {entry.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
