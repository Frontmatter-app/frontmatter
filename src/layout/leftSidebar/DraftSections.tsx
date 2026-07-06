import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface DraftOutlineSection {
  title: string;
  notes: string;
}

export function parseDraftSectionsForSidebar(text: string): DraftOutlineSection[] {
  const lines = text.split('\n');
  const sections: DraftOutlineSection[] = [];
  let current: DraftOutlineSection | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      if (current) {
        current.notes = buffer.join('\n').trim();
        sections.push(current);
      }
      current = { title: match[2].trim(), notes: '' };
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }

  if (current) {
    current.notes = buffer.join('\n').trim();
    sections.push(current);
  }

  return sections.filter(section => section.title.trim() || section.notes.trim());
}

export function CollapsibleDraftSection({ title, notes }: DraftOutlineSection & { key?: string | number }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="text-[11px] border border-gray-200/20 rounded-lg bg-[var(--editor-note-bg)] shadow-sm overflow-hidden mb-1.5 transition-all">
      <button
        onClick={() => setIsOpen(open => !open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition font-sans"
      >
        <span className="font-semibold text-[var(--editor-text-color)] truncate pr-2">
          {title || 'Untitled Heading'}
        </span>
        {isOpen
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        }
      </button>
      {isOpen && (
        <div className="px-2.5 pb-2 pt-0.5 text-[var(--editor-text-color)] opacity-90 font-serif leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto border-t border-gray-200/10 bg-[var(--editor-note-bg)]">
          {notes || <span className="opacity-50 italic">No notes in draft.</span>}
        </div>
      )}
    </div>
  );
}
