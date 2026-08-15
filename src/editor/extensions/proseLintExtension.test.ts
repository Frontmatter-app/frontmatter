import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightSelectionMatches, search } from "@codemirror/search";
import {
  getLintIssues,
  lintIssueField,
  proseLintExtension,
  revealLintIssue,
  setActiveLintIssueEffect,
  setLintIssuesEffect,
} from "./proseLintExtension";
import { analyzeDocument } from "../../review/lintPipeline";
import { EMPTY_IGNORE_STATE, type LintIssue } from "../../review/lintTypes";
import { EMPTY_GRAMMAR_SCAN } from "../../review/grammarIssues";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [proseLintExtension()] }),
    parent,
  });
  views.push(view);
  return view;
}

function decorationRanges(view: EditorView): { from: number; to: number; cls: string }[] {
  const set = view.state.field(lintIssueField).decorations;
  const out: { from: number; to: number; cls: string }[] = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({ from: iter.from, to: iter.to, cls: (iter.value.spec.class as string) ?? "" });
    iter.next();
  }
  return out;
}

const issue = (from: number, to: number, over: Partial<LintIssue> = {}): LintIssue => ({
  id: `i-${from}-${to}`,
  from,
  to,
  line: 1,
  column: from + 1,
  severity: "suggestion",
  category: "adverb",
  rule: "adverb",
  message: "adverb",
  match: "",
  replacements: [],
  ...over,
});

describe("decorations", () => {
  it("draws one mark per issue, at the range it was given", () => {
    const view = mount("She quickly agreed and slowly left.");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(4, 11), issue(23, 29)]) });
    expect(decorationRanges(view)).toEqual([
      { from: 4, to: 11, cls: "cm-prose-issue cm-prose-adverb" },
      { from: 23, to: 29, cls: "cm-prose-issue cm-prose-adverb" },
    ]);
  });

  it("colours by category, not by severity", () => {
    const view = mount("A very long sentence goes here.");
    view.dispatch({
      effects: setLintIssuesEffect.of([
        issue(0, 6, { id: "a", category: "very-hard", severity: "error" }),
        issue(7, 11, { id: "b", category: "complex", severity: "error" }),
      ]),
    });
    const classes = decorationRanges(view).map((range) => range.cls);
    expect(classes[0]).toContain("cm-prose-very-hard");
    expect(classes[1]).toContain("cm-prose-complex");
  });

  it("clamps a range that outlives the text it was computed against", () => {
    const view = mount("short");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(0, 500)]) });
    const [range] = decorationRanges(view);
    expect(range.to).toBe(view.state.doc.length);
  });

  it("drops an empty range rather than throwing", () => {
    const view = mount("text");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(2, 2)]) });
    expect(decorationRanges(view)).toEqual([]);
  });
});

describe("following edits between scans", () => {
  it("keeps a highlight on its word when text is inserted before it", () => {
    const view = mount("She quickly agreed.");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(4, 11)]) });
    view.dispatch({ changes: { from: 0, insert: "Yesterday " } });

    const [range] = decorationRanges(view);
    expect(view.state.doc.sliceString(range.from, range.to)).toBe("quickly");
    expect(getLintIssues(view)[0].from).toBe(range.from);
  });

  it("keeps the issue list and the decorations in step", () => {
    const view = mount("She quickly agreed.");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(4, 11)]) });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const issues = getLintIssues(view);
    const ranges = decorationRanges(view);
    expect(issues[0].from).toBe(ranges[0].from);
    expect(issues[0].to).toBe(ranges[0].to);
  });
});

describe("active issue", () => {
  it("marks the active issue so its card and its highlight agree", () => {
    const view = mount("She quickly agreed.");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(4, 11)]) });
    view.dispatch({ effects: setActiveLintIssueEffect.of("i-4-11") });
    expect(decorationRanges(view)[0].cls).toContain("cm-prose-active");
  });

  it("clears again", () => {
    const view = mount("She quickly agreed.");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(4, 11)]) });
    view.dispatch({ effects: setActiveLintIssueEffect.of("i-4-11") });
    view.dispatch({ effects: setActiveLintIssueEffect.of(null) });
    expect(decorationRanges(view)[0].cls).not.toContain("cm-prose-active");
  });
});

describe("revealLintIssue", () => {
  it("puts the caret at the start of the issue", () => {
    const view = mount("She quickly agreed.");
    const target = issue(4, 11);
    view.dispatch({ effects: setLintIssuesEffect.of([target]) });
    revealLintIssue(view, target);
    expect(view.state.selection.main.head).toBe(4);
  });

  /**
   * The sidebar analyses on its own debounce, so a card can be holding the
   * range as it was a keystroke or two ago. Following the card's offsets put
   * the caret in the wrong place; the editor has the same issue with every
   * edit since mapped through it.
   */
  it("uses the editor's range, not the stale one the card was holding", () => {
    const view = mount("She quickly agreed.");
    const target = issue(4, 11);
    view.dispatch({ effects: setLintIssuesEffect.of([target]) });
    view.dispatch({ changes: { from: 0, insert: "Yesterday " } });

    revealLintIssue(view, target);

    const head = view.state.selection.main.head;
    expect(view.state.doc.sliceString(head, head + 7)).toBe("quickly");
  });

  it("marks the issue so the card and the highlight agree", () => {
    const view = mount("She quickly agreed.");
    const target = issue(4, 11);
    view.dispatch({ effects: setLintIssuesEffect.of([target]) });
    revealLintIssue(view, target);
    expect(view.state.field(lintIssueField).activeId).toBe(target.id);
  });

  /**
   * The reported bug. Selecting the flagged word made
   * `highlightSelectionMatches` light up every other occurrence of it, so one
   * card appeared to point at a dozen places at once.
   */
  it("leaves the selection empty, so the match highlighter stays quiet", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const doc = "what a day. It rained. what a shame. what next.";
    const view = new EditorView({
      // The real editor's search extensions, which is where the interference
      // came from — testing without them would have missed this entirely.
      state: EditorState.create({
        doc,
        extensions: [search(), highlightSelectionMatches(), proseLintExtension()],
      }),
      parent,
    });
    views.push(view);

    const target = issue(23, 27, { id: "second-what" });
    view.dispatch({ effects: setLintIssuesEffect.of([target]) });
    expect(doc.slice(23, 27)).toBe("what");

    revealLintIssue(view, target);

    expect(view.state.selection.main.empty).toBe(true);
    expect(view.contentDOM.querySelectorAll(".cm-selectionMatch")).toHaveLength(0);
  });
});

describe("end to end with the analyser", () => {
  it("highlights the words the analyser found, in the real document", () => {
    const doc = "The report was written by Kim. She quickly agreed.";
    const view = mount(doc);
    const { issues } = analyzeDocument(doc, EMPTY_GRAMMAR_SCAN, EMPTY_IGNORE_STATE);
    view.dispatch({ effects: setLintIssuesEffect.of(issues) });

    const ranges = decorationRanges(view);
    expect(ranges.length).toBe(issues.length);
    expect(ranges.map((range) => doc.slice(range.from, range.to))).toContain("was written");
    expect(ranges.map((range) => doc.slice(range.from, range.to))).toContain("quickly");
  });
});

describe("the styles actually reach the page", () => {
  const emittedCss = () =>
    Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");

  it("emits a wavy underline rule for grammar", () => {
    const view = mount("teh cat");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(0, 3, { category: "grammar" })]) });

    const css = emittedCss();
    expect(css).toContain("cm-prose-grammar");
    expect(css).toContain("text-decoration-style: wavy");
    expect(css).toContain("text-decoration-line: underline");
  });

  /**
   * The reported bug. `text-decoration: underline wavy <color>` is the CSS3
   * shorthand, and WebKit — the engine behind the Tauri webview this ships in
   * — parses `text-decoration` as the CSS2 shorthand that takes a line and
   * nothing more. It rejected the whole declaration as an unsupported value
   * and drew no underline at all.
   */
  it("never puts a style or a colour in the text-decoration shorthand", () => {
    mount("teh cat");
    for (const declaration of emittedCss().matchAll(/text-decoration:([^;}]*)/g)) {
      expect(declaration[1]).not.toMatch(/wavy|rgb|#[0-9a-f]{3}/i);
    }
  });

  it("repeats the underline with the -webkit- names older WebKit answers to", () => {
    mount("teh cat");
    expect(emittedCss()).toContain("-webkit-text-decoration-style: wavy");
  });

  it("puts both the shared and the category class on the span", () => {
    const view = mount("teh cat");
    view.dispatch({ effects: setLintIssuesEffect.of([issue(0, 3, { category: "grammar" })]) });
    const span = view.contentDOM.querySelector(".cm-prose-grammar");
    expect(span).not.toBeNull();
    expect(span!.className).toContain("cm-prose-issue");
    expect(span!.textContent).toBe("teh");
  });
});
