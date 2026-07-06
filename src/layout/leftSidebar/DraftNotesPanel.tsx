import React from 'react';
import { CollapsibleDraftSection, DraftOutlineSection } from './DraftSections';

interface DraftNotesPanelProps {
  stage: string;
  draftSections: DraftOutlineSection[];
}

export function DraftNotesPanel({ stage, draftSections }: DraftNotesPanelProps) {
  if (stage !== 'write') return null;

  return (
    <div className="border-t border-gray-200/80 pt-5 mt-6 flex-shrink-0 flex flex-col max-h-[45%] overflow-hidden">
      <div className="overflow-y-auto flex-1 pr-1 pb-1">
        {draftSections.length > 0
          ? draftSections.map((sec, idx) => <CollapsibleDraftSection key={idx} {...sec} />)
          : <div className="text-xs text-gray-400 italic px-1">No draft notes yet.</div>
        }
      </div>
    </div>
  );
}
