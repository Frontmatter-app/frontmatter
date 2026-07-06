import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { StateEffect, StateField, Extension, Transaction, EditorState } from '@codemirror/state';
import * as Y from 'yjs';
import { Suggestion, SuggestionManager } from '../yjs/suggestions';

export const setSuggestionsEffect = StateEffect.define<Suggestion[]>();
export const suggestionApplyEffect = StateEffect.define<void>();

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
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderBottom: '2px solid rgba(34, 197, 94, 0.8)',
    color: 'inherit'
  },
  '.cm-suggestion-delete': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    textDecoration: 'line-through rgba(239, 68, 68, 0.8) 2px',
    color: 'inherit',
    opacity: 0.8
  }
});

function isAdjacent(relPos: Y.RelativePosition, index: number, ytext: Y.Text): boolean {
  if (!ytext.doc) return false;
  const abs = Y.createAbsolutePositionFromRelativePosition(relPos, ytext.doc);
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

        try {
          for (const sug of suggestions) {
            if (sug.resolved) continue;

            const startAbs = Y.createAbsolutePositionFromRelativePosition(sug.start_pos, ytext.doc!);
            const endAbs = Y.createAbsolutePositionFromRelativePosition(sug.end_pos, ytext.doc!);
            
            if (startAbs && endAbs && startAbs.index <= endAbs.index) {
              const deco = sug.type === 'insert' ? insertDeco : deleteDeco;
              builder.push(deco.range(startAbs.index, endAbs.index));
            }
          }
        } catch (e) {
          console.error("Failed to build suggestion decorations:", e);
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
    // 1. Let programmatic suggestion applications through
    if (tr.effects.some(e => e.is(suggestionApplyEffect))) {
      return tr;
    }
    
    // 2. Only intercept user edits
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
