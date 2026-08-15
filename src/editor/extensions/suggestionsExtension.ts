import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { StateEffect, StateField, Extension, Transaction, EditorState } from '@codemirror/state';
import * as Y from 'yjs';
import { Suggestion, SuggestionManager } from '../../yjs/suggestions';
import { toAbsolute } from '../../yjs/relativePositions';

export const setSuggestionsEffect = StateEffect.define<Suggestion[]>();

export const suggestionState = StateField.define<Suggestion[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setSuggestionsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const insertDeco = Decoration.mark({ class: 'cm-suggestion-insert' });
const deleteDeco = Decoration.mark({ class: 'cm-suggestion-delete' });

export const suggestionTheme = EditorView.theme({
  '.cm-suggestion-insert': {
    backgroundColor: 'var(--editor-success-bg)',
    borderBottom: '2px solid var(--editor-success)',
    color: 'inherit'
  },
  // Longhands, for the same reason the grammar underline uses them: WebKit
  // takes `text-decoration` as the CSS2 shorthand and throws out any
  // declaration carrying a colour or a thickness, so this line was struck
  // through with nothing at all in the webview the app ships in.
  '.cm-suggestion-delete': {
    backgroundColor: 'var(--editor-error-bg)',
    textDecorationLine: 'line-through',
    textDecorationColor: 'var(--editor-error)',
    textDecorationThickness: '2px',
    WebkitTextDecorationLine: 'line-through',
    WebkitTextDecorationColor: 'var(--editor-error)',
    color: 'inherit',
    opacity: 0.8
  }
});

function isAdjacent(relPos: Y.RelativePosition, index: number, ytext: Y.Text): boolean {
  if (!ytext.doc) return false;
  const abs = toAbsolute(relPos, ytext.doc);
  return abs ? abs.index === index : false;
}

export const suggestionsExtension = (
  ytext: Y.Text,
  suggestionManager?: SuggestionManager,
  authorId?: string
): Extension => {
  const suggestionPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDeco(view);
      }

      update(update: any) {
        if (update.docChanged || update.state.field(suggestionState) !== update.startState.field(suggestionState, false)) {
          this.decorations = this.buildDeco(update.view);
        }
      }

      buildDeco(view: EditorView) {
        const builder = [];
        const suggestions = view.state.field(suggestionState, false) || [];

        for (const sug of suggestions) {
          if (sug.resolved) continue;

          const startAbs = toAbsolute(sug.start_pos, ytext.doc!);
          const endAbs = toAbsolute(sug.end_pos, ytext.doc!);

          if (startAbs && endAbs && startAbs.index < endAbs.index) {
            const deco = sug.type === 'insert' ? insertDeco : deleteDeco;
            builder.push(deco.range(startAbs.index, endAbs.index));
          }
        }

        builder.sort((a, b) => a.from - b.from);
        return Decoration.set(builder, true);
      }
    },
    {
      decorations: v => v.decorations
    }
  );

  // Transaction filter to intercept edits in suggest mode
  const filter = EditorState.transactionFilter.of((tr) => {
    // Only intercept user edits. Applying a suggestion from the sidebar goes
    // through Yjs and arrives here without a user event, so it passes straight
    // through — there is no need for the separate opt-out effect that used to
    // guard this, which nothing ever dispatched.
    const isUser = tr.annotation(Transaction.userEvent);
    if (!isUser || !suggestionManager || !authorId) {
      return tr;
    }

    if (tr.changes.empty) return tr;

    let hasDeletion = false;
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      if (fromA < toA) {
        hasDeletion = true;
      }
    });

    // If there is any deletion, we cancel the deletion and record a suggestion
    if (hasDeletion) {
      const newChanges: any[] = [];
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const deletedText = tr.startState.doc.sliceString(fromA, toA);

        // Add delete suggestion in YJS asynchronously to avoid transaction loop
        setTimeout(() => {
          const id = Math.random().toString(36).substring(2, 9);
          const startPos = Y.createRelativePositionFromTypeIndex(ytext, fromA, -1);
          const endPos = Y.createRelativePositionFromTypeIndex(ytext, toA, -1);
          suggestionManager.addSuggestion(id, authorId, 'delete', startPos, endPos, deletedText);
        }, 0);

        if (inserted.length > 0) {
          // If there was also an insertion (replacement), we keep the insertion next to it
          newChanges.push({ from: toA, to: toA, insert: inserted });
          setTimeout(() => {
            const id = Math.random().toString(36).substring(2, 9);
            const startPos = Y.createRelativePositionFromTypeIndex(ytext, toA, -1);
            const endPos = Y.createRelativePositionFromTypeIndex(ytext, toA + inserted.length, -1);
            suggestionManager.addSuggestion(id, authorId, 'insert', startPos, endPos, inserted.toString());
          }, 0);
        }
      });

      return {
        changes: newChanges,
        selection: tr.selection
      };
    }

    // If it's a pure insertion, let it go through, but record it as an insert suggestion
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const text = inserted.toString();
      if (!text) return;

      setTimeout(() => {
        // Try to append to the last pending insert suggestion by the same author
        const pending = suggestionManager.getSuggestions().find(s =>
          s.author_id === authorId &&
          s.type === 'insert' &&
          !s.resolved &&
          isAdjacent(s.end_pos, fromA, ytext)
        );

        if (pending) {
          const newText = pending.text + text;
          const endPos = Y.createRelativePositionFromTypeIndex(ytext, toB, -1);
          suggestionManager.updateSuggestion(pending.id, {
            text: newText,
            end_pos: endPos
          });
        } else {
          const id = Math.random().toString(36).substring(2, 9);
          const startPos = Y.createRelativePositionFromTypeIndex(ytext, fromA, -1);
          const endPos = Y.createRelativePositionFromTypeIndex(ytext, toB, -1);
          suggestionManager.addSuggestion(id, authorId, 'insert', startPos, endPos, text);
        }
      }, 0);
    });

    return tr;
  });

  return [suggestionState, suggestionPlugin, suggestionTheme, filter];
};
