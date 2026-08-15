/**
 * Draws prose issues in the editor and keeps the sidebar in step with them.
 *
 * Three changes from the version this replaces, all of them visible:
 *
 *  - Ranges arrive already resolved, so nothing here re-derives a position
 *    from a line and a span. Between scans the ranges are *mapped* through
 *    edits rather than recomputed, which is both cheaper and correct — the old
 *    plugin rebuilt every decoration on every keystroke against stale line
 *    numbers, so highlights slid off their words as you typed.
 *  - Highlighting is a tinted span per category rather than one
 *    wavy underline per severity.
 *  - Clicking a highlight tells the rest of the app which issue is active, so
 *    the review sidebar can scroll to the matching card.
 */

import { Decoration, EditorView, hoverTooltip, type DecorationSet, type Tooltip } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { LintCategory, LintIssue } from "../../review/lintTypes";
import { getIssueLocationText } from "../../review/lintTypes";
import { issueAt } from "../../review/lintPipeline";

export const setLintIssuesEffect = StateEffect.define<LintIssue[]>();
export const setActiveLintIssueEffect = StateEffect.define<string | null>();

interface LintFieldValue {
  issues: LintIssue[];
  activeId: string | null;
  decorations: DecorationSet;
}

const CATEGORY_CLASS: Record<LintCategory, string> = {
  "very-hard": "cm-prose-very-hard",
  hard: "cm-prose-hard",
  passive: "cm-prose-passive",
  adverb: "cm-prose-adverb",
  complex: "cm-prose-complex",
  inclusive: "cm-prose-inclusive",
  grammar: "cm-prose-grammar",
};

/**
 * One decoration object per category, reused.
 *
 * `Decoration.mark` results are immutable and comparable by identity;
 * allocating a fresh one per issue defeats CodeMirror's own diffing.
 */
const MARKS: Record<LintCategory, Decoration> = {
  "very-hard": Decoration.mark({ class: "cm-prose-issue cm-prose-very-hard" }),
  hard: Decoration.mark({ class: "cm-prose-issue cm-prose-hard" }),
  passive: Decoration.mark({ class: "cm-prose-issue cm-prose-passive" }),
  adverb: Decoration.mark({ class: "cm-prose-issue cm-prose-adverb" }),
  complex: Decoration.mark({ class: "cm-prose-issue cm-prose-complex" }),
  inclusive: Decoration.mark({ class: "cm-prose-issue cm-prose-inclusive" }),
  grammar: Decoration.mark({ class: "cm-prose-issue cm-prose-grammar" }),
};

const ACTIVE_MARKS: Record<LintCategory, Decoration> = Object.fromEntries(
  (Object.keys(MARKS) as LintCategory[]).map((category) => [
    category,
    Decoration.mark({ class: `cm-prose-issue cm-prose-active ${CATEGORY_CLASS[category]}` }),
  ]),
) as Record<LintCategory, Decoration>;

function buildDecorations(issues: LintIssue[], activeId: string | null, docLength: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // `issues` is already sorted by `from`, which is what RangeSetBuilder needs.
  for (const issue of issues) {
    const from = Math.max(0, Math.min(issue.from, docLength));
    const to = Math.max(from, Math.min(issue.to, docLength));
    if (to <= from) continue;
    const marks = issue.id === activeId ? ACTIVE_MARKS : MARKS;
    builder.add(from, to, marks[issue.category] ?? marks.grammar);
  }
  return builder.finish();
}

export const lintIssueField = StateField.define<LintFieldValue>({
  create() {
    return { issues: [], activeId: null, decorations: Decoration.none };
  },
  update(value, tr) {
    let next = value;

    for (const effect of tr.effects) {
      if (effect.is(setLintIssuesEffect)) {
        next = {
          issues: effect.value,
          activeId: next.activeId,
          decorations: buildDecorations(effect.value, next.activeId, tr.state.doc.length),
        };
      } else if (effect.is(setActiveLintIssueEffect)) {
        if (effect.value === next.activeId) continue;
        next = {
          issues: next.issues,
          activeId: effect.value,
          decorations: buildDecorations(next.issues, effect.value, tr.state.doc.length),
        };
      }
    }

    if (next === value && tr.docChanged) {
      // Between scans, follow the edits instead of redrawing against stale
      // offsets. `mapPos` keeps a highlight on its word while the writer types
      // ahead of it; the next scan replaces the set outright.
      //
      // An issue the edit did not move is passed through untouched rather than
      // copied. Now that the analysis no longer truncates at a thousand, a long
      // document can hold many thousands of these, and everything above the
      // caret is unaffected by a keystroke — there is no reason to allocate a
      // new object for each of them on every character typed.
      return {
        issues: value.issues.map((issue) => {
          const from = tr.changes.mapPos(issue.from, 1);
          const to = tr.changes.mapPos(issue.to, -1);
          return from === issue.from && to === issue.to ? issue : { ...issue, from, to };
        }),
        activeId: value.activeId,
        decorations: value.decorations.map(tr.changes),
      };
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function getLintIssues(view: EditorView): LintIssue[] {
  return view.state.field(lintIssueField, false)?.issues ?? [];
}

export const proseLintTheme = EditorView.theme({
  ".cm-prose-issue": {
    borderRadius: "2px",
    // A background alone reads as a selection; the underline keeps the two
    // apart for anyone who cannot separate the tints.
    boxShadow: "inset 0 -1px 0 0 currentColor",
  },
  ".cm-prose-very-hard": {
    backgroundColor: "color-mix(in srgb, var(--editor-bg-color, #fff) 76%, #f43f5e 24%)",
    color: "inherit",
    boxShadow: "inset 0 -1.5px 0 0 rgba(244, 63, 94, 0.75)",
  },
  ".cm-prose-hard": {
    backgroundColor: "color-mix(in srgb, var(--editor-bg-color, #fff) 78%, #f59e0b 22%)",
    boxShadow: "inset 0 -1.5px 0 0 rgba(245, 158, 11, 0.75)",
  },
  ".cm-prose-passive": {
    backgroundColor: "color-mix(in srgb, var(--editor-bg-color, #fff) 80%, #10b981 20%)",
    boxShadow: "inset 0 -1.5px 0 0 rgba(16, 185, 129, 0.8)",
  },
  ".cm-prose-adverb": {
    backgroundColor: "color-mix(in srgb, var(--editor-bg-color, #fff) 80%, #3b82f6 20%)",
    boxShadow: "inset 0 -1.5px 0 0 rgba(59, 130, 246, 0.8)",
  },
  ".cm-prose-complex": {
    backgroundColor: "color-mix(in srgb, var(--editor-bg-color, #fff) 80%, #a855f7 20%)",
    boxShadow: "inset 0 -1.5px 0 0 rgba(168, 85, 247, 0.8)",
  },
  ".cm-prose-inclusive": {
    backgroundColor: "transparent",
    boxShadow: "inset 0 -2px 0 0 rgba(20, 184, 166, 0.85)",
  },
  // Grammar is the one category that means "this is wrong" rather than "this
  // could be better", so it gets the underline a spell checker would draw
  // instead of one of the readability tints.
  //
  // Written as longhands, and twice.
  //
  // The obvious `text-decoration: underline wavy <color>` is the CSS3
  // shorthand, and WebKit — which is the engine this app actually ships on,
  // through the Tauri webview — parses `text-decoration` as the CSS2 shorthand
  // that takes a line and nothing else. It does not fail on the `wavy` and
  // drop back to a plain underline; it rejects the whole declaration as an
  // unsupported value, so the underline was never drawn at all. The longhands
  // are parsed individually, so a value WebKit dislikes can only cost that one
  // property. The `-webkit-` copies are what older WebKit answers to, and
  // style-mod turns a leading capital into the leading dash they need.
  ".cm-prose-grammar": {
    backgroundColor: "transparent",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationColor: "rgba(244, 63, 94, 0.9)",
    textDecorationSkipInk: "none",
    WebkitTextDecorationLine: "underline",
    WebkitTextDecorationStyle: "wavy",
    WebkitTextDecorationColor: "rgba(244, 63, 94, 0.9)",
    // The name WebKit had for skip-ink before it took the standard one.
    WebkitTextDecorationSkip: "none",
    textUnderlineOffset: "3px",
    boxShadow: "none",
  },
  // The sole indicator of which issue a card refers to, now that revealing one
  // no longer selects it, so it has to be unmistakable on its own.
  ".cm-prose-active": {
    outline: "2px solid color-mix(in srgb, var(--editor-text-color, #000) 55%, transparent)",
    outlineOffset: "2px",
    borderRadius: "3px",
  },
  ".cm-prose-tooltip": {
    maxWidth: "22rem",
    padding: "0.6rem 0.7rem",
    borderRadius: "0.6rem",
    fontSize: "11px",
    lineHeight: "1.5",
    background: "var(--editor-bg-color, #fff)",
    color: "var(--editor-text-color, #000)",
    border: "1px solid rgba(127, 127, 127, 0.25)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
  },
  ".cm-prose-tooltip .cm-prose-tooltip-rule": {
    fontFamily: "ui-monospace, monospace",
    fontSize: "9px",
    opacity: "0.6",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  ".cm-prose-tooltip .cm-prose-tooltip-message": {
    fontWeight: "600",
    marginTop: "2px",
  },
  ".cm-prose-tooltip .cm-prose-tooltip-detail": {
    opacity: "0.78",
    marginTop: "3px",
  },
});

/**
 * A hover card built from DOM nodes.
 *
 * The card it replaces was assembled with `innerHTML` from rule text and had
 * to hand-escape every field; one missed call was an injection from whatever
 * the document happened to contain. It also positioned itself against
 * `window.scrollY` and attached a document-wide mousedown listener per show.
 */
const lintTooltip = hoverTooltip((view, pos): Tooltip | null => {
  const issue = issueAt(getLintIssues(view), pos);
  if (!issue) return null;

  return {
    pos: issue.from,
    end: issue.to,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-prose-tooltip";

      const rule = dom.appendChild(document.createElement("div"));
      rule.className = "cm-prose-tooltip-rule";
      rule.textContent = `${issue.severity} · ${issue.rule}`;

      const message = dom.appendChild(document.createElement("div"));
      message.className = "cm-prose-tooltip-message";
      message.textContent = issue.message;

      if (issue.description) {
        const detail = dom.appendChild(document.createElement("div"));
        detail.className = "cm-prose-tooltip-detail";
        detail.textContent = issue.description;
      }

      if (issue.replacements.length > 0) {
        const fix = dom.appendChild(document.createElement("div"));
        fix.className = "cm-prose-tooltip-detail";
        fix.textContent = `Try: ${issue.replacements.filter(Boolean).join(", ")}`;
      }

      const location = dom.appendChild(document.createElement("div"));
      location.className = "cm-prose-tooltip-rule";
      location.textContent = getIssueLocationText(issue);

      return { dom };
    },
  };
}, { hoverTime: 250 });

/**
 * Reports which issue the caret sits in.
 *
 * Runs on selection changes only, and only when the answer differs from last
 * time, so moving through a paragraph does not dispatch a transaction per
 * keypress.
 */
function activationWatcher(onActivate?: (issue: LintIssue | null) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const field = update.state.field(lintIssueField, false);
    if (!field) return;

    const pos = update.state.selection.main.head;
    const issue = issueAt(field.issues, pos);
    const nextId = issue?.id ?? null;
    if (nextId === field.activeId) return;

    // Dispatching from an update listener has to be deferred.
    queueMicrotask(() => {
      if (!update.view.dom.isConnected) return;
      update.view.dispatch({ effects: setActiveLintIssueEffect.of(nextId) });
      onActivate?.(issue);
    });
  });
}

export interface ProseLintOptions {
  /** Called when the active issue changes, including when it becomes none. */
  onActivate?: (issue: LintIssue | null) => void;
}

export function proseLintExtension(options: ProseLintOptions = {}): Extension {
  return [lintIssueField, proseLintTheme, lintTooltip, activationWatcher(options.onActivate)];
}

/**
 * Scrolls to an issue and marks it. Used by the sidebar.
 *
 * Deliberately leaves the selection empty.
 *
 * Selecting the flagged text seemed the obvious thing to do, and it was wrong:
 * the editor runs `highlightSelectionMatches()` with its default
 * `minSelectionLength: 1`, so selecting the word "what" lit up every other
 * "what" in the document. Clicking one card appeared to point at a dozen
 * places at once — and being case-sensitive, it picked out exactly the
 * lower-case ones, which is precisely the set a capitalization warning is
 * about, making the wrong highlights look deliberate.
 *
 * The caret goes to the start of the issue and `cm-prose-active` marks its
 * full extent, which says "this one" without the match highlighter joining in.
 */
export function revealLintIssue(view: EditorView, issue: LintIssue): void {
  // The card holds the range as the sidebar last analysed it, which is a
  // debounce behind the editor. The copy in the field is the same issue with
  // every edit since mapped through it, so it is the one that still points at
  // the right words.
  const current = getLintIssues(view).find((held) => held.id === issue.id) ?? issue;
  const docLength = view.state.doc.length;
  const from = Math.max(0, Math.min(current.from, docLength));

  view.dispatch({
    selection: { anchor: from },
    effects: [
      EditorView.scrollIntoView(from, { y: "center", yMargin: 80 }),
      setActiveLintIssueEffect.of(issue.id),
    ],
  });
  view.focus();
}
