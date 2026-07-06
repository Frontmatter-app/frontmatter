import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { formatCommands } from '../editor/formatting/commands';
import type { FormatCommand } from '../editor/formatting/types';

interface SelectionToolbarProps {
  view: EditorView | null;
  from: number;
  to: number;
  onClose: () => void;
}

export function SelectionToolbar({ view, from, to, onClose }: SelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!view) { setPos(null); return; }
    const coordsFrom = view.coordsAtPos(from);
    const coordsTo = view.coordsAtPos(to);
    if (!coordsFrom) { setPos(null); return; }

    const editorRect = view.dom.getBoundingClientRect();
    const x = coordsTo ? (coordsFrom.left + coordsTo.right) / 2 : coordsFrom.left;
    setPos({ x: Math.max(10, Math.min(x, window.innerWidth - 10)), y: coordsFrom.top - 8 });
  }, [view, from, to]);

  useEffect(() => {
    if (!pos) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 80);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
      clearTimeout(t);
    };
  }, [pos, onClose]);

  if (!view || !pos) return null;

  const handleCommand = (cmd: FormatCommand) => {
    cmd.apply(view);
    onClose();
  };

  const toolbarWidth = 280;
  let x = pos.x - toolbarWidth / 2;
  let y = pos.y - 48;
  if (x < 8) x = 8;
  if (x + toolbarWidth > window.innerWidth - 8) x = window.innerWidth - toolbarWidth - 8;
  if (y < 8) y = pos.y + 24;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '4px 6px',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)',
        backdropFilter: 'blur(24px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
        border: '1px solid rgba(128,128,128,0.14)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
        animation: 'contextMenuIn 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
        transformOrigin: 'bottom center',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        userSelect: 'none',
      }}
    >
      {formatCommands.map((cmd, i) => (
        <button
          key={cmd.id}
          title={`${cmd.label}${cmd.shortcut ? ` (${cmd.shortcut})` : ''}`}
          onMouseDown={(e) => { e.preventDefault(); handleCommand(cmd); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: 'var(--editor-text-color, #111)',
            cursor: 'pointer',
            transition: 'background 0.08s',
            outline: 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(128,128,128,0.12)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          dangerouslySetInnerHTML={{ __html: cmd.icon }}
        />
      ))}
    </div>,
    document.body
  );
}
