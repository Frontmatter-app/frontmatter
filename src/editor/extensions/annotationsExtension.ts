import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { StateEffect, StateField, Extension } from '@codemirror/state';
import * as Y from 'yjs';
import { AnnotationManager, Annotation } from '../../yjs/annotations';
import { toAbsolute } from '../../yjs/relativePositions';

export const setAnnotationsEffect = StateEffect.define<Annotation[]>();

export const annotationState = StateField.define<Annotation[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const highlightDeco = Decoration.mark({ class: 'cm-annotation-highlight' });
const resolvedDeco = Decoration.mark({ class: 'cm-annotation-resolved' });

export const annotationTheme = EditorView.theme({
  '.cm-annotation-highlight': {
    backgroundColor: 'var(--editor-annotation-bg)',
    borderBottom: '2px solid var(--editor-annotation)'
  },
  '.cm-annotation-resolved': {
    backgroundColor: 'transparent',
    borderBottom: '2px dashed var(--editor-muted)'
  }
});

export const annotationsExtension = (ytext: Y.Text): Extension => {
  const annotationPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDeco(view);
      }

      update(update: any) {
        if (update.docChanged || update.state.field(annotationState) !== update.startState.field(annotationState, false)) {
          this.decorations = this.buildDeco(update.view);
        }
      }

      buildDeco(view: EditorView) {
        const builder = [];
        const annotations = view.state.field(annotationState, false) || [];

        try {
          for (const ann of annotations) {
            const startAbs = toAbsolute(ann.start_pos, ytext.doc!);
            const endAbs = toAbsolute(ann.end_pos, ytext.doc!);

            if (startAbs && endAbs && startAbs.index <= endAbs.index) {
              const deco = ann.resolved ? resolvedDeco : highlightDeco;
              builder.push(deco.range(startAbs.index, endAbs.index));
            }
          }
        } catch (e) {
        }

        builder.sort((a, b) => a.from - b.from);
        return Decoration.set(builder, true);
      }
    },
    {
      decorations: v => v.decorations
    }
  );

  return [annotationState, annotationPlugin, annotationTheme];
};
