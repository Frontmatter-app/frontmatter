import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { autoCorrectExtension } from "./autoCorrectExtension";
import type { AutoCorrectOptions } from "./autoCorrect";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

const ALL: AutoCorrectOptions = { corrections: true, smartPunctuation: true };

function mount(doc: string, options: AutoCorrectOptions | null = ALL) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), autoCorrectExtension(() => options)],
    }),
    parent,
  });
  views.push(view);
  return view;
}

/** Types one character at the caret the way a keypress does, then settles. */
async function typeChar(view: EditorView, char: string, at = view.state.doc.length) {
  view.dispatch({
    changes: { from: at, insert: char },
    selection: { anchor: at + char.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
  await Promise.resolve();
  await Promise.resolve();
}

describe("in prose", () => {
  it("fixes a typo when the word is finished", async () => {
    const view = mount("I saw teh");
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("I saw the ");
  });

  it("leaves the caret after the corrected word", async () => {
    const view = mount("I saw teh");
    await typeChar(view, " ");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("curls a quote", async () => {
    const view = mount("She said");
    await typeChar(view, " ");
    await typeChar(view, '"');
    expect(view.state.doc.toString()).toBe("She said “");
  });

  it("does nothing when both switches are off", async () => {
    const view = mount("I saw teh", { corrections: false, smartPunctuation: false });
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("I saw teh ");
  });

  it("does nothing when autocorrect is not configured at all", async () => {
    const view = mount("I saw teh", null);
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("I saw teh ");
  });
});

describe("what it refuses to touch", () => {
  it("leaves inline code alone", async () => {
    const view = mount("Run `teh");
    await typeChar(view, "`");
    expect(view.state.doc.toString()).toBe("Run `teh`");
  });

  it("leaves a fenced code block alone", async () => {
    const view = mount("```js\nconst teh");
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("```js\nconst teh ");
  });

  it("leaves a URL alone", async () => {
    const view = mount("See [x](http://a.test/teh");
    await typeChar(view, ")");
    expect(view.state.doc.toString()).toBe("See [x](http://a.test/teh)");
  });

  it("leaves YAML front matter alone", async () => {
    const view = mount("---\ntitle: teh");
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("---\ntitle: teh ");
  });

  it("does not correct a read-only document", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "I saw teh",
        extensions: [
          markdown({ base: markdownLanguage }),
          EditorState.readOnly.of(true),
          autoCorrectExtension(() => ALL),
        ],
      }),
      parent,
    });
    views.push(view);
    // `EditorState.readOnly` stops user input, not programmatic dispatch, so
    // the space this test injects still lands. What must not happen is the
    // correction on top of it.
    await typeChar(view, " ");
    expect(view.state.doc.toString()).toBe("I saw teh ");
  });
});

describe("what counts as typing", () => {
  it("ignores a paste", async () => {
    const view = mount("I saw ");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "teh " },
      selection: { anchor: view.state.doc.length + 4 },
      annotations: Transaction.userEvent.of("input.paste"),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("I saw teh ");
  });

  it("ignores a programmatic edit, such as one arriving from a collaborator", async () => {
    const view = mount("I saw teh");
    view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("I saw teh ");
  });

  it("does not feed itself: the correction is not treated as typing", async () => {
    const view = mount("I saw teh");
    await typeChar(view, " ");
    const afterFirst = view.state.doc.toString();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(afterFirst);
  });
});
