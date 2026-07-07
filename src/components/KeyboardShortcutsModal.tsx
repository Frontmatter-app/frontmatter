import React, { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { getShortcutGroups, isMac, mod } from '../keyboard/shortcuts';

const shift = '⇧';
const SHORTCUT_GROUPS = getShortcutGroups();

function KeyBadge({ label }: { label: string; key?: React.Key }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        height: '22px',
        padding: '0 5px',
        borderRadius: '6px',
        border: '1px solid var(--editor-border, rgba(0,0,0,0.15))',
        background: 'var(--kb-bg, #fff)',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: 1,
        fontFamily: 'inherit',
        boxShadow: '0 1px 0 var(--editor-border, rgba(0,0,0,0.15))',
        userSelect: 'none',
        color: 'var(--kb-color, #374151)',
      }}
    >
      {label}
    </kbd>
  );
}

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'color-mix(in srgb, var(--editor-text-color, #000) 45%, transparent)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="animate-in fade-in zoom-in-95 duration-150"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '520px',
          margin: '0 16px',
          borderRadius: '18px',
          border: '1px solid var(--editor-border, rgba(0,0,0,0.10))',
          background: 'var(--editor-secondary-bg, #fff)',
          boxShadow: '0 25px 60px color-mix(in srgb, var(--editor-text-color, #000) 20%, transparent), 0 8px 24px color-mix(in srgb, var(--editor-text-color, #000) 12%, transparent)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--editor-border, rgba(0,0,0,0.08))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--editor-caret-color, #6366f1) 18%, transparent), color-mix(in srgb, var(--editor-accent, #a855f7) 18%, transparent))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Keyboard style={{ width: '16px', height: '16px', color: 'var(--editor-caret-color, #6366f1)' }} />
            </div>
            <div>
              <h2 style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--editor-text-color, #111)',
                lineHeight: 1.2,
              }}>
                Keyboard Shortcuts
              </h2>
              <p style={{
                margin: '2px 0 0',
                fontSize: '11px',
                color: 'color-mix(in srgb, var(--editor-text-color, #000) 35%, transparent)',
                lineHeight: 1,
              }}>
                {isMac ? 'macOS' : 'Windows / Linux'} bindings
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'color-mix(in srgb, var(--editor-text-color, #000) 40%, transparent)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #000) 6%, transparent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X style={{ width: '15px', height: '15px' }} />
          </button>
        </div>

        {/* Shortcut grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px 28px',
          padding: '20px',
          maxHeight: '65vh',
          overflowY: 'auto',
        }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p style={{
                margin: '0 0 10px',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--editor-text-color, #000) 30%, transparent)',
              }}>
                {group.title}
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {group.shortcuts.map((s, i) => (
                  <li key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}>
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--editor-text-color, #374151)',
                      opacity: 0.85,
                      lineHeight: 1,
                    }}>
                      {s.description}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                      {s.keys.map((k, ki) => (
                        <KeyBadge key={ki} label={k} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--editor-border, rgba(0,0,0,0.07))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--editor-text-color, #000) 35%, transparent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Press <KeyBadge label="Esc" /> to dismiss
          </span>
          <span style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--editor-text-color, #000) 35%, transparent)', display: 'flex', alignItems: 'center', gap: '2px' }}>
            <KeyBadge label={mod} /><KeyBadge label={shift} /><KeyBadge label="K" /> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}
