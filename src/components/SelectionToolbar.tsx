import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { formatCommands, applyImage } from '../editor/formatting/commands';
import { showNativePrompt } from './PromptDialog';
import { useExcalidrawStore } from '../excalidraw/excalidrawStore';
import { uploadImage } from '../images/imageService';
import type { ImageContext } from '../images/imageTypes';
import type { FormatCommand } from '../editor/formatting/types';

interface SelectionToolbarProps {
  view: EditorView | null;
  from: number;
  to: number;
  onClose: () => void;
  documentId?: string;
  imageContext?: ImageContext | null;
}

export function SelectionToolbar({ view, from, to, onClose, documentId, imageContext }: SelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      if (e.key === 'Escape') { setImageMenuOpen(false); onClose(); }
    };
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setImageMenuOpen(false); onClose(); }
    };
    document.addEventListener('keydown', handleKey);
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 80);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
      clearTimeout(t);
    };
  }, [pos, onClose]);

  const handleEnterUrl = useCallback(async () => {
    if (!view) return;
    const url = await showNativePrompt('Insert Image', 'Enter image URL');
    if (url) {
      const alt = await showNativePrompt('Insert Image', 'Enter alt text (optional)');
      applyImage(view, url, alt || undefined);
    }
    setImageMenuOpen(false);
    onClose();
  }, [view, onClose]);

  const handleChooseFile = useCallback(() => {
    if (!imageContext) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file && view) {
        try {
          const result = await uploadImage(file, imageContext);
          applyImage(view, result.url, file.name);
        } catch (err) {
          console.error('[SelectionToolbar] Upload failed:', err);
        }
      }
      setImageMenuOpen(false);
      onClose();
    };
    input.click();
  }, [view, onClose, imageContext]);

  const handleWhiteboard = useCallback(() => {
    if (!documentId || !view) return;
    useExcalidrawStore.getState().open({
      mode: 'new-drawing',
      documentId,
      onSave: (url: string) => {
        applyImage(view, url);
        view.focus();
      },
    });
    setImageMenuOpen(false);
    onClose();
  }, [documentId, view, onClose]);

  const handleCommand = (cmd: FormatCommand) => {
    if (cmd.id === 'image') {
      setImageMenuOpen((prev) => !prev);
      return;
    }
    cmd.apply(view);
    onClose();
  };

  if (!view || !pos) return null;

  const toolbarWidth = 280;
  const toolbarHeight = 44;
  let x = pos.x - toolbarWidth / 2;
  let y = pos.y - toolbarHeight - 4;
  if (x < 8) x = 8;
  if (x + toolbarWidth > window.innerWidth - 8) x = window.innerWidth - toolbarWidth - 8;
  if (y < 8) y = pos.y + 12;
  if (y + toolbarHeight > window.innerHeight - 8) y = window.innerHeight - toolbarHeight - 8;

  const menuItem = (label: string, onClick: () => void) => (
    <div
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        padding: '9px 14px',
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--editor-text-color)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'background 0.08s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--editor-accent-bg, rgba(128,128,128,0.08))')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </div>
  );

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
      {formatCommands.map((cmd) => (
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
            background: cmd.id === 'image' && imageMenuOpen ? 'rgba(128,128,128,0.12)' : 'transparent',
            color: 'var(--editor-text-color, #111)',
            cursor: 'pointer',
            transition: 'background 0.08s',
            outline: 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(128,128,128,0.12)'; }}
          onMouseLeave={(e) => {
            if (!(cmd.id === 'image' && imageMenuOpen)) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }
          }}
          dangerouslySetInnerHTML={{ __html: cmd.icon }}
        />
      ))}
      {imageMenuOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 180,
            borderRadius: 12,
            background: 'color-mix(in srgb, var(--editor-bg-color, #ffffff) 88%, transparent)',
            backdropFilter: 'blur(24px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
            border: '1px solid rgba(128,128,128,0.14)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
            padding: '4px 0',
            animation: 'contextMenuIn 0.1s cubic-bezier(0.16, 1, 0.3, 1)',
            transformOrigin: 'top left',
          }}
        >
          {menuItem('Enter URL', handleEnterUrl)}
          {menuItem('Choose from computer', handleChooseFile)}
          {menuItem('Open Whiteboard', handleWhiteboard)}
        </div>
      )}
    </div>,
    document.body
  );
}
