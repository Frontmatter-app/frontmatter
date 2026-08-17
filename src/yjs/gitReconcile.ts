/**
 * Reconciling a moved git branch into a live CRDT document.
 *
 * This is the join between the two halves of the system, and the place where
 * getting it wrong quietly destroys people's writing.
 *
 * The situation: a room holds a document that several people are editing. It
 * was last known equal to some commit — the *base*. Meanwhile someone pushed to
 * the branch from a different machine, or the CLI, or the provider's web
 * editor. Now there are three texts: the base, what the room has (*local*), and
 * what the branch has (*remote*). Neither side may be discarded.
 *
 * Two tempting approaches are both wrong:
 *
 *   * **Overwrite the room with the remote.** Loses everything typed since the
 *     base, with no warning and no undo.
 *   * **Overwrite the remote with the room.** Loses the other person's commit,
 *     which git will happily do on a force push.
 *
 * What this does instead is a three-way merge, and then — the part that
 * matters — **applies the result to the Yjs document as the minimal set of text
 * operations**, rather than replacing its contents.
 *
 * That distinction is the whole design. Replacing the text would delete every
 * character and reinsert it, which to a CRDT is an enormous edit: every
 * collaborator's cursor jumps to the end, every comment anchor and suggestion
 * range is destroyed, and the update broadcast is the size of the document. A
 * minimal diff touches only what actually changed, so untouched regions keep
 * their identity and everything anchored to them survives.
 *
 * Conflicts never surface as `<<<<<<<` markers. A marker in a CRDT is not a
 * conflict a person can resolve — it is text that every peer immediately starts
 * editing on top of.
 */
import * as Y from 'yjs';
import DiffMatchPatch from 'diff-match-patch';

/** Marks updates this module authors, so listeners can tell them from typing. */
export const GIT_RECONCILE_ORIGIN = 'git-reconcile';

export interface ReconcileResult {
  /** Text the document holds afterwards — what a commit should contain. */
  merged: string;
  /** Whether the document was changed at all. */
  changed: boolean;
  /**
   * Hunks the remote moved that could not be placed in the local text.
   *
   * Not a failure: it means the two sides edited the same region so differently
   * that the remote's version has nowhere to sit. The local text is kept intact
   * and the caller decides what to tell the user — dropping the remote hunk
   * silently would lose a commit.
   */
  rejected: string[];
}

const dmp = new DiffMatchPatch();

// Defaults are tuned for short strings. A markdown document is long, and the
// stock 32-character match window means a hunk whose context has shifted by a
// paragraph is reported as unplaceable when it is perfectly placeable.
dmp.Match_Distance = 4000;
dmp.Match_Threshold = 0.6;
dmp.Patch_DeleteThreshold = 0.6;

/**
 * Merges a remote revision into a live document.
 *
 * `base` must be the text the document was last known equal to on the branch —
 * not simply the previous local text. Without a genuine common ancestor there
 * is no way to tell an addition from a deletion, and the merge degrades to
 * guessing.
 */
export function reconcileIntoDocument(
  text: Y.Text,
  base: string,
  remote: string,
  options: { origin?: unknown } = {},
): ReconcileResult {
  const local = text.toString();

  // Nobody moved, or both moved identically.
  if (base === remote) return { merged: local, changed: false, rejected: [] };

  // The room has no unpushed work: adopt the remote wholesale. Still applied as
  // a diff rather than a replace, for the reasons above.
  if (local === base) {
    const changed = applyAsOperations(text, local, remote, options.origin);
    return { merged: remote, changed, rejected: [] };
  }

  // Both sides moved. Carry the remote's changes onto the local text.
  const patches = dmp.patch_make(base, remote);
  const [mergedText, applied] = dmp.patch_apply(patches, local) as [string, boolean[]];

  const rejected: string[] = [];
  applied.forEach((ok, index) => {
    if (!ok) rejected.push(patchText(patches[index]));
  });

  const changed = applyAsOperations(text, local, mergedText, options.origin);
  return { merged: mergedText, changed, rejected };
}

/**
 * Turns a before/after pair into the smallest set of Yjs edits.
 *
 * Walks the diff once, holding an index into the *current* document: equal runs
 * advance it, insertions add at it, deletions remove at it. Everything happens
 * in one transaction so peers receive a single update rather than a storm of
 * per-character ones.
 */
export function applyAsOperations(
  text: Y.Text,
  before: string,
  after: string,
  origin: unknown = GIT_RECONCILE_ORIGIN,
): boolean {
  if (before === after) return false;

  const diffs = dmp.diff_main(before, after);
  // Without cleanup the diff is character-level noise, which produces far more
  // operations than the change deserves and fragments the CRDT's internal runs.
  dmp.diff_cleanupSemantic(diffs);

  const doc = text.doc;
  const run = () => {
    let cursor = 0;
    for (const [operation, chunk] of diffs) {
      if (operation === 0) {
        cursor += chunk.length;
      } else if (operation === 1) {
        text.insert(cursor, chunk);
        cursor += chunk.length;
      } else {
        text.delete(cursor, chunk.length);
      }
    }
  };

  if (doc) doc.transact(run, origin);
  else run();

  return true;
}

/**
 * The text a patch was trying to introduce, for reporting a rejected hunk.
 *
 * Loosely typed because `@types/diff-match-patch` declares `patch_make` as
 * returning the `patch_obj` constructor rather than instances of it.
 */
function patchText(patch: unknown): string {
  const diffs = (patch as { diffs?: Array<[number, string]> })?.diffs ?? [];
  return diffs
    .filter(([operation]) => operation !== -1)
    .map(([, chunk]) => chunk)
    .join('');
}
