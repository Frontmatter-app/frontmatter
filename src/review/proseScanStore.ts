import { create } from 'zustand';
import { EMPTY_GRAMMAR_SCAN, type GrammarLint, type GrammarScan } from './grammarIssues';

/**
 * Grammar results, which are the only ones that arrive from outside the editor.
 *
 * Readability and inclusive language are computed in the renderer and land
 * synchronously with the rest of the analysis. Grammar crosses the IPC boundary
 * because Harper is a Rust library, so it needs somewhere to sit between the
 * scan finishing and the next analysis.
 */
interface ProseScanState {
  /**
   * The last check, carrying the text it was a check of.
   *
   * Stored together on purpose. When these were two values — lints here, the
   * document wherever the caller happened to read it — every consumer paired
   * results with whatever the text had since become, which is how a warning
   * came to be drawn on a word Harper never looked at.
   */
  grammar: GrammarScan;
  /**
   * Why the last grammar check produced nothing, if it failed.
   *
   * Kept because the alternative is what happened before: the check threw, the
   * error went to a console nobody had open, and the editor looked exactly the
   * same as a document with no mistakes in it. "No underlines" and "the
   * checker never ran" have to be distinguishable from the outside.
   */
  grammarError: string | null;
  /** `text` is the document as it was handed to the checker, not as it is now. */
  setGrammarScan: (text: string, lints: GrammarLint[]) => void;
  setGrammarError: (message: string | null) => void;
  clear: () => void;
}

export const useProseScanStore = create<ProseScanState>((set) => ({
  grammar: EMPTY_GRAMMAR_SCAN,
  grammarError: null,
  setGrammarScan: (text, lints) => set({ grammar: { text, lints }, grammarError: null }),
  setGrammarError: (grammarError) => set({ grammarError, grammar: EMPTY_GRAMMAR_SCAN }),
  // Reuses the same empty scan every time, so the analysis memo and every
  // `useMemo` downstream see an unchanged reference instead of a new object.
  clear: () => set({ grammar: EMPTY_GRAMMAR_SCAN, grammarError: null }),
}));
