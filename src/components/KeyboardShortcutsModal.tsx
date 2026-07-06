import React, { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const mod = isMac ? '⌘' : 'Ctrl';
const alt = isMac ? '⌥' : 'Alt';
const shift = '⇧';

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Document',
    shortcuts: [
      { keys: [mod, 'N'],          description: 'New document' },
      { keys: [mod, 'S'],          description: 'Save document' },
      { keys: [mod, shift, 'A'],   description: 'Switch account' },
      { keys: [mod, ','],          description: 'Open preferences' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: [mod, 'Z'],          description: 'Undo' },
      { keys: [mod, shift, 'Z'],   description: 'Redo' },
      { keys: [mod, 'B'],          description: 'Bold' },
      { keys: [mod, 'I'],          description: 'Italic' },
      { keys: [mod, 'K'],          description: 'Insert link' },
      { keys: [mod, 'F'],          description: 'Find in document' },
    ],
  },
  {
    title: 'Workflow',
    shortcuts: [
      { keys: [mod, shift, 'F'],   description: 'Toggle focus mode' },
      { keys: [mod, shift, '1'],   description: 'Switch to Write stage' },
      { keys: [mod, shift, '2'],   description: 'Switch to Revise stage' },
      { keys: [mod, shift, '3'],   description: 'Switch to Draft stage' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: [mod, shift, 'K'],   description: 'Open keyboard shortcuts' },
      { keys: [alt, '↑'],          description: 'Move to previous section' },
      { keys: [alt, '↓'],          description: 'Move to next section' },
    ],
  },
];

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
        border: '1px solid rgba(0,0,0,0.15)',
        background: 'var(--kb-bg, #fff)',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: 1,
        fontFamily: 'inherit',
        boxShadow: '0 1px 0 rgba(0,0,0,0.15)',
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
        backgroundColor: 'rgba(0,0,0,0.45)',
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
          border: '1px solid rgba(0,0,0,0.10)',
          background: 'var(--editor-secondary-bg, #fff)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.20), 0 8px 24px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 20px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(168,85,247,0.18))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Keyboard style={{ width: '16px', height: '16px', color: '#6366f1' }} />
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
                color: 'rgba(0,0,0,0.35)',
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
              color: 'rgba(0,0,0,0.4)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
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
                color: 'rgba(0,0,0,0.30)',
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
          borderTop: '1px solid rgba(0,0,0,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Press <KeyBadge label="Esc" /> to dismiss
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: '2px' }}>
            <KeyBadge label={mod} /><KeyBadge label={shift} /><KeyBadge label="K" /> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}
