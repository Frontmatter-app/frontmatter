import { create } from "zustand";

/**
 * Which prose issue is currently under the caret.
 *
 * A store of its own rather than another field on the workspace context: the
 * caret moves on every keypress, and putting this in the workspace value would
 * re-render the explorer, the tab bar and both sidebars each time. Only the
 * review list subscribes.
 */
interface LintSelectionState {
  activeIssueId: string | null;
  /** Set by the sidebar so the editor knows the jump came from a card click. */
  setActiveIssueId: (id: string | null) => void;
}

export const useLintSelection = create<LintSelectionState>((set) => ({
  activeIssueId: null,
  setActiveIssueId: (activeIssueId) =>
    set((state) => (state.activeIssueId === activeIssueId ? state : { activeIssueId })),
}));

/** Asks the open editor to scroll to, select and highlight an issue. */
export const REVEAL_LINT_ISSUE = "editor-reveal-lint-issue";

/** Asks the open editor to replace an issue's text with one of its fixes. */
export const APPLY_LINT_FIX = "editor-apply-lint-fix";
