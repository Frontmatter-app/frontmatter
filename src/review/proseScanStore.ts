import { create } from 'zustand';
import type { GrammarLint } from './grammarIssues';

/**
 * Grammar results, which are the only ones that arrive from outside the editor.
 *
 * Readability and inclusive language are computed in the renderer and land
 * synchronously with the rest of the analysis. Grammar crosses the IPC boundary
 * because Harper is a Rust library, so it needs somewhere to sit between the
 * scan finishing and the next analysis.
 */
interface ProseScanState {
  grammarLints: GrammarLint[];
  /**
   * Why the last grammar check produced nothing, if it failed.
   *
   * Kept because the alternative is what happened before: the check threw, the
   * error went to a console nobody had open, and the editor looked exactly the
   * same as a document with no mistakes in it. "No underlines" and "the
   * checker never ran" have to be distinguishable from the outside.
   */
  grammarError: string | null;
  setGrammarLints: (lints: GrammarLint[]) => void;
  setGrammarError: (message: string | null) => void;
  clear: () => void;
}

const EMPTY_LINTS: GrammarLint[] = [];

export const useProseScanStore = create<ProseScanState>((set) => ({
  grammarLints: EMPTY_LINTS,
  grammarError: null,
  setGrammarLints: (grammarLints) => set({ grammarLints, grammarError: null }),
  setGrammarError: (grammarError) => set({ grammarError, grammarLints: EMPTY_LINTS }),
  // Reuses the same empty array every time, so the analysis memo and every
  // `useMemo` downstream see an unchanged reference instead of a new object.
  clear: () => set({ grammarLints: EMPTY_LINTS, grammarError: null }),
}));
