import React from 'react';
import { SidebarSection } from './SidebarSection';

interface OutlineViewProps {
  outline: Array<{ id: string; level: number; title: string }>;
  /** False when no document is open, which is a different empty case. */
  hasDocument: boolean;
}

/**
 * Headings of the open document, as a section rather than a mode.
 *
 * It used to replace the file tree whenever a document was open, so browsing
 * files while writing meant switching back and forth.
 */
export function OutlineView({ outline, hasDocument }: OutlineViewProps) {
  return (
    <SidebarSection
      label="Outline"
      badge={
        outline.length > 0
          ? <span className="text-[10px] font-medium text-gray-400 tabular-nums">{outline.length}</span>
          : null
      }
    >
      <div className="flex flex-col gap-0.5">
        {!hasDocument ? (
          <p className="text-xs text-gray-400 italic px-2 py-1">Open a document to see its outline.</p>
        ) : outline.length === 0 ? (
          <p className="text-xs text-gray-400 italic px-2 py-1">No headings yet.</p>
        ) : (
          outline.map(section => {
            const lineIndex = parseInt(section.id.replace('sec-', ''), 10);
            return (
              <button
                key={section.id}
                onClick={() => window.dispatchEvent(
                  new CustomEvent('editor-scroll-to-line', { detail: { lineIndex } }),
                )}
                className="w-full text-left text-xs font-medium text-gray-600 hover:text-blue-600 py-1 px-2 hover:bg-black/5 rounded truncate cursor-pointer transition"
                style={{ paddingLeft: `${(section.level - 1) * 10 + 6}px` }}
              >
                {section.title}
              </button>
            );
          })
        )}
      </div>
    </SidebarSection>
  );
}
