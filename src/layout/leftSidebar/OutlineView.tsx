import React from 'react';

interface OutlineViewProps {
  onBackToExplorer: () => void;
  outline: Array<{ id: string; level: number; title: string }>;
}

export function OutlineView({ onBackToExplorer, outline }: OutlineViewProps) {
  return (
    <div>
      <button
        onClick={onBackToExplorer}
        className="flex items-center text-xs font-semibold text-gray-500 hover:text-gray-900 mb-6 transition cursor-pointer"
      >
        <span className="mr-1">&larr;</span> Explorer View
      </button>
      <div className="flex flex-col gap-3 mt-4">
        <h4 className="text-xs uppercase font-semibold text-gray-400 tracking-wider mb-2">Outline</h4>
        {outline.length > 0
          ? outline.map(sec => {
              const lineIndex = parseInt(sec.id.replace('sec-', ''), 10);
              return (
                <button
                  key={sec.id}
                  onClick={() => window.dispatchEvent(new CustomEvent('editor-scroll-to-line', { detail: { lineIndex } }))}
                  className="w-full text-left text-xs font-medium text-gray-600 hover:text-blue-600 py-1 px-2 hover:bg-black/5 rounded truncate cursor-pointer transition"
                  style={{ paddingLeft: `${(sec.level - 1) * 10 + 6}px` }}
                >
                  {sec.title}
                </button>
              );
            })
          : <div className="text-xs text-gray-400 italic">No headings in writing yet.</div>
        }
      </div>
    </div>
  );
}
