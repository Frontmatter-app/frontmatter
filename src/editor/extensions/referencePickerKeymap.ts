import { keymap } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { referencePickerField, setReferencePickerStateEffect, dismissPicker } from './referencePickerCore';
import { selectItem } from './referencePickerSearch';

export const referencePickerKeymap = keymap.of([
  {
    key: 'ArrowDown',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setReferencePickerStateEffect.of({
          selectedIndex: (s.selectedIndex + 1) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'ArrowUp',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      view.dispatch({
        effects: setReferencePickerStateEffect.of({
          selectedIndex: (s.selectedIndex - 1 + s.items.length) % s.items.length,
        }),
      });
      return true;
    },
  },
  {
    key: 'Enter',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active || s.items.length === 0) return false;
      const item = s.items[Math.min(s.selectedIndex, s.items.length - 1)];
      if (item) {
        selectItem(view, item);
        return true;
      }
      return false;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const s = view.state.field(referencePickerField);
      if (!s.active) return false;
      dismissPicker(view);
      return true;
    },
  },
]);

export const referencePickerTheme = EditorView.theme({
  '.cm-tooltip': {
    border: 'none !important',
    boxShadow: 'none !important',
    zIndex: '99999 !important',
  },
});
