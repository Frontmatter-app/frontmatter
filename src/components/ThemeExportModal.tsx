import React, { useState, useEffect } from 'react';
import { X, Sparkles, BookOpen, Presentation, FileText, LayoutGrid, Loader2 } from 'lucide-react';
import { invoke } from '../filesystem/tauriCommands';

interface ThemeExportModalProps {
  type: 'blog' | 'docs' | 'slide' | 'book';
  onClose: () => void;
  onExport: (themeId: string) => Promise<void>;
}

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  preview_type: string;
}

export function ThemeExportModal({ type, onClose, onExport }: ThemeExportModalProps) {
  const [selectedTheme, setSelectedTheme] = useState<string>('base');
  const [exporting, setExporting] = useState<boolean>(false);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await invoke<ThemeOption[]>('list_theme_options', { projectType: type });
        setThemes(list);
        if (list.length > 0) setSelectedTheme(list[0].id);
      } catch {
        setThemes([]);
      }
      setLoading(false);
    })();
  }, [type]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport(selectedTheme);
    } finally {
      setExporting(false);
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'blog': return <LayoutGrid className="w-5 h-5 text-indigo-400" />;
      case 'docs': return <FileText className="w-5 h-5 text-sky-400" />;
      case 'slide': return <Presentation className="w-5 h-5 text-pink-400" />;
      case 'book': return <BookOpen className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="animate-in fade-in zoom-in-95 duration-150"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '560px',
          margin: '0 16px',
          borderRadius: '16px',
          border: '1px solid var(--editor-border, rgba(255,255,255,0.08))',
          background: 'var(--editor-bg-color, #0f1219)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--editor-text-color, #c9d1d9)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--editor-border, rgba(255,255,255,0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {getTypeIcon()}
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, textTransform: 'capitalize' }}>
              Export Project as {type}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={exporting}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--editor-text-color, #8b949e)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', opacity: 0.8, lineHeight: 1.4 }}>
            Choose a presentation theme for your exported {type}. Zola will compile the static site and launch it locally in your browser.
          </p>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span style={{ fontSize: '13px', opacity: 0.6 }}>Loading themes...</span>
            </div>
          ) : themes.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
              No themes found. Create a directory at <code style={{ fontSize: '11px' }}>themes/{type}/</code>.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '16px',
                marginTop: '8px'
              }}
            >
              {themes.map((theme) => {
                const isSelected = selectedTheme === theme.id;
                return (
                  <div
                    key={theme.id}
                    onClick={() => setSelectedTheme(theme.id)}
                    style={{
                      border: isSelected ? '1px solid var(--editor-caret-color, #58a6ff)' : '1px solid var(--editor-border, rgba(255,255,255,0.08))',
                      borderRadius: '12px',
                      padding: '12px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(88, 166, 255, 0.05)' : 'rgba(255,255,255,0.02)',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '120px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--editor-border, rgba(255,255,255,0.08))';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {getTypeIcon()}
                        {theme.name}
                        {isSelected && <Sparkles className="w-3 h-3 text-indigo-400" />}
                      </h3>
                      <p style={{ margin: 0, fontSize: '11px', opacity: 0.6, lineHeight: 1.4, flex: 1 }}>
                        {theme.description || 'No description available.'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--editor-border, rgba(255,255,255,0.08))',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            background: 'rgba(0,0,0,0.1)'
          }}
        >
          <button
            onClick={onClose}
            disabled={exporting}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--editor-border, rgba(255,255,255,0.12))',
              background: 'transparent',
              color: 'var(--editor-text-color, #c9d1d9)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.2s',
              opacity: exporting ? 0.5 : 1
            }}
            onMouseEnter={(e) => { if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { if (!exporting) e.currentTarget.style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || !selectedTheme || loading}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--editor-caret-color, #58a6ff)',
              color: '#000',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s, background 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: (exporting || loading) ? 0.7 : 1
            }}
            onMouseEnter={(e) => { if (!exporting) e.currentTarget.style.background = 'color-mix(in srgb, var(--editor-caret-color, #58a6ff) 80%, #fff)'; }}
            onMouseLeave={(e) => { if (!exporting) e.currentTarget.style.background = 'var(--editor-caret-color, #58a6ff)'; }}
          >
            {exporting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <span>Export & Launch</span>
            )}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}