import { StateField, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ReferencePickerState } from './referencePickerTypes';

export const setReferencePickerStateEffect = StateEffect.define<Partial<ReferencePickerState>>();

export const referencePickerField = StateField.define<ReferencePickerState>({
  create() {
    return { active: false, loading: false, query: '', from: 0, to: 0, allItems: [], items: [], selectedIndex: 0 };
  },

  update(state, tr) {
    let next = state;

    for (const effect of tr.effects) {
      if (effect.is(setReferencePickerStateEffect)) {
        next = { ...next, ...effect.value };
      }
    }

    if (!tr.docChanged && tr.selection === undefined) return next;

    const sel = tr.state.selection.main;
    if (!sel.empty) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const line = tr.state.doc.lineAt(sel.head);
    const cursorCol = sel.head - line.from;
    const atIndex = line.text.lastIndexOf('@', cursorCol - 1);

    if (atIndex < 0) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const between = line.text.slice(atIndex + 1, cursorCol);
    if (between.includes(' ')) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const query = between;
    if (query.length > 50) {
      return { ...next, active: false, loading: false, query: '', items: [] };
    }

    const from = line.from + atIndex;
    const to = sel.head;

    const queryChanged = !next.active || next.from !== from || next.query !== query;
    if (queryChanged) {
      return { ...next, active: true, loading: true, query, from, to, items: [], selectedIndex: 0 };
    }

    return { ...next, to };
  },
});

export function dismissPicker(view: EditorView) {
  view.dispatch({
    effects: setReferencePickerStateEffect.of({ active: false, loading: false, query: '', items: [] }),
  });
}
