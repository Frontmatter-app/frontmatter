export function stripInlineAttrs(text: string) {
  return text.replace(/\s*\{[^}]*\}\s*$/, '').trim();
}

export function stripBlockMathFence(text: string, opening: boolean) {
  const trimmed = text.trim();
  if (opening) return stripInlineAttrs(trimmed.replace(/^\$\$\s*/, ''));
  return trimmed.replace(/\s*\$\$\s*(?:\{[^}]*\}\s*)?$/, '').trim();
}

export function parseFenceInfo(text: string) {
  const match = text.trim().match(/^```([^\s`]*)/);
  return { language: (match?.[1] ?? '').trim().toLowerCase() };
}

/** Cells of dashes, optionally colon-aligned, with at least one pipe. */
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

export function isMarkdownTableSeparator(text: string) {
  const trimmed = text.trim();
  // The pipe requirement is what keeps a `---` thematic break from reading as a
  // one-column separator.
  return trimmed.includes('|') && SEPARATOR.test(trimmed);
}

/** Block structures end a table, per GFM, even when they contain a pipe. */
const BLOCK_START = /^(?:#{1,6}\s|>|```|~~~|(?:[-*_]\s*){3,}$)/;

/**
 * Whether a line reads as a row of table cells.
 *
 * Two rules beyond "has a pipe", both of which decide where a table *ends* —
 * this is called in a loop that extends a table downward until it returns
 * false, so anything too permissive swallows the prose underneath:
 *
 *  - A pipe inside inline code is not a cell delimiter. GFM would split on it,
 *    but `Run \`git log | head\` to see.` following a table is prose every time,
 *    and it was being absorbed into the rendered widget.
 *  - A line that opens another block structure is not a row.
 */
export function isMarkdownTableRow(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (BLOCK_START.test(trimmed)) return false;
  return stripInlineCode(trimmed).includes('|');
}

function stripInlineCode(text: string) {
  return text.replace(/`[^`]*`/g, '');
}
