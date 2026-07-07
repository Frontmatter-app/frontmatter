import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PromptState {
  title: string;
  description: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
}

let _setPromptState: ((state: PromptState | null) => void) | null = null;

export function showNativePrompt(title: string, description: string, defaultValue?: string): Promise<string | null> {
  return new Promise((resolve) => {
    _setPromptState({ title, description, defaultValue, resolve });
  });
}

export function PromptDialog() {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    _setPromptState = setState;
    return () => { _setPromptState = null; };
  }, []);

  useEffect(() => {
    if (state) {
      setValue(state.defaultValue || '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state]);

  const submit = useCallback(() => {
    if (!state) return;
    const result = value.trim() || null;
    state.resolve(result);
    setState(null);
  }, [state, value]);

  const cancel = useCallback(() => {
    if (!state) return;
    state.resolve(null);
    setState(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state, submit, cancel]);

  if (!state) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
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
          maxWidth: '380px',
          margin: '0 16px',
          borderRadius: '14px',
          border: '1px solid var(--editor-border, rgba(0,0,0,0.10))',
          background: 'var(--editor-secondary-bg, #fff)',
          boxShadow: '0 25px 60px color-mix(in srgb, var(--editor-text-color, #000) 20%, transparent), 0 8px 24px color-mix(in srgb, var(--editor-text-color, #000) 12%, transparent)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 20px 0' }}>
          <h2 style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--editor-text-color, #111)',
            lineHeight: 1.2,
          }}>
            {state.title}
          </h2>
          <p style={{
            margin: '6px 0 0',
            fontSize: '12px',
            color: 'color-mix(in srgb, var(--editor-text-color, #000) 45%, transparent)',
            lineHeight: 1.4,
          }}>
            {state.description}
          </p>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid var(--editor-border, rgba(0,0,0,0.15))',
              background: 'var(--editor-primary-bg, #fff)',
              color: 'var(--editor-text-color, #111)',
              fontSize: '13px',
              lineHeight: 1.4,
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--editor-caret-color, #6366f1) 50%, transparent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--editor-border, rgba(0,0,0,0.15))')}
          />
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--editor-border, rgba(0,0,0,0.07))',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
        }}>
          <button
            onClick={cancel}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid var(--editor-border, rgba(0,0,0,0.12))',
              background: 'transparent',
              color: 'var(--editor-text-color, #374151)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-text-color, #000) 5%, transparent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--editor-caret-color, #6366f1)',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-caret-color, #6366f1) 80%, #000)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--editor-caret-color, #6366f1)')}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
