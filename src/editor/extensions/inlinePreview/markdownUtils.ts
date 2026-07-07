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

export function isMarkdownTableSeparator(text: string) {
  return /^\|?(\s*:?-+\s*:?\|)+(\s*:?-+\s*:?)?$/.test(text.trim());
}

export function isMarkdownTableRow(text: string) {
  return text.includes('|');
}
