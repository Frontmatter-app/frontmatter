/**
 * Applies autocorrect as the writer types, in Revise only.
 *
 * Wired as an update listener rather than a transaction filter on purpose.
 * Revise runs a suggestion filter that turns any user edit containing a
 * deletion into a tracked "delete" proposal; an autocorrect merged into the
 * writer's own transaction would be caught by that and turn a typo fix into a
 * change request against itself. Correcting afterwards, in a transaction that
 * carries no user event, keeps the fix as what it is — part of typing — while
 * leaving it as its own undo step, so one Ctrl+Z restores exactly what was
 * typed.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { computeAutoCorrection, type AutoCorrectOptions } from "./autoCorrect";

/** Syntax nodes whose contents are not prose and must be left exactly as typed. */
const PROTECTED_NODES = new Set([
  "InlineCode", "CodeText", "CodeBlock", "FencedCode", "CodeMark",
  "URL", "Autolink", "LinkMark", "HTMLTag", "HTMLBlock", "Comment",
  "CommentBlock", "ProcessingInstruction", "InlineMath", "BlockMath",
  "MathBlock", "MathInline", "Entity",
]);

/**
 * How much text before the caret the rules can see.
 *
 * Enough for the longest lookback any rule performs (a word, plus a walk back
 * over whitespace to the previous sentence) and small enough that this does
 * not allocate a copy of the document on every keystroke — which is what
 * reading `doc.toString()` here would do.
 */
const CONTEXT_WINDOW = 256;

function inProtectedRange(view: EditorView, from: number, to: number): boolean {
  let blocked = false;
  syntaxTree(view.state).iterate({
    from,
    to: Math.max(to, from + 1),
    enter: (node) => {
      if (PROTECTED_NODES.has(node.name)) {
        blocked = true;
        return false;
      }
      return undefined;
    },
  });
  return blocked;
}

/**
 * YAML front matter is configuration, and the Markdown parser does not mark it
 * as such — it sees a horizontal rule followed by paragraphs. Curly-quoting a
 * value in there would corrupt it.
 */
function inFrontMatter(view: EditorView, pos: number): boolean {
  const doc = view.state.doc;
  if (doc.length < 3 || doc.sliceString(0, 3) !== "---") return false;
  const head = doc.sliceString(0, Math.min(doc.length, Math.max(pos, 4) + 4));
  const closing = head.indexOf("\n---", 3);
  return closing === -1 || pos <= closing + 4;
}

export function autoCorrectExtension(getOptions: () => AutoCorrectOptions | null): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    const options = getOptions();
    if (!options || (!options.corrections && !options.smartPunctuation)) return;
    if (update.state.readOnly) return;

    // Only plain typing. Paste, undo, collaborative edits and our own
    // correction all reach here, and none of them should be rewritten. The
    // correction carries no user event at all, which is what stops this
    // listener from feeding itself.
    const typing = update.transactions.filter((tr) => tr.isUserEvent("input.type"));
    if (typing.length !== 1 || update.transactions.length !== typing.length) return;

    const selection = update.state.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) return;

    let inserted = 0;
    typing[0].changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
      inserted += text.length;
    });
    if (inserted !== 1) return;

    const pos = selection.main.head;
    const windowStart = Math.max(0, pos - CONTEXT_WINDOW);
    const context = update.state.doc.sliceString(windowStart, pos);

    const local = computeAutoCorrection(context, pos - windowStart, options);
    if (!local) return;

    const correction = {
      ...local,
      from: local.from + windowStart,
      to: local.to + windowStart,
    };

    if (inFrontMatter(update.view, correction.from)) return;
    if (inProtectedRange(update.view, correction.from, correction.to)) return;

    const original = context.slice(local.from, local.to);
    const caretShift = correction.insert.length - (correction.to - correction.from);

    queueMicrotask(() => {
      const view = update.view;
      if (!view.dom.isConnected || view.state.readOnly) return;
      // A collaborator's edit can land between the keystroke and this
      // microtask, so only apply the fix if the text it was computed against
      // is still where it was.
      if (view.state.doc.sliceString(correction.from, correction.to) !== original) return;

      view.dispatch({
        changes: { from: correction.from, to: correction.to, insert: correction.insert },
        selection: { anchor: Math.max(0, view.state.selection.main.head + caretShift) },
        scrollIntoView: false,
      });
    });
  });
}
