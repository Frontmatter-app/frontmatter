import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Table } from '@lezer/markdown';
import { inlinePreviewInteractions } from './interactions';

const views: EditorView[] = [];
afterEach(() => { while (views.length) views.pop()!.destroy(); });

function mount(doc: string) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  /** Every range the editor actually rewrote, in document coordinates. */
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: [Table] }),
        inlinePreviewInteractions,
        EditorView.updateListener.of((update) => {
          update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            edits.push({ from: fromA, to: toA, insert: inserted.toString() });
          });
        }),
      ],
    }),
    parent,
  });
  views.push(view);
  return { view, edits };
}

/**
 * Fires the handler the way a click on a rendered checkbox does. The widget
 * carries the offset of its task marker in `data-source-from`.
 */
function clickCheckbox(view: EditorView, sourceFrom: number) {
  const checkbox = document.createElement('span');
  checkbox.className = 'cm-task-preview-checkbox';
  checkbox.dataset.sourceFrom = String(sourceFrom);
  view.contentDOM.appendChild(checkbox);
  checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  checkbox.remove();
}

describe('task checkbox toggling', () => {
  it('checks an unchecked box', () => {
    const { view } = mount('- [ ] write the thing\n');
    clickCheckbox(view, 2);
    expect(view.state.doc.toString()).toBe('- [x] write the thing\n');
  });

  it('unchecks a checked box', () => {
    const { view } = mount('- [x] write the thing\n');
    clickCheckbox(view, 2);
    expect(view.state.doc.toString()).toBe('- [ ] write the thing\n');
  });

  it('accepts an uppercase marker', () => {
    const { view } = mount('- [X] write the thing\n');
    clickCheckbox(view, 2);
    expect(view.state.doc.toString()).toBe('- [ ] write the thing\n');
  });

  it('toggles the box that was clicked, not the first on the line', () => {
    // The old implementation rewrote the whole line with `replace('[ ]', ...)`,
    // so it always hit the leftmost marker whichever box you clicked.
    const { view } = mount('- [ ] first and [ ] second\n');
    clickCheckbox(view, 16);
    expect(view.state.doc.toString()).toBe('- [ ] first and [x] second\n');
  });

  it('leaves a marker-shaped string in prose alone', () => {
    const { view } = mount('- [ ] mention of [x] in prose\n');
    clickCheckbox(view, 2);
    expect(view.state.doc.toString()).toBe('- [x] mention of [x] in prose\n');
  });

  it('rewrites one character rather than the whole line', () => {
    // Replacing the entire line is a delete-and-insert of every character on
    // it, which under Yjs discards a collaborator's concurrent edit to the same
    // line. A single-character change merges.
    const { view, edits } = mount('- [ ] write the thing\n');
    clickCheckbox(view, 2);

    expect(edits).toEqual([{ from: 3, to: 4, insert: 'x' }]);
  });

  it('ignores a position that is not a task marker', () => {
    const { view, edits } = mount('just some prose\n');
    clickCheckbox(view, 2);
    expect(view.state.doc.toString()).toBe('just some prose\n');
    expect(edits).toHaveLength(0);
  });
});
