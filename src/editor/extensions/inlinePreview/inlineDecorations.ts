import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { refreshInlinePreviewEffect } from './settingsRefresh';
import { buildInlineDecorations } from './inlineDecorationBuilders';

export const inlineMarkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;

    constructor(view: EditorView) {
      const built = buildInlineDecorations(view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;
    }

    update(update: ViewUpdate) {
      const settingsChanged = update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshInlinePreviewEffect)));
      if (!update.docChanged && !update.viewportChanged && !update.selectionSet && !settingsChanged) return;

      const built = buildInlineDecorations(update.view);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;

      if (update.selectionSet || update.viewportChanged) {
        update.view.requestMeasure();
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
