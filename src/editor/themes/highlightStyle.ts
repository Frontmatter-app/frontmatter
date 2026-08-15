import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Token colours for the editor, in terms of the theme's own variables.
 *
 * The editor previously used CodeMirror's `defaultHighlightStyle`, whose
 * colours are hardcoded for a light background. That is what coloured fenced
 * code, so every one of the dark theme presets in `themeConfig.ts` rendered
 * code in near-invisible dark blues and greens on a dark background.
 *
 * Everything here resolves through `var(--editor-*)`, which
 * `applyThemeVariablesToDOM` rewrites whenever the theme changes — so switching
 * themes recolours the syntax without rebuilding the editor, and the semantic
 * colours are already derived per-theme with the background's lightness taken
 * into account (see `getSemanticColors`).
 *
 * The markdown structure tags are included alongside the code tags because the
 * inline-preview decorations only style what live preview is switched on for;
 * with a setting off, these are what remains.
 */
export const frontmatterHighlightStyle = HighlightStyle.define([
  // --- Markdown structure -------------------------------------------------
  { tag: t.heading, color: 'var(--editor-heading-color)', fontWeight: '700' },
  { tag: t.strong, color: 'var(--editor-strong-color)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--editor-emphasis-color)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--editor-link-color)' },
  { tag: t.monospace, color: 'var(--editor-inline-code-color)' },
  { tag: t.quote, color: 'var(--editor-blockquote-color)' },
  { tag: t.list, color: 'var(--editor-accent)' },

  // --- Code ---------------------------------------------------------------
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--editor-accent)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--editor-success)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--editor-muted)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.integer, t.float], color: 'var(--editor-warning)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--editor-info)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--editor-accent)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--editor-info)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--editor-text-color)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--editor-text-color)', opacity: '0.7' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--editor-muted)' },
  { tag: t.escape, color: 'var(--editor-warning)' },
  { tag: t.invalid, color: 'var(--editor-error)' },
]);
