import React, { useEffect, useState } from 'react';
import { BookOpen, FileText, LayoutGrid, Loader2, Presentation } from 'lucide-react';
import { invoke } from '../filesystem/tauriCommands';
import { NmButton, NmModal } from '../design/components';
import './themeExportModal.css';

export type ExportProjectType = 'blog' | 'docs' | 'slide' | 'book';

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  preview_type: string;
}

interface ThemeExportModalProps {
  type: ExportProjectType;
  onClose: () => void;
  onExport: (themeId: string) => Promise<void>;
}

const TYPE_LABEL: Record<ExportProjectType, string> = {
  blog: 'Blog',
  docs: 'Documentation Site',
  slide: 'Slide Deck',
  book: 'Book',
};

const TYPE_ICON: Record<ExportProjectType, React.ComponentType<{ className?: string }>> = {
  blog: LayoutGrid,
  docs: FileText,
  slide: Presentation,
  book: BookOpen,
};

export function ThemeExportModal({ type, onClose, onExport }: ThemeExportModalProps) {
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = TYPE_ICON[type];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const list = await invoke('list_theme_options', { projectType: type });
        if (!active) return;
        const options = (list ?? []) as ThemeOption[];
        setThemes(options);
        setSelected(options[0]?.id ?? null);
      } catch (e) {
        if (!active) return;
        setThemes([]);
        setError(e instanceof Error ? e.message : 'Could not load themes.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [type]);

  const handleExport = async () => {
    if (!selected) return;
    setExporting(true);
    setError(null);
    try {
      await onExport(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <NmModal
      open
      onClose={onClose}
      title={`Publish as a ${TYPE_LABEL[type]}`}
      subtitle="Choose a theme. The site is built locally and opened in your browser."
      dismissable={!exporting}
      footer={
        <>
          <NmButton onClick={onClose} disabled={exporting}>
            Cancel
          </NmButton>
          <NmButton
            variant="primary"
            onClick={handleExport}
            disabled={exporting || loading || !selected}
          >
            {exporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…
              </>
            ) : (
              'Publish'
            )}
          </NmButton>
        </>
      }
    >
      {error && (
        <p className="nm-error" role="alert" style={{ marginBottom: 'var(--nm-space-4)' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="theme-picker__status">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading themes…
        </p>
      ) : themes.length === 0 ? (
        <p className="theme-picker__status">
          No themes found for {TYPE_LABEL[type].toLowerCase()} exports. Add one under{' '}
          <code>themes/{type === 'slide' ? 'slides' : type}/</code>.
        </p>
      ) : (
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {themes.map((theme) => {
            const isSelected = selected === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className="theme-picker__option"
                data-selected={isSelected}
                onClick={() => setSelected(theme.id)}
                disabled={exporting}
              >
                <span className="theme-picker__name">
                  <Icon className="w-4 h-4" />
                  {theme.name}
                </span>
                <span className="theme-picker__description">
                  {theme.description || 'No description provided.'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </NmModal>
  );
}
