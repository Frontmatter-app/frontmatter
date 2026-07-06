import { useState, useEffect } from 'react';
import * as Y from 'yjs';

export interface OutlineSection {
  id: string;
  title: string;
  level: number;
  notes: string;
}

export function useOutline(draftText: Y.Text | null) {
  const [outline, setOutline] = useState<OutlineSection[]>([]);

  useEffect(() => {
    if (!draftText) {
      setOutline([]);
      return;
    }

    const update = () => {
      const text = draftText.toString();
      const lines = text.split('\n');
      
      const sections: OutlineSection[] = [];
      let currentSection: OutlineSection | null = null;
      let notesBuffer: string[] = [];

      // A simple parser for markdown headings and following paragraphs
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        
        if (match) {
          if (currentSection) {
            currentSection.notes = notesBuffer.join('\n').trim();
            sections.push(currentSection);
          }
          currentSection = {
            id: `sec-${i}`,
            title: match[2].trim(),
            level: match[1].length,
            notes: ''
          };
          notesBuffer = [];
        } else {
          if (currentSection) {
            notesBuffer.push(line);
          }
        }
      }

      if (currentSection) {
        currentSection.notes = notesBuffer.join('\n').trim();
        sections.push(currentSection);
      }

      setOutline(sections);
    };

    update();
    draftText.observe(update);

    return () => {
      draftText.unobserve(update);
    };
  }, [draftText]);

  return outline;
}
