import type * as Y from 'yjs';
import { toAbsolute } from './relativePositions';

interface Anchored {
  id: string;
  start_pos: Y.RelativePosition | null;
  end_pos: Y.RelativePosition | null;
  resolved: boolean;
}

/**
 * Sorted lookup from a document offset to the annotation or suggestion covering
 * it.
 *
 * The cursor listeners used to answer this by scanning the whole list on every
 * selection change and every document change — rebuilding each record and
 * base64-decoding both of its anchors — which is O(n) decodes per keystroke.
 * Resolving the anchors once per change to the underlying list and binary
 * searching the result makes cursor movement independent of how many notes a
 * document carries.
 *
 * Mirrors `BlockedRangeIndex` in the inline-preview builders.
 */
export class AnchorIndex {
  private ids: string[] = [];
  private froms: number[] = [];
  private tos: number[] = [];
  /** `maxTo[i]` is the furthest end among entries `0..i`. */
  private maxTo: number[] = [];

  constructor(items: Anchored[], ydoc: Y.Doc) {
    const entries: Array<{ id: string; from: number; to: number }> = [];
    for (const item of items) {
      if (item.resolved) continue;
      const start = toAbsolute(item.start_pos, ydoc);
      const end = toAbsolute(item.end_pos, ydoc);
      if (!start || !end || start.index > end.index) continue;
      entries.push({ id: item.id, from: start.index, to: end.index });
    }
    entries.sort((a, b) => a.from - b.from || a.to - b.to);

    let running = -Infinity;
    for (const entry of entries) {
      this.ids.push(entry.id);
      this.froms.push(entry.from);
      this.tos.push(entry.to);
      running = Math.max(running, entry.to);
      this.maxTo.push(running);
    }
  }

  get size(): number {
    return this.ids.length;
  }

  /**
   * The id of a range covering `pos`, or null.
   *
   * Ranges may overlap and nest, so the search finds the last range starting at
   * or before `pos` and walks back while an earlier range could still reach it.
   * The prefix maximum makes that exact rather than a guess at how long a range
   * might be, and stops immediately in the common case.
   */
  at(pos: number): string | null {
    let lo = 0;
    let hi = this.ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.froms[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo - 1; i >= 0; i--) {
      if (this.tos[i] >= pos) return this.ids[i];
      if (this.maxTo[i] < pos) break;
    }
    return null;
  }
}
