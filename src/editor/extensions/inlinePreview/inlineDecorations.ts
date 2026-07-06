import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { blockDecorationsField } from './blockDecorations';
import { BlockedRangeIndex, docMetaField, parseMarkdownImage, rangesOverlap, sortRanges } from './markdownAnalysis';
import { parseMarkdownLinkToken } from './markdown';
import { CheckboxWidget, ImageWidget, MathWidget } from './widgets';
import { getSettings } from '../../../settings/settingsStore';
import { refreshInlinePreviewEffect } from './settingsRefresh';

function isVisible(lineFrom: number, visibleRanges: readonly { from: number; to: number }[]) {
  return visibleRanges.some(({ from, to }) => lineFrom >= from && lineFrom <= to);
}

function hideRange(from: number, to: number) {
  return Decoration.replace({}).range(from, to);
}

export const inlineMarkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;

    constructor(view: EditorView) {
      const built = this.buildDecorations(view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;
    }

    update(update: ViewUpdate) {
      const settingsChanged = update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshInlinePreviewEffect)));
      if (!update.docChanged && !update.viewportChanged && !update.selectionSet && !settingsChanged) return;

      const built = this.buildDecorations(update.view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;

      if (update.selectionSet || update.viewportChanged) {
        update.view.requestMeasure();
      }
    }

    buildDecorations(view: EditorView): { decorations: DecorationSet; atomicRanges: DecorationSet } {
      try {
        const builder: Range<Decoration>[] = [];
        const atomicBuilder: Range<Decoration>[] = [];
        const { state } = view;
        const doc = state.doc;
        const selection = state.selection.main;
        const activeStartLine = doc.lineAt(selection.from).number;
        const activeEndLine = doc.lineAt(selection.to).number;
        const blockDecorations = state.field(blockDecorationsField, false) ?? Decoration.none;
        const blocked = new BlockedRangeIndex(blockDecorations);
        const { blockTags, fencedLines, references } = state.field(docMetaField);
        const lp = getSettings().livePreview;

        let treeEnd = 0;
        for (const { to } of view.visibleRanges) treeEnd = Math.max(treeEnd, to);
        const tree = ensureSyntaxTree(state, treeEnd, 1500) ?? syntaxTree(state);

        if (lp.blockTags) {
          for (const block of blockTags) {
            const startLine = doc.line(block.start);
            const endLine = doc.line(block.end);
            const hasCursor = rangesOverlap(activeStartLine, activeEndLine, block.start, block.end);
            const stateClass = hasCursor || !lp.hideSyntax.blockTags ? 'cm-tag-visible' : 'cm-tag-collapsed';

            if (isVisible(startLine.from, view.visibleRanges) && !blocked.contains(startLine.from)) {
              builder.push(Decoration.line({
                attributes: { class: `cm-custom-block-tag-open cm-custom-block-tag-open-${block.tag} ${stateClass}` },
              }).range(startLine.from));
            }

            if (isVisible(endLine.from, view.visibleRanges) && !blocked.contains(endLine.from)) {
              builder.push(Decoration.line({
                attributes: { class: `cm-custom-block-tag-close cm-custom-block-tag-close-${block.tag} ${stateClass}` },
              }).range(endLine.from));
            }

            for (let lineNumber = block.start + 1; lineNumber < block.end; lineNumber++) {
              const contentLine = doc.line(lineNumber);
              if (blocked.contains(contentLine.from) || !isVisible(contentLine.from, view.visibleRanges)) continue;

              let lineClass = `cm-custom-block-content cm-custom-block-content-${block.tag}`;
              if (lineNumber === block.start + 1) {
                lineClass += ` cm-custom-block-content-first cm-custom-block-content-first-${block.tag}`;
              }
              if (lineNumber === block.end - 1) {
                lineClass += ` cm-custom-block-content-last cm-custom-block-content-last-${block.tag}`;
              }

              builder.push(Decoration.line({ attributes: { class: lineClass } }).range(contentLine.from));
            }
          }
        }

        for (const { from, to } of view.visibleRanges) {
          tree.iterate({
            from,
            to,
            enter(node) {
              const name = node.name;
              const nodeStartLine = doc.lineAt(node.from).number;
              const nodeEndLine = doc.lineAt(node.to).number;
              const isCurrentLineActive = rangesOverlap(activeStartLine, activeEndLine, nodeStartLine, nodeEndLine);

              if (blocked.overlaps(node.from, node.to)) return;

              if (name.startsWith('ATXHeading')) {
                if (lp.headings) {
                  const level = parseInt(name.replace('ATXHeading', ''), 10);
                  const fontSize =
                    level === 1 ? '1.4em' : level === 2 ? '1.25em' : level === 3 ? '1.15em' : '1.1em';
                  const raw = doc.sliceString(node.from, node.to);
                  const marker = raw.match(/^#{1,6}\s+/);

                  if (!isCurrentLineActive && lp.hideSyntax.headings && marker) {
                    const hidden = hideRange(node.from, node.from + marker[0].length);
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
                return;
              }

              if (name === 'StrongEmphasis') {
                if (lp.bold) {
                  const raw = doc.sliceString(node.from, node.to);
                  const marker = raw.startsWith('**') && raw.endsWith('**') ? '**' : raw.startsWith('__') && raw.endsWith('__') ? '__' : null;
                  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.bold && marker;
                  const markFrom = hideSyntax ? node.from + marker.length : node.from;
                  const markTo = hideSyntax ? node.to - marker.length : node.to;

                  if (hideSyntax) {
                    const before = hideRange(node.from, markFrom);
                    const after = hideRange(markTo, node.to);
                    builder.push(before, after);
                    atomicBuilder.push(before, after);
                  }

                  builder.push(Decoration.mark({ attributes: { style: 'font-weight:700;color:var(--editor-strong-color)' } }).range(markFrom, markTo));
                }
                return;
              }

              if (name === 'Emphasis') {
                if (lp.italic) {
                  const raw = doc.sliceString(node.from, node.to);
                  const marker = raw.startsWith('*') && raw.endsWith('*') ? '*' : raw.startsWith('_') && raw.endsWith('_') ? '_' : null;
                  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.italic && marker;
                  const markFrom = hideSyntax ? node.from + marker.length : node.from;
                  const markTo = hideSyntax ? node.to - marker.length : node.to;

                  if (hideSyntax) {
                    const before = hideRange(node.from, markFrom);
                    const after = hideRange(markTo, node.to);
                    builder.push(before, after);
                    atomicBuilder.push(before, after);
                  }

                  builder.push(Decoration.mark({ attributes: { style: 'font-style:italic;color:var(--editor-emphasis-color)' } }).range(markFrom, markTo));
                }
                return;
              }

              if (name === 'Strikethrough') {
                if (lp.strikethrough) {
                  const raw = doc.sliceString(node.from, node.to);
                  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.strikethrough && raw.startsWith('~~') && raw.endsWith('~~');
                  const markFrom = hideSyntax ? node.from + 2 : node.from;
                  const markTo = hideSyntax ? node.to - 2 : node.to;

                  if (hideSyntax) {
                    const before = hideRange(node.from, markFrom);
                    const after = hideRange(markTo, node.to);
                    builder.push(before, after);
                    atomicBuilder.push(before, after);
                  }

                  builder.push(Decoration.mark({ attributes: { style: 'text-decoration:line-through;color:var(--text-muted,#94A3B8)' } }).range(markFrom, markTo));
                }
                return;
              }

              if (name === 'InlineCode') {
                if (lp.inlineCode) {
                  const raw = doc.sliceString(node.from, node.to);
                  const marker = raw.match(/^(`+)([\s\S]*)\1$/)?.[1] ?? null;
                  const hideSyntax = !isCurrentLineActive && lp.hideSyntax.inlineCode && marker;
                  const markFrom = hideSyntax ? node.from + marker.length : node.from;
                  const markTo = hideSyntax ? node.to - marker.length : node.to;

                  if (hideSyntax) {
                    const before = hideRange(node.from, markFrom);
                    const after = hideRange(markTo, node.to);
                    builder.push(before, after);
                    atomicBuilder.push(before, after);
                  }

                  builder.push(Decoration.mark({
                    attributes: { style: 'font-family:monospace;background-color:var(--editor-inline-code-bg);color:var(--editor-inline-code-color);padding:2px 4px;border-radius:4px;font-size:0.9em' },
                  }).range(markFrom, markTo));
                }
                return false;
              }

              if (name === 'Link') {
                if (isCurrentLineActive || !lp.links) return;

                const raw = doc.sliceString(node.from, node.to);
                const labelEnd = raw.indexOf(']');
                const link = parseMarkdownLinkToken(raw, references);
                const labelFrom = node.from + 1;
                const labelTo = labelEnd > 0 ? node.from + labelEnd : -1;

                if (labelTo !== -1 && link?.url) {
                  if (lp.hideSyntax.links) {
                    const before = hideRange(node.from, node.from + 1);
                    const after = hideRange(labelTo, node.to);
                    builder.push(before);
                    builder.push(Decoration.mark({
                      tagName: 'a',
                      attributes: {
                        href: link.url,
                        'data-inline-preview-link': link.url,
                        title: link.title ? `${link.title} - Cmd/Ctrl-click to open` : 'Cmd/Ctrl-click to open',
                        style: 'color:var(--editor-link-color,#3B82F6);text-decoration:underline;cursor:pointer',
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
                        style: 'color:var(--editor-link-color,#3B82F6);text-decoration:underline;cursor:pointer',
                      },
                    }).range(node.from, node.to));
                  }
                }
                return false;
              }

              if (name === 'URL') {
                if (lp.links) {
                  builder.push(Decoration.mark({ attributes: { style: 'color:var(--editor-link-color,#3B82F6);text-decoration:underline' } }).range(node.from, node.to));
                }
                return false;
              }

              if (name === 'Image') {
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
                return false;
              }

              if (name === 'TaskMarker') {
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
                return false;
              }

              if (name === 'FencedCode') {
                if (lp.fencedCode) {
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
                return false;
              }

              if (name === 'Blockquote') {
                if (lp.blockquotes) {
                  const startLine = doc.lineAt(node.from);
                  const endLine = doc.lineAt(node.to);
                  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
                    const line = doc.line(lineNumber);
                    if (blocked.contains(line.from)) continue;
                    const isLineActive = rangesOverlap(activeStartLine, activeEndLine, lineNumber, lineNumber);
                    const marker = line.text.match(/^\s{0,3}>\s?/);
                    if (!isLineActive && lp.hideSyntax.blockquotes && marker) {
                      const hidden = hideRange(line.from, line.from + marker[0].length);
                      builder.push(hidden);
                      atomicBuilder.push(hidden);
                    }
                    builder.push(Decoration.line({ attributes: { class: 'cm-blockquote-line' } }).range(line.from));
                  }
                }
              }
            },
          });
        }

        if (lp.math) {
          for (const { from, to } of view.visibleRanges) {
            const startLine = doc.lineAt(from).number;
            const endLine = doc.lineAt(to).number;
            for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
              if (fencedLines.has(lineNumber) || rangesOverlap(activeStartLine, activeEndLine, lineNumber, lineNumber)) continue;

              const line = doc.line(lineNumber);
              if (blocked.contains(line.from)) continue;

              for (const math of findInlineMath(line.text)) {
                const mathFrom = line.from + math.from;
                const mathTo = line.from + math.to;
                if (blocked.overlaps(mathFrom, mathTo)) continue;

                const decoration = lp.hideSyntax.math
                  ? Decoration.replace({
                      widget: new MathWidget(math.formula, false, mathFrom, mathTo),
                      inclusive: false,
                    }).range(mathFrom, mathTo)
                  : Decoration.widget({
                      widget: new MathWidget(math.formula, false, mathFrom, mathTo),
                      block: false,
                      side: 1,
                    }).range(mathTo);

                builder.push(decoration);
                if (lp.hideSyntax.math) atomicBuilder.push(decoration);
              }
            }
          }
        }

        builder.sort(sortRanges);
        atomicBuilder.sort(sortRanges);
        return {
          decorations: Decoration.set(builder, true),
          atomicRanges: Decoration.set(atomicBuilder, true),
        };
      } catch (error) {
        console.warn('[inlinePreview] buildDecorations error:', error);
        return { decorations: Decoration.none, atomicRanges: Decoration.none };
      }
    }
  },
  {
    decorations: value => value.decorations,
    provide: plugin => EditorView.atomicRanges.of(view => {
      const value = view.plugin(plugin);
      return value ? value.atomicRanges : Decoration.none;
    }),
  },
);

function findInlineMath(text: string) {
  const ranges: Array<{ from: number; to: number; formula: string }> = [];
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || isEscaped(text, i)) continue;
    if (text[i + 1] === '$' || text[i - 1] === '$') continue;

    if (start === -1) {
      start = i;
      continue;
    }

    const formula = text.slice(start + 1, i).trim();
    if (formula) ranges.push({ from: start, to: i + 1, formula });
    start = -1;
  }

  return ranges;
}

function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}
