import { Extension } from "@codemirror/state";
import {
  ViewPlugin,
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";

// Focus mode plugin lowers the opacity of all lines except the one the cursor is on.
// We decorate the inactive lines with a class that gives it lower opacity.

const focusLineDeco = Decoration.line({ class: "cm-focus-line" });
const inactiveLineDeco = Decoration.line({ class: "cm-inactive-line" });

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    active: boolean;

    constructor(view: EditorView) {
      this.active = false; // We can control this via an Effect or StateField, but for simplicity, we'll listen to a CSS class on the container or handle updates.
      this.decorations = this.buildDeco(view);
    }

    update(update: any) {
      // Check if view DOM or its ancestors have the 'focus-mode-active' class
      const isActive = !!update.view.dom.closest(".focus-mode-active");
      if (
        update.docChanged ||
        update.selectionSet ||
        this.active !== isActive
      ) {
        this.active = isActive;
        this.decorations = this.buildDeco(update.view);
      }
    }

    buildDeco(view: EditorView) {
      if (!this.active) return Decoration.none;

      const builder = [];
      const { state } = view;
      const cursorLineContent = state.doc.lineAt(state.selection.main.head);

      for (let i = 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i);
        if (line.number === cursorLineContent.number) {
          builder.push(focusLineDeco.range(line.from, line.from));
        } else {
          builder.push(inactiveLineDeco.range(line.from, line.from));
        }
      }

      return Decoration.set(builder, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export const focusModeTheme = EditorView.theme({
  ".focus-mode-active .cm-inactive-line": {
    opacity: 0.3,
    transition: "opacity 0.2s ease-in-out",
  },
  ".focus-mode-active .cm-focus-line": {
    opacity: 1,
    transition: "opacity 0.2s ease-in-out",
  },
});

export const focusModeExtension = (): Extension => {
  return [focusPlugin, focusModeTheme];
};
