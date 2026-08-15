import { EditorState, Range, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import {
  docMetaField,
  rangesOverlap,
  sortRanges,
} from './markdownAnalysis';
import { ImageWidget, MathWidget, TableWidget } from './widgets';
import { DiagramWidget } from './diagramWidget';
import { getSettings } from '../../../settings/settingsStore';
import { refreshInlinePreviewEffect } from './settingsRefresh';

/** How close the caret has to be before a block preview reveals its source. */
const PROXIMITY_MARGIN = 1;

function buildBlockDecorations(state: EditorState): DecorationSet {
  try {
    const doc = state.doc;
    const selection = state.selection.main;
    const activeStartLine = doc.lineAt(selection.from).number;
    const activeEndLine = doc.lineAt(selection.to).number;
    const { tables, blockImages, mathBlocks, diagrams, references } = state.field(docMetaField);
    const builder: Range<Decoration>[] = [];

    const lp = getSettings().livePreview;

    if (lp.tables) {
      for (const table of tables) {
        const isNearby = rangesOverlap(
          activeStartLine - PROXIMITY_MARGIN,
          activeEndLine + PROXIMITY_MARGIN,
          table.startLine,
          table.endLine,
        );
        if (!isNearby) {
          builder.push(
            Decoration.replace({
              widget: new TableWidget(table.raw, references, table.from),
              block: true,
              inclusive: false,
            }).range(table.from, table.to),
          );
        }
      }
    }

    if (lp.images) {
      for (const image of blockImages) {
        const isNearby = rangesOverlap(
          activeStartLine - PROXIMITY_MARGIN,
          activeEndLine + PROXIMITY_MARGIN,
          image.startLine,
          image.endLine,
        );
        if (!isNearby) {
          const decoration = lp.hideSyntax.images
            ? Decoration.replace({
                widget: new ImageWidget(image.url, image.alt, false, image.from, image.to),
                block: true,
                inclusive: false,
              }).range(image.from, image.to)
            : Decoration.widget({
                widget: new ImageWidget(image.url, image.alt, false, image.from, image.to),
                block: true,
                side: 1,
              }).range(image.to);

          builder.push(decoration);
        }
      }
    }

    if (lp.math) {
      for (const block of mathBlocks) {
        const isNearby = rangesOverlap(
          activeStartLine - PROXIMITY_MARGIN,
          activeEndLine + PROXIMITY_MARGIN,
          block.startLine,
          block.endLine,
        );
        if (!isNearby) {
          const decoration = lp.hideSyntax.math
            ? Decoration.replace({
                widget: new MathWidget(block.formula, true, block.from, block.to),
                block: true,
                inclusive: false,
              }).range(block.from, block.to)
            : Decoration.widget({
                widget: new MathWidget(block.formula, true, block.from, block.to),
                block: true,
                side: 1,
              }).range(block.to);

          builder.push(decoration);
        }
      }
    }

    if (lp.diagrams) {
      for (const diagram of diagrams) {
        const isNearby = rangesOverlap(
          activeStartLine - PROXIMITY_MARGIN,
          activeEndLine + PROXIMITY_MARGIN,
          diagram.startLine,
          diagram.endLine,
        );
        if (!isNearby) {
          builder.push(
            Decoration.replace({
              widget: new DiagramWidget(diagram.source, diagram.diagramType, diagram.from, diagram.to),
              block: true,
              inclusive: false,
            }).range(diagram.from, diagram.to),
          );
        }
      }
    }

    builder.sort(sortRanges);
    return Decoration.set(builder, true);
  } catch (error) {
    console.warn('[inlinePreview] buildBlockDecorations error:', error);
    return Decoration.none;
  }
}

/**
 * Which blocks the caret is currently suppressing, as a comparable string.
 *
 * A block preview collapses to its source when the caret comes within
 * `PROXIMITY_MARGIN` lines of it. That is the *only* way the selection affects
 * this decoration set, so moving the caret anywhere else — which is most
 * keystrokes and every arrow press — need not rebuild anything. Walking the
 * block list is cheap; building the set means constructing every widget in the
 * document, including rendering each table through markdown-it.
 */
function suppressionKey(state: EditorState): string {
  const doc = state.doc;
  const selection = state.selection.main;
  const activeStartLine = doc.lineAt(selection.from).number;
  const activeEndLine = doc.lineAt(selection.to).number;
  const { tables, blockImages, mathBlocks, diagrams } = state.field(docMetaField);

  let key = '';
  for (const group of [tables, blockImages, mathBlocks, diagrams]) {
    for (const block of group) {
      const isNearby = rangesOverlap(
        activeStartLine - PROXIMITY_MARGIN,
        activeEndLine + PROXIMITY_MARGIN,
        block.startLine,
        block.endLine,
      );
      key += isNearby ? '1' : '0';
    }
    key += '|';
  }
  return key;
}

export const blockDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },
  update(decorations, tr) {
    const settingsChanged = tr.effects.some(effect => effect.is(refreshInlinePreviewEffect));
    if (tr.docChanged || settingsChanged) return buildBlockDecorations(tr.state);
    // No document change means no positions to map.
    if (!tr.selection) return decorations;
    if (suppressionKey(tr.startState) === suppressionKey(tr.state)) return decorations;
    return buildBlockDecorations(tr.state);
  },
  provide: field => EditorView.decorations.from(field),
});
