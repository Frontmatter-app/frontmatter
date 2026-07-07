import { Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { parseMarkdownLinkToken } from './markdown';
import { CheckboxWidget, ImageWidget, MathWidget } from './widgets';
import { BlockedRangeIndex, parseMarkdownImage, rangesOverlap } from './markdownAnalysis';
export type { BlockedRangeIndex } from './markdownAnalysis';

export function handleHeading(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (!lp.headings) return;
  const level = parseInt(node.name.replace('ATXHeading', ''), 10);
  const fontSize = level === 1 ? '1.4em' : level === 2 ? '1.25em' : level === 3 ? '1.15em' : '1.1em';
  const raw = doc.sliceString(node.from, node.to);
  const marker = raw.match(/^#{1,6}\s+/);

  if (!isCurrentLineActive && lp.hideSyntax.headings && marker) {
    const hidden = Decoration.replace({}).range(node.from, node.from + marker[0].length);
    builder.push(hidden);
    atomicBuilder.push(hidden);
  }

  builder.push(Decoration.mark({
    attributes: {
      style: isCurrentLineActive
        ? 'font-weight:700;font-family:var(--editor-heading-font-family);color:var(--editor-heading-color)'
        : `font-size:${fontSize};font-weight:700;font-family:var(--editor-heading-font-family);color:var(--editor-heading-color)`,
    },
  }).range(!isCurrentLineActive && lp.hideSyntax.headings && marker ? node.from + marker[0].length : node.from, node.to));
}

export function handleStrongEmphasis(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (!lp.bold) return;
  const raw = doc.sliceString(node.from, node.to);
  const marker = raw.startsWith('**') && raw.endsWith('**') ? '**' : raw.startsWith('__') && raw.endsWith('__') ? '__' : null;
  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.bold && marker;
  const markFrom = hideSyntax ? node.from + marker!.length : node.from;
  const markTo = hideSyntax ? node.to - marker!.length : node.to;

  if (hideSyntax) {
    const before = Decoration.replace({}).range(node.from, markFrom);
    const after = Decoration.replace({}).range(markTo, node.to);
    builder.push(before, after);
    atomicBuilder.push(before, after);
  }

  builder.push(Decoration.mark({ attributes: { style: 'font-weight:700;color:var(--editor-strong-color)' } }).range(markFrom, markTo));
}

export function handleEmphasis(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (!lp.italic) return;
  const raw = doc.sliceString(node.from, node.to);
  const marker = raw.startsWith('*') && raw.endsWith('*') ? '*' : raw.startsWith('_') && raw.endsWith('_') ? '_' : null;
  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.italic && marker;
  const markFrom = hideSyntax ? node.from + marker!.length : node.from;
  const markTo = hideSyntax ? node.to - marker!.length : node.to;

  if (hideSyntax) {
    const before = Decoration.replace({}).range(node.from, markFrom);
    const after = Decoration.replace({}).range(markTo, node.to);
    builder.push(before, after);
    atomicBuilder.push(before, after);
  }

  builder.push(Decoration.mark({ attributes: { style: 'font-style:italic;color:var(--editor-emphasis-color)' } }).range(markFrom, markTo));
}

export function handleStrikethrough(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (!lp.strikethrough) return;
  const raw = doc.sliceString(node.from, node.to);
  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.strikethrough && raw.startsWith('~~') && raw.endsWith('~~');
  const markFrom = hideSyntax ? node.from + 2 : node.from;
  const markTo = hideSyntax ? node.to - 2 : node.to;

  if (hideSyntax) {
    const before = Decoration.replace({}).range(node.from, markFrom);
    const after = Decoration.replace({}).range(markTo, node.to);
    builder.push(before, after);
    atomicBuilder.push(before, after);
  }

  builder.push(Decoration.mark({ attributes: { style: 'text-decoration:line-through;color:var(--editor-muted)' } }).range(markFrom, markTo));
}

export function handleInlineCode(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (!lp.inlineCode) return;
  const raw = doc.sliceString(node.from, node.to);
  const marker = raw.match(/^(`+)([\s\S]*)\1$/)?.[1] ?? null;
  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.inlineCode && marker;
  const markFrom = hideSyntax ? node.from + marker!.length : node.from;
  const markTo = hideSyntax ? node.to - marker!.length : node.to;

  if (hideSyntax) {
    const before = Decoration.replace({}).range(node.from, markFrom);
    const after = Decoration.replace({}).range(markTo, node.to);
    builder.push(before, after);
    atomicBuilder.push(before, after);
  }

  builder.push(Decoration.mark({
    attributes: { style: 'font-family:monospace;background-color:var(--editor-inline-code-bg);color:var(--editor-inline-code-color);padding:2px 4px;border-radius:4px;font-size:0.9em' },
  }).range(markFrom, markTo));
}

export function handleLink(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any, references: any) {
  if (isCurrentLineActive || !lp.links) return;

  const raw = doc.sliceString(node.from, node.to);
  const labelEnd = raw.indexOf(']');
  const link = parseMarkdownLinkToken(raw, references);
  const labelFrom = node.from + 1;
  const labelTo = labelEnd > 0 ? node.from + labelEnd : -1;

  if (labelTo !== -1 && link?.url) {
    if (lp.hideSyntax.links) {
      const before = Decoration.replace({}).range(node.from, node.from + 1);
      const after = Decoration.replace({}).range(labelTo, node.to);
      builder.push(before);
      builder.push(Decoration.mark({
        tagName: 'a',
        attributes: {
          href: link.url,
          'data-inline-preview-link': link.url,
          title: link.title ? `${link.title} - Cmd/Ctrl-click to open` : 'Cmd/Ctrl-click to open',
          style: 'color:var(--editor-link-color);text-decoration:underline;cursor:pointer',
        },
      }).range(labelFrom, labelTo));
      builder.push(after);
      atomicBuilder.push(before, after);
    } else {
      builder.push(Decoration.mark({
        tagName: 'a',
        attributes: {
          href: link.url,
          'data-inline-preview-link': link.url,
          title: link.title ? `${link.title} - Cmd/Ctrl-click to open` : 'Cmd/Ctrl-click to open',
          style: 'color:var(--editor-link-color);text-decoration:underline;cursor:pointer',
        },
      }).range(node.from, node.to));
    }
  }
}

export function handleUrl(builder: Range<Decoration>[], node: any, lp: any) {
  if (lp.links) {
    builder.push(Decoration.mark({ attributes: { style: 'color:var(--editor-link-color);text-decoration:underline' } }).range(node.from, node.to));
  }
}

export function handleImage(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any, references: any) {
  if (isCurrentLineActive || !lp.images) return;

  const raw = doc.sliceString(node.from, node.to);
  const image = parseMarkdownImage(raw, references);
  if (image && doc.lineAt(node.from).text.trim() !== raw.trim()) {
    const decoration = lp.hideSyntax.images
      ? Decoration.replace({
          widget: new ImageWidget(image.url, image.alt, true, node.from, node.to),
          block: false,
          inclusive: false,
        }).range(node.from, node.to)
      : Decoration.widget({
          widget: new ImageWidget(image.url, image.alt, true, node.from, node.to),
          block: false,
          side: 1,
        }).range(node.to);
    builder.push(decoration);
    if (lp.hideSyntax.images) atomicBuilder.push(decoration);
  }
}

export function handleTaskMarker(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, isCurrentLineActive: boolean, lp: any) {
  if (isCurrentLineActive || !lp.checkboxes) return;

  const raw = doc.sliceString(node.from, node.to);
  const checked = raw.includes('x') || raw.includes('X');
  const decoration = lp.hideSyntax.checkboxes
    ? Decoration.replace({
        widget: new CheckboxWidget(checked, node.from),
        inclusive: false,
      }).range(node.from, node.to)
    : Decoration.widget({
        widget: new CheckboxWidget(checked, node.from),
        block: false,
        side: 1,
      }).range(node.to);
  builder.push(decoration);
  if (lp.hideSyntax.checkboxes) atomicBuilder.push(decoration);
}

export function handleFencedCode(builder: Range<Decoration>[], node: any, doc: any, blocked: BlockedRangeIndex, lp: any) {
  if (!lp.fencedCode) return;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = doc.line(lineNumber);
    if (blocked.contains(line.from)) continue;
    const isFence = lineNumber === startLine.number || lineNumber === endLine.number;
    builder.push(Decoration.line({
      attributes: { class: isFence ? 'cm-fenced-code-fence' : 'cm-fenced-code-line' },
    }).range(line.from));
  }
}

export function handleBlockquote(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], node: any, doc: any, activeStartLine: number, activeEndLine: number, blocked: BlockedRangeIndex, lp: any) {
  if (!lp.blockquotes) return;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = doc.line(lineNumber);
    if (blocked.contains(line.from)) continue;
    const isLineActive = rangesOverlap(activeStartLine, activeEndLine, lineNumber, lineNumber);
    const marker = line.text.match(/^\s{0,3}>\s?/);
    if (!isLineActive && lp.hideSyntax.blockquotes && marker) {
      const hidden = Decoration.replace({}).range(line.from, line.from + marker[0].length);
      builder.push(hidden);
      atomicBuilder.push(hidden);
    }
    builder.push(Decoration.line({ attributes: { class: 'cm-blockquote-line' } }).range(line.from));
  }
}
