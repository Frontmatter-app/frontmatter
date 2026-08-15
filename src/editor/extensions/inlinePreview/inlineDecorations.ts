import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
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
      // A background parse finishing changes what can be decorated without
      // changing the document, the viewport or the selection. Without this the
      // decorations for a large file stayed as they were until the next
      // keystroke — previews missing, and the atomic ranges the caret has to
      // step over a frame out of date.
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (!update.docChanged && !update.viewportChanged && !update.selectionSet && !settingsChanged && !treeChanged) return;

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
