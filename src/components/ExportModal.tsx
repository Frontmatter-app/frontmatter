import React from 'react';
import { CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { invoke } from '../filesystem/tauriCommands';

interface ExportResult {
  success: boolean;
  output_dir: string;
  page_count: number;
  error?: string;
}

interface ExportModalProps {
  result: ExportResult;
  onClose: () => void;
}

export function ExportModal({ result, onClose }: ExportModalProps) {
  const handleOpen = () => {
    invoke('open_browser_url', { url: result.output_dir });
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--editor-text-color, #000) 45%, transparent)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="animate-in fade-in zoom-in-95 duration-150 w-full max-w-sm rounded-2xl p-6 shadow-2xl border"
        style={{ background: 'var(--editor-secondary-bg, #1a1a1a)', color: 'var(--editor-text-color, #fff)' }}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          {result.success ? (
            <CheckCircle2 className="w-12 h-12 text-green-500" />
          ) : (
            <XCircle className="w-12 h-12 text-red-500" />
          )}

          <h2 className="text-lg font-semibold">
            {result.success ? 'Export Complete' : 'Export Failed'}
          </h2>

          {result.success ? (
            <p className="text-sm opacity-70">
              Exported {result.page_count} page{result.page_count !== 1 ? 's' : ''}
            </p>
          ) : (
            <p className="text-sm text-red-400">{result.error}</p>
          )}

          <div className="flex gap-3 mt-2">
            {result.success && (
              <button
                onClick={handleOpen}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-80"
                style={{ background: 'var(--editor-accent, #3b82f6)', color: '#fff' }}
              >
                <ExternalLink className="w-4 h-4" />
                Open Export Folder
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-80 opacity-70"
              style={{ background: 'rgba(128,128,128,0.15)' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
