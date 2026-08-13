import type { EditorView } from '@codemirror/view';

/**
 * The editor the user is currently working in.
 *
 * Menu commands and other chrome need to act on the editor without holding a
 * React reference to it. This mirrors the existing `setCurrentDocId` registry
 * in `keyboard/useGlobalShortcuts`.
 */
let activeView: EditorView | null = null;

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view;
}

/** The focused editor, or `null` when no document is open. */
export function getActiveEditorView(): EditorView | null {
  // A destroyed view keeps its reference but its DOM is detached.
  if (activeView && !activeView.dom.isConnected) return null;
  return activeView;
}

/** Runs `action` against the active editor and returns whether it ran. */
export function withActiveEditor(action: (view: EditorView) => void): boolean {
  const view = getActiveEditorView();
  if (!view) return false;
  action(view);
  view.focus();
  return true;
}
