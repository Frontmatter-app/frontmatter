/**
 * Blanks out everything in a Markdown document that is not prose.
 *
 * Two properties matter and both are load-bearing:
 *
 *  - **Length is preserved.** Every masked code unit becomes a space (newlines
 *    survive as newlines), so an offset into the mask is the same offset in the
 *    source. Nothing downstream has to translate coordinates.
 *  - **It is computed once.** The previous code derived a list of ignored
 *    ranges and then asked, for every alert, whether it overlapped any of them
 *    — O(alerts x ranges) on every keystroke. A flag array answers the same
 *    question with one array read.
 */

export interface MaskedMarkdown {
  /** Same length as the source, with markup and code replaced by spaces. */
  text: string;
  /** 1 where the source code unit is markup or code and must not be linted. */
  ignored: Uint8Array;
  /**
   * Offsets where a block-level construct begins — headings, list items,
   * table rows, blockquote lines. Sentences never run across one of these,
   * which is what stops a bulleted list being read as a single 200-word
   * sentence.
   */
  blockStarts: number[];
}

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const FRONT_MATTER = /^---\s*$/;
const TABLE_DIVIDER = /^\s{0,3}\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const LINK_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S+/;

/** Block markers whose own characters are markup but whose tail is prose. */
const BLOCK_MARKER = /^(\s{0,3})(#{1,6}\s+|[-*+]\s+|\d{1,9}[.)]\s+|>\s?|\|)/;

/**
 * Inline markup, in the order it must be removed.
 *
 * Code and math come first: their contents can contain anything, including
 * sequences that look like links, and once masked the later patterns skip
 * them. Each entry says which capture group survives as prose — `null` means
 * the whole match is markup.
 */
const INLINE_PATTERNS: { re: RegExp; keep: number | null }[] = [
  { re: /(`+)(?:(?!\1)[\s\S])*\1/g, keep: null },
  { re: /\$\$[\s\S]*?\$\$|\$(?!\s)[^\n$]*[^\s$]\$/g, keep: null },
  { re: /<\/?[a-zA-Z][^>\n]*>/g, keep: null },
  { re: /<[^>\s\n]+>/g, keep: null },
  { re: /!\[([^\]]*)\]\([^)\n]*\)/g, keep: 1 },
  { re: /\[([^\]]*)\]\([^)\n]*\)/g, keep: 1 },
  { re: /\[\^[^\]\n]+\]/g, keep: null },
  { re: /\[([^\]]*)\]\[[^\]\n]*\]/g, keep: 1 },
  { re: /\b(?:https?:\/\/|www\.)\S+/g, keep: null },
  { re: /~~|\*{1,3}|(?<![A-Za-z0-9])_{1,3}(?![A-Za-z0-9])/g, keep: null },
];

export function maskMarkdown(source: string): MaskedMarkdown {
  const ignored = new Uint8Array(source.length);
  const blockStarts: number[] = [];

  const markRange = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(source.length, to); i += 1) {
      ignored[i] = 1;
    }
  };

  let offset = 0;
  let inFence = false;
  let fenceMarker = "";
  let inFrontMatter = false;

  const lines = source.split("\n");

  lines.forEach((line, index) => {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    offset = lineEnd + 1; // the "\n" we split on

    // Front matter is metadata, never prose.
    if (index === 0 && FRONT_MATTER.test(line)) {
      inFrontMatter = true;
      markRange(lineStart, lineEnd);
      return;
    }
    if (inFrontMatter) {
      markRange(lineStart, lineEnd);
      if (FRONT_MATTER.test(line)) inFrontMatter = false;
      return;
    }

    const fence = FENCE_OPEN.exec(line);
    if (inFence) {
      markRange(lineStart, lineEnd);
      if (fence && fence[2].startsWith(fenceMarker[0]) && fence[2].length >= fenceMarker.length) {
        inFence = false;
        fenceMarker = "";
      }
      return;
    }
    if (fence) {
      inFence = true;
      fenceMarker = fence[2];
      markRange(lineStart, lineEnd);
      blockStarts.push(lineStart);
      return;
    }

    // An indented code block. Four spaces only counts when the line is not a
    // list continuation, which we approximate by requiring no list marker.
    if (/^ {4,}\S/.test(line) && !/^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(line)) {
      markRange(lineStart, lineEnd);
      return;
    }

    if (LINK_DEFINITION.test(line) || (line.includes("|") && TABLE_DIVIDER.test(line))) {
      markRange(lineStart, lineEnd);
      blockStarts.push(lineStart);
      return;
    }

    if (line.trim().length === 0) return;

    // Strip every leading block marker: "> - **Note**" has three.
    let cursor = 0;
    let marker = BLOCK_MARKER.exec(line.slice(cursor));
    let sawMarker = false;
    while (marker) {
      const consumed = marker[0].length;
      markRange(lineStart + cursor, lineStart + cursor + consumed);
      cursor += consumed;
      sawMarker = true;
      marker = BLOCK_MARKER.exec(line.slice(cursor));
    }
    if (sawMarker || index === 0 || lines[index - 1].trim().length === 0) {
      blockStarts.push(lineStart + cursor);
    }

    // A setext underline (=== or ---) styles the line above; it is not prose.
    if (/^\s{0,3}(=+|-{2,})\s*$/.test(line)) {
      markRange(lineStart, lineEnd);
      return;
    }

    for (const { re, keep } of INLINE_PATTERNS) {
      re.lastIndex = 0;
      let match = re.exec(line);
      while (match) {
        const matchStart = lineStart + match.index;
        // Anything already inside code or math stays as it was.
        if (ignored[matchStart] !== 1) {
          if (keep === null || match[keep] === undefined) {
            markRange(matchStart, matchStart + match[0].length);
          } else {
            const kept = match[keep];
            const keptStart = matchStart + match[0].indexOf(kept, 1);
            markRange(matchStart, keptStart);
            markRange(keptStart + kept.length, matchStart + match[0].length);
          }
        }
        if (match[0].length === 0) re.lastIndex += 1;
        match = re.exec(line);
      }
    }
  });

  let text = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    text += ignored[i] === 1 && char !== "\n" ? " " : char;
  }

  return { text, ignored, blockStarts };
}

/**
 * Maps absolute offsets to 1-based line and column, and back.
 *
 * Built once per scan and shared. Everything that previously called
 * `text.slice(0, index).split("\n").length` was allocating a copy of the
 * document per issue to count newlines.
 */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\n") this.starts.push(i + 1);
    }
  }

  get lineCount(): number {
    return this.starts.length;
  }

  /** Absolute offset of the first character of a 1-based line. */
  lineStart(line: number): number {
    return this.starts[Math.min(Math.max(1, line), this.starts.length) - 1];
  }

  /** Absolute offset just past the last character of a 1-based line. */
  lineEnd(line: number): number {
    const clamped = Math.min(Math.max(1, line), this.starts.length);
    return clamped === this.starts.length ? this.text.length : this.starts[clamped] - 1;
  }

  lineAt(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  columnAt(offset: number): number {
    return offset - this.starts[this.lineAt(offset) - 1] + 1;
  }
}
