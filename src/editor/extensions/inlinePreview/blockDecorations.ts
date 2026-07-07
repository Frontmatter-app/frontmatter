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

function buildBlockDecorations(state: EditorState): DecorationSet {
  try {
    const doc = state.doc;
    const selection = state.selection.main;
    const activeStartLine = doc.lineAt(selection.from).number;
    const activeEndLine = doc.lineAt(selection.to).number;
    const { tables, blockImages, mathBlocks, diagrams, references } = state.field(docMetaField);
    const builder: Range<Decoration>[] = [];

    const lp = getSettings().livePreview;

    const PROXIMITY_MARGIN = 1;

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

export const blockDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },
  update(decorations, tr) {
    const settingsChanged = tr.effects.some(effect => effect.is(refreshInlinePreviewEffect));
    if (!tr.docChanged && !tr.selection && !settingsChanged) return decorations.map(tr.changes);
    return buildBlockDecorations(tr.state);
  },
  provide: field => EditorView.decorations.from(field),
});
