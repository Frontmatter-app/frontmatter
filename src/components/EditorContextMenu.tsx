import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Scissors, Clipboard, MessageSquare, Link, Trash2, ChevronLeft } from 'lucide-react';

type MenuView = 'options' | 'addNote';

interface EditorContextMenuProps {
  position: { x: number; y: number } | null;
  hasSelection: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onAddNote?: (note: string) => void;
  onInsertLink: () => void;
  onDelete: () => void;
}

export function EditorContextMenu({
  position,
  hasSelection,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onAddNote,
  onInsertLink,
  onDelete,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MenuView>('options');
  const [noteText, setNoteText] = useState('');

  // Reset sub-view state whenever the menu is dismissed or repositioned
  useEffect(() => {
    if (!position) {
      setView('options');
      setNoteText('');
    }
  }, [position]);

  // Close on Escape or outside click
  useEffect(() => {
    if (!position) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    // Use a tiny delay so the right-click that opened the menu doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 80);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
      clearTimeout(t);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Viewport-aware positioning
  const MENU_W = 226;
  const MENU_H = view === 'options' ? 230 : 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = position.x + 6;
  let y = position.y + 6;
  if (x + MENU_W > vw - 12) x = position.x - MENU_W - 6;
  if (y + MENU_H > vh - 12) y = position.y - MENU_H - 6;
  x = Math.max(8, x);
  y = Math.max(8, y);

  // Shared style helpers
  const shell: React.CSSProperties = {
    position: 'fixed',
    top: y,
    left: x,
    width: MENU_W,
    zIndex: 99999,
    borderRadius: 14,
    overflow: 'hidden',
    // Use the editor theme background with glass effect
    background: 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)',
    backdropFilter: 'blur(24px) saturate(1.6)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
    border: '1px solid rgba(128,128,128,0.14)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
    animation: 'contextMenuIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
    transformOrigin: 'top left',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    userSelect: 'none',
  };

  const divider: React.CSSProperties = {
    height: 1,
    background: 'rgba(128,128,128,0.12)',
  };

  const baseItem = (danger = false, disabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 14px',
    fontSize: 13.5,
    fontWeight: 500,
    color: disabled
      ? `color-mix(in srgb, var(--editor-text-color, #111) 35%, transparent)`
      : danger
        ? '#e11d48'
        : 'var(--editor-text-color, #111827)',
    cursor: disabled ? 'default' : 'pointer',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    transition: 'background 0.08s',
    pointerEvents: disabled ? 'none' : 'auto',
  });

  const hover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
    (e.currentTarget as HTMLButtonElement).style.background = on
      ? 'rgba(128,128,128,0.09)'
      : 'transparent';
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 9,
    border: '1px solid rgba(128,128,128,0.18)',
    background: 'rgba(128,128,128,0.06)',
    color: 'var(--editor-text-color, #111)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const pill = (primary: boolean, disabled = false): React.CSSProperties => ({
    padding: '5px 13px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid rgba(128,128,128,0.18)',
    background: primary ? 'var(--editor-caret-color, #2563eb)' : 'transparent',
    color: primary ? '#fff' : 'var(--editor-text-color, #111)',
    fontSize: 12.5,
    fontWeight: primary ? 600 : 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'opacity 0.1s',
  });

  const backBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--editor-link-color, #2563eb)',
    fontSize: 12.5,
    padding: '2px 0',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontFamily: 'inherit',
  };

  /* ── Sub-view: Add a Note ── */
  const renderAddNote = () => (
    onAddNote ? (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button style={backBtn} onClick={() => setView('options')}>
            <ChevronLeft style={{ width: 14, height: 14 }} />
            Back
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, color: 'var(--editor-text-color, #111)' }}>
            Add Note
          </span>
        </div>
        <textarea
          autoFocus
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder="Write your note…"
          rows={3}
          style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && noteText.trim()) {
              onAddNote(noteText.trim()); onClose();
            }
            e.stopPropagation();
          }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={pill(false)} onClick={onClose}>Cancel</button>
          <button
            style={pill(true, !noteText.trim())}
            onClick={() => { if (noteText.trim()) { onAddNote(noteText.trim()); onClose(); } }}
          >
            Save  <span style={{ fontSize: 10, opacity: 0.7 }}>⌘↵</span>
          </button>
        </div>
      </div>
    ) : null
  );

  /* ── Main options view ── */
  const renderOptions = () => (
    <div style={{ padding: '4px 0' }}>
      <button style={baseItem(false, !hasSelection)} onClick={() => { onCopy(); onClose(); }}
        onMouseEnter={e => hasSelection && hover(e, true)} onMouseLeave={e => hover(e, false)}>
        <Copy style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.75 }} /> Copy
      </button>
      <button style={baseItem(false, !hasSelection)} onClick={() => { onCut(); onClose(); }}
        onMouseEnter={e => hasSelection && hover(e, true)} onMouseLeave={e => hover(e, false)}>
        <Scissors style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.75 }} /> Cut
      </button>
      <button style={baseItem()} onClick={() => { onPaste(); onClose(); }}
        onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}>
        <Clipboard style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.75 }} /> Paste
      </button>
      <div style={divider} />
      {onAddNote && (
        <button style={baseItem(false, !hasSelection)} onClick={() => hasSelection && setView('addNote')}
          onMouseEnter={e => hasSelection && hover(e, true)} onMouseLeave={e => hover(e, false)}>
          <MessageSquare style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.75 }} /> Add a Note
        </button>
      )}
      <button style={baseItem()} onClick={() => { onInsertLink(); onClose(); }}
        onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}>
        <Link style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.75 }} /> Insert Link
      </button>
      <div style={divider} />
      <button style={baseItem(true, !hasSelection)} onClick={() => { if (hasSelection) { onDelete(); onClose(); } }}
        onMouseEnter={e => hasSelection && hover(e, true)} onMouseLeave={e => hover(e, false)}>
        <Trash2 style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.85 }} /> Delete
      </button>
    </div>
  );

  return createPortal(
    <div ref={menuRef} style={shell}>
      {view === 'options' && renderOptions()}
      {view === 'addNote' && renderAddNote()}
    </div>,
    document.body
  );
}
