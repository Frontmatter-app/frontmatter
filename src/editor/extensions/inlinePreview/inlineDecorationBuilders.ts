import { syntaxTree } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { blockDecorationsField } from './blockDecorations';
import { BlockedRangeIndex, docMetaField, rangesOverlap, sortRanges } from './markdownAnalysis';
import { MathWidget } from './widgets';
import { getSettings } from '../../../settings/settingsStore';
import { findInlineMath } from './inlineMathUtils';
import {
  handleHeading, handleStrongEmphasis, handleEmphasis, handleStrikethrough,
  handleInlineCode, handleLink, handleUrl, handleImage, handleTaskMarker,
  handleFencedCode, handleBlockquote,
} from './inlineMarks';

export function isVisible(lineFrom: number, visibleRanges: readonly { from: number; to: number }[]) {
  return visibleRanges.some(({ from, to }) => lineFrom >= from && lineFrom <= to);
}

export function buildInlineDecorations(view: EditorView): { decorations: DecorationSet; atomicRanges: DecorationSet } {
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

    // The parse-ahead this used to force — `ensureSyntaxTree(state, treeEnd,
    // 1500)` — ran on every caret move as well as every keystroke, and a 1.5
    // second budget on the main thread is a visible stall. CodeMirror parses in
    // the background anyway, and the plugin now rebuilds when that finishes, so
    // taking whatever is ready costs at most one frame of missing preview.
    const tree = syntaxTree(state);

    addBlockTagDecorations(builder, blockTags, activeStartLine, activeEndLine, blocked, doc, view, lp);
    addTreeDecorations(builder, atomicBuilder, view, tree, doc, activeStartLine, activeEndLine, blocked, references, lp);
    addInlineMathDecorations(builder, atomicBuilder, view, doc, activeStartLine, activeEndLine, fencedLines, blocked, lp);

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

interface DocMetaBlockTag {
  tag: string;
  start: number;
  end: number;
}

function addBlockTagDecorations(builder: Range<Decoration>[], blockTags: DocMetaBlockTag[], activeStartLine: number, activeEndLine: number, blocked: BlockedRangeIndex, doc: any, view: EditorView, lp: any) {
  if (!lp.blockTags) return;

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

function addTreeDecorations(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], view: EditorView, tree: any, doc: any, activeStartLine: number, activeEndLine: number, blocked: BlockedRangeIndex, references: any, lp: any) {
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node: any) {
        const name = node.name;
        const nodeStartLine = doc.lineAt(node.from).number;
        const nodeEndLine = doc.lineAt(node.to).number;
        const isCurrentLineActive = rangesOverlap(activeStartLine, activeEndLine, nodeStartLine, nodeEndLine);

        if (blocked.overlaps(node.from, node.to)) return;

        if (name.startsWith('ATXHeading')) {
          handleHeading(builder, atomicBuilder, node, doc, isCurrentLineActive, lp);
          return;
        }
        if (name === 'StrongEmphasis') { handleStrongEmphasis(builder, atomicBuilder, node, doc, isCurrentLineActive, lp); return; }
        if (name === 'Emphasis') { handleEmphasis(builder, atomicBuilder, node, doc, isCurrentLineActive, lp); return; }
        if (name === 'Strikethrough') { handleStrikethrough(builder, atomicBuilder, node, doc, isCurrentLineActive, lp); return; }
        if (name === 'InlineCode') { handleInlineCode(builder, atomicBuilder, node, doc, isCurrentLineActive, lp); return false; }
        if (name === 'Link') { handleLink(builder, atomicBuilder, node, doc, isCurrentLineActive, lp, references); return false; }
        if (name === 'URL') { handleUrl(builder, node, lp); return false; }
        if (name === 'Image') { handleImage(builder, atomicBuilder, node, doc, isCurrentLineActive, lp, references); return false; }
        if (name === 'TaskMarker') { handleTaskMarker(builder, atomicBuilder, node, doc, isCurrentLineActive, lp); return false; }
        if (name === 'FencedCode') { handleFencedCode(builder, node, doc, blocked, lp); return false; }
        if (name === 'Blockquote') { handleBlockquote(builder, atomicBuilder, node, doc, activeStartLine, activeEndLine, blocked, lp); }
      },
    });
  }
}

function addInlineMathDecorations(builder: Range<Decoration>[], atomicBuilder: Range<Decoration>[], view: EditorView, doc: any, activeStartLine: number, activeEndLine: number, fencedLines: Set<number>, blocked: BlockedRangeIndex, lp: any) {
  if (!lp.math) return;

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
