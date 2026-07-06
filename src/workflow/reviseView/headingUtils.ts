import { EditorState } from "@codemirror/state";

export function getActiveHeading(state: EditorState): string | null {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  for (let i = line.number; i >= 1; i--) {
    const text = state.doc.line(i).text.trim();
    const match = text.match(/^(#{1,6})\s+(.*)$/);
    if (match) return match[2].trim();
  }
  return null;
}
