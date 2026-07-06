import React from "react";

interface SectionNotesProps {
  activeHeading: string | null;
  outline: Array<{ level: number; title: string; notes: string }>;
}

export function SectionNotes({ activeHeading, outline }: SectionNotesProps) {
  const parseHeadingLine = (h: string): { level: number; title: string } => {
    const m = h.trim().match(/^(#{1,6})\s+(.*)$/);
    if (m) return { level: m[1].length, title: m[2].trim().toLowerCase() };
    return { level: 0, title: h.trim().toLowerCase() };
  };

  const parsed = activeHeading ? parseHeadingLine(activeHeading) : null;
  const matchedSection = parsed && parsed.level > 0
    ? outline.find(
        (sec) =>
          sec.level === parsed.level &&
          sec.title.trim().toLowerCase() === parsed.title
      )
    : null;
  const matchedNotes = matchedSection?.notes.trim();

  if (!matchedSection || !matchedNotes) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 animate-in fade-in duration-200">
      <div className="p-3 bg-[color-mix(in_srgb,var(--editor-secondary-bg,#f8f8f8)_80%,#f59e0b_20%)] rounded-lg border border-amber-200/40 dark:border-amber-700/30 shadow-sm flex flex-col gap-2">
        <div className="text-xs font-semibold text-[var(--editor-text-color)]">
          {matchedSection.title}
        </div>
        <div className="text-[11px] text-[var(--editor-text-color)] opacity-75 whitespace-pre-wrap leading-relaxed border-t border-amber-200/30 dark:border-amber-700/20 pt-2">
          {matchedNotes}
        </div>
      </div>
    </div>
  );
}
