import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { annotationsExtension, setAnnotationsEffect } from './annotationsExtension';
import type { Annotation } from '../../yjs/annotations';

const views: EditorView[] = [];

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

function mount(text: string) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('markdown');
  ytext.insert(0, text);

  const parent = document.createElement('div');
  document.body.appendChild(parent);

  const view = new EditorView({
    state: EditorState.create({ doc: text, extensions: [annotationsExtension(ytext)] }),
    parent,
  });
  views.push(view);
  return { ydoc, ytext, view };
}

function annotation(ytext: Y.Text, from: number, to: number, over: Partial<Annotation> = {}): Annotation {
  return {
    id: `ann-${from}-${to}`,
    document_id: 'doc1',
    author_id: 'author',
    start_pos: Y.createRelativePositionFromTypeIndex(ytext, from),
    end_pos: Y.createRelativePositionFromTypeIndex(ytext, to),
    selected_text: '',
    note: 'note',
    resolved: false,
    created_at: new Date().toISOString(),
    replies: [],
    ...over,
  };
}

describe('annotationsExtension', () => {
  it('highlights an anchored annotation', () => {
    const { ytext, view } = mount('hello world foo');
    view.dispatch({ effects: setAnnotationsEffect.of([annotation(ytext, 6, 11)]) });

    expect(view.dom.querySelectorAll('.cm-annotation-highlight')).toHaveLength(1);
  });

  it('marks a resolved annotation differently', () => {
    const { ytext, view } = mount('hello world foo');
    view.dispatch({
      effects: setAnnotationsEffect.of([annotation(ytext, 6, 11, { resolved: true })]),
    });

    expect(view.dom.querySelectorAll('.cm-annotation-resolved')).toHaveLength(1);
    expect(view.dom.querySelectorAll('.cm-annotation-highlight')).toHaveLength(0);
  });

  it('keeps the other highlights when one annotation has collapsed', () => {
    // An annotation whose text was fully deleted resolves to an empty range.
    // CodeMirror throws on an empty mark decoration, and the whole loop used to
    // sit inside one try/catch with an empty handler — so a single collapsed
    // annotation silently erased every highlight in the document.
    const { ytext, view } = mount('hello world foo');
    view.dispatch({
      effects: setAnnotationsEffect.of([
        annotation(ytext, 3, 3),
        annotation(ytext, 6, 11),
        annotation(ytext, 12, 15),
      ]),
    });

    expect(view.dom.querySelectorAll('.cm-annotation-highlight')).toHaveLength(2);
  });

  it('skips an annotation whose anchor could not be decoded', () => {
    const { ytext, view } = mount('hello world foo');
    view.dispatch({
      effects: setAnnotationsEffect.of([
        annotation(ytext, 6, 11, { start_pos: null }),
        annotation(ytext, 12, 15),
      ]),
    });

    expect(view.dom.querySelectorAll('.cm-annotation-highlight')).toHaveLength(1);
  });
});
