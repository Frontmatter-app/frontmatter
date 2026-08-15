/**
 * The native spell checker, which is off unless this app says otherwise.
 *
 * CodeMirror hard-codes `spellcheck: "false"` into the attributes it puts on
 * `.cm-content` — along with `autocorrect: "off"` and
 * `writingsuggestions: "false"` — on the reasoning that a code editor does not
 * want the OS marking up identifiers. This is a prose editor, so every view
 * overrides it, and these tests exist so that override cannot be quietly lost:
 * without it there is no underline and nothing on screen to explain why.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** Exactly the expression every view builds its spellcheck attribute from. */
function mount(spellCheck?: boolean) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: "teh cat sat on teh mat",
      extensions: [
        EditorView.contentAttributes.of({ spellcheck: String(spellCheck ?? true) }),
      ],
    }),
    parent,
  });
  views.push(view);
  return view;
}

describe("native spell check", () => {
  it("is on when the setting is on", () => {
    expect(mount(true).contentDOM.getAttribute("spellcheck")).toBe("true");
  });

  it("is on when the setting has never been chosen", () => {
    // Every view reads `settings.spellCheck ?? true`, and the stored settings
    // of anyone who upgraded from before the setting existed have no value at
    // all for it. On is the default they should get.
    expect(mount(undefined).contentDOM.getAttribute("spellcheck")).toBe("true");
  });

  it("is off only when the writer has turned it off", () => {
    expect(mount(false).contentDOM.getAttribute("spellcheck")).toBe("false");
  });

  /** The reason the override has to exist at all. */
  it("is off in a CodeMirror editor that does not override it", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const bare = new EditorView({ state: EditorState.create({ doc: "teh" }), parent });
    views.push(bare);
    expect(bare.contentDOM.getAttribute("spellcheck")).toBe("false");
  });

  /**
   * These two stay as CodeMirror sets them, and both are wanted.
   *
   * Revise runs autocorrect of its own, which would fight the OS over the same
   * keystroke, and writing suggestions is the hook for the system's generative
   * text — which this app deliberately has none of.
   */
  it("leaves OS autocorrect and writing suggestions off", () => {
    const content = mount(true).contentDOM;
    expect(content.getAttribute("autocorrect")).toBe("off");
    expect(content.getAttribute("writingsuggestions")).toBe("false");
  });
});
