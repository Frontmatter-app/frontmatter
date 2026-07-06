import { EditorView } from '@codemirror/view';
import { showNativePrompt } from '../../components/PromptDialog';
import type { FormatCommand } from './types';

function wrapInline(view: EditorView, wrap: string): void {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const double = wrap + wrap;
  if (sel.startsWith(double) && sel.endsWith(double)) {
    view.dispatch({
      changes: { from, to, insert: sel.slice(double.length, sel.length - double.length) },
      selection: { anchor: from, head: to - double.length * 2 },
    });
  } else if (sel.startsWith(wrap) && sel.endsWith(wrap)) {
    view.dispatch({
      changes: { from, to, insert: sel.slice(wrap.length, sel.length - wrap.length) },
      selection: { anchor: from, head: to - wrap.length * 2 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: double + sel + double },
      selection: { anchor: from + double.length, head: to + double.length },
    });
  }
  view.focus();
}

function wrapPair(view: EditorView, before: string, after: string): void {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  if (sel.startsWith(before) && sel.endsWith(after)) {
    view.dispatch({
      changes: { from, to, insert: sel.slice(before.length, sel.length - after.length) },
      selection: { anchor: from, head: to - before.length - after.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + sel + after },
      selection: { anchor: from + before.length, head: to + before.length },
    });
  }
  view.focus();
}

function toggleHeading(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = line.text.match(/^(#{1,6})\s/);
  if (match) {
    const nextLevel = match[1].length === 6 ? 0 : match[1].length + 1;
    if (nextLevel === 0) {
      view.dispatch({
        changes: { from: line.from, to: line.from + match[0].length, insert: '' },
      });
    } else {
      const newMark = '#'.repeat(nextLevel) + ' ';
      view.dispatch({
        changes: { from: line.from, to: line.from + match[0].length, insert: newMark },
      });
    }
  } else {
    view.dispatch({
      changes: { from: line.from, insert: '# ' },
      selection: { anchor: line.from + 2 },
    });
  }
  view.focus();
}

export function applyLink(view: EditorView, url: string): void {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const text = sel || 'link';
  view.dispatch({
    changes: { from, to, insert: `[${text}](${url})` },
    selection: { anchor: from + 1, head: from + 1 + text.length },
  });
  view.focus();
}

export function applyImage(view: EditorView, url: string, alt?: string): void {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const altText = alt || sel || 'image';
  view.dispatch({
    changes: { from, to, insert: `![${altText}](${url})` },
    selection: { anchor: from, head: from + `![${altText}](${url})`.length },
  });
  view.focus();
}

async function promptLink(view: EditorView): Promise<void> {
  const url = await showNativePrompt('Insert Link', 'Enter the URL', 'https://');
  if (url) applyLink(view, url);
}

async function promptImage(view: EditorView): Promise<void> {
  const url = await showNativePrompt('Insert Image', 'Enter image URL', 'https://');
  if (!url) return;
  const alt = await showNativePrompt('Insert Image', 'Enter alt text (optional)');
  applyImage(view, url, alt || undefined);
}

const BOLD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>';
const ITALIC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>';
const UNDERLINE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" x2="20" y1="21" y2="21"/></svg>';
const STRIKE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>';
const CODE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const LINK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const IMAGE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const HEADING_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>';

export const boldCommand: FormatCommand = {
  id: 'bold', label: 'Bold', icon: BOLD_ICON, shortcut: '⌘B',
  apply: (view) => wrapInline(view, '*'),
};

export const italicCommand: FormatCommand = {
  id: 'italic', label: 'Italic', icon: ITALIC_ICON, shortcut: '⌘I',
  apply: (view) => wrapInline(view, '_'),
};

export const underlineCommand: FormatCommand = {
  id: 'underline', label: 'Underline', icon: UNDERLINE_ICON,
  apply: (view) => wrapPair(view, '<u>', '</u>'),
};

export const strikethroughCommand: FormatCommand = {
  id: 'strikethrough', label: 'Strikethrough', icon: STRIKE_ICON,
  apply: (view) => wrapInline(view, '~'),
};

export const codeCommand: FormatCommand = {
  id: 'code', label: 'Code', icon: CODE_ICON, shortcut: '⌘E',
  apply: (view) => wrapInline(view, '`'),
};

export const linkCommand: FormatCommand = {
  id: 'link', label: 'Link', icon: LINK_ICON, shortcut: '⌘K',
  apply: promptLink,
};

export const imageCommand: FormatCommand = {
  id: 'image', label: 'Image', icon: IMAGE_ICON,
  apply: promptImage,
};

export const headingCommand: FormatCommand = {
  id: 'heading', label: 'Heading', icon: HEADING_ICON,
  apply: toggleHeading,
};

export const formatCommands: FormatCommand[] = [
  boldCommand,
  italicCommand,
  underlineCommand,
  strikethroughCommand,
  codeCommand,
  linkCommand,
  imageCommand,
  headingCommand,
];
