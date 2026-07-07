import { EditorState, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { DecorationSet } from '@codemirror/view';
import { collectMarkdownReferences, parseMarkdownImageToken, type MarkdownReferences } from './markdown';
import { isMarkdownTableSeparator, isMarkdownTableRow, parseFenceInfo, stripInlineAttrs, stripBlockMathFence } from './markdownUtils';

const KNOWN_BLOCK_TAGS = new Set([
  'tabs', 'tab', 'note', 'info', 'summary',
  'warning', 'tip', 'details', 'check', 'danger',
  'important', 'caution',
]);

export interface DocMetaCache {
  fencedLines: Set<number>;
  blockTags: Array<{ tag: string; start: number; end: number }>;
  tables: Array<{ startLine: number; endLine: number; from: number; to: number; raw: string }>;
  blockImages: Array<{ startLine: number; endLine: number; from: number; to: number; alt: string; url: string }>;
  mathBlocks: Array<{ startLine: number; endLine: number; from: number; to: number; formula: string }>;
  diagrams: Array<{ startLine: number; endLine: number; from: number; to: number; diagramType: string; source: string }>;
  references: MarkdownReferences;
}

export function buildDocMeta(state: EditorState): DocMetaCache {
  const doc = state.doc;
  const fencedLines = new Set<number>();
  const references = collectMarkdownReferences(doc.toString());

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;

      const start = doc.lineAt(node.from).number;
      const end = doc.lineAt(node.to).number;
      for (let line = start; line <= end; line++) fencedLines.add(line);
      return false;
    },
  });

  const blockTags: DocMetaCache['blockTags'] = [];
  const tables: DocMetaCache['tables'] = [];
  const mathBlocks: DocMetaCache['mathBlocks'] = [];
  const stack: Array<{ tag: string; lineNum: number }> = [];

  let i = 1;
  while (i <= doc.lines) {
    if (fencedLines.has(i)) {
      i++;
      continue;
    }

    const line = doc.line(i);
    const text = line.text.trim();

    const singleLineMath = text.match(/^\$\$\s*([\s\S]*?)\s*\$\$\s*(?:\{[^}]*\}\s*)?$/);
    if (singleLineMath) {
      mathBlocks.push({
        startLine: i,
        endLine: i,
        from: line.from,
        to: line.to,
        formula: singleLineMath[1].trim(),
      });
      i++;
      continue;
    }

    if (text.startsWith('$$')) {
      const startLine = i;
      let endLine = i;
      let next = i + 1;
      while (next <= doc.lines) {
        if (!fencedLines.has(next) && doc.line(next).text.trim().startsWith('$$')) {
          endLine = next;
          break;
        }
        next++;
      }

      if (endLine !== startLine) {
        const firstLineContent = stripBlockMathFence(line.text, true);
        const lastLineContent = stripBlockMathFence(doc.line(endLine).text, false);
        const middle = startLine + 1 <= endLine - 1
          ? doc.sliceString(doc.line(startLine + 1).from, doc.line(endLine - 1).to)
          : '';
        const formula = [firstLineContent, middle, lastLineContent]
          .filter(part => part.trim().length > 0)
          .join('\n')
          .trim();

        mathBlocks.push({
          startLine,
          endLine,
          from: doc.line(startLine).from,
          to: doc.line(endLine).to,
          formula,
        });
        i = endLine + 1;
        continue;
      }
    }

    if (
      isMarkdownTableRow(line.text) &&
      i + 1 <= doc.lines &&
      !fencedLines.has(i + 1) &&
      isMarkdownTableSeparator(doc.line(i + 1).text)
    ) {
      const startLine = i;
      let endLine = i + 1;
      let next = i + 2;
      while (next <= doc.lines && !fencedLines.has(next) && isMarkdownTableRow(doc.line(next).text)) {
        endLine = next;
        next++;
      }

      const from = doc.line(startLine).from;
      const to = doc.line(endLine).to;
      tables.push({ startLine, endLine, from, to, raw: doc.sliceString(from, to) });
      i = endLine + 1;
      continue;
    }

    const closeMatch = text.match(/^<\/([a-zA-Z0-9_-]+)>$/);
    if (closeMatch) {
      const tag = closeMatch[1].toLowerCase();
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag !== tag) continue;
        blockTags.push({ tag, start: stack[s].lineNum, end: i });
        stack.splice(s, 1);
        break;
      }
      i++;
      continue;
    }

    const openMatch = text.match(/^<([a-zA-Z0-9_-]+)(?:\s[^>]*)?>$/);
    if (openMatch) {
      const tag = openMatch[1].toLowerCase();
      if (KNOWN_BLOCK_TAGS.has(tag)) stack.push({ tag, lineNum: i });
    }

    i++;
  }

  const blockImages: DocMetaCache['blockImages'] = [];
  const diagrams: DocMetaCache['diagrams'] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;

      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      const info = parseFenceInfo(startLine.text);
      if (info.language !== 'mermaid') return false;
      if (endLine.number <= startLine.number) return false;

      const sourceFrom = startLine.number + 1 <= endLine.number - 1 ? doc.line(startLine.number + 1).from : startLine.to;
      const sourceTo = startLine.number + 1 <= endLine.number - 1 ? doc.line(endLine.number - 1).to : startLine.to;
      diagrams.push({
        startLine: startLine.number,
        endLine: endLine.number,
        from: startLine.from,
        to: endLine.to,
        diagramType: info.language,
        source: doc.sliceString(sourceFrom, sourceTo).trim(),
      });
      return false;
    },
  });

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Image') return;

      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      if (startLine.number !== endLine.number || fencedLines.has(startLine.number)) return false;

      const raw = doc.sliceString(node.from, node.to);
      const image = parseMarkdownImage(raw, references);
      if (!image || startLine.text.trim() !== raw.trim()) return false;

      blockImages.push({
        startLine: startLine.number,
        endLine: endLine.number,
        from: startLine.from,
        to: endLine.to,
        alt: image.alt,
        url: image.url,
      });
      return false;
    },
  });

  return { fencedLines, blockTags, tables, blockImages, mathBlocks, diagrams, references };
}

export const docMetaField = StateField.define<DocMetaCache>({
  create: buildDocMeta,
  update(cache, tr) {
    if (!tr.docChanged) return cache;
    return buildDocMeta(tr.state);
  },
});

export class BlockedRangeIndex {
  private ranges: Array<{ from: number; to: number }> = [];

  constructor(decoSet: DecorationSet) {
    const cursor = decoSet.iter();
    while (cursor.value !== null) {
      this.ranges.push({ from: cursor.from, to: cursor.to });
      cursor.next();
    }
  }

  overlaps(from: number, to: number): boolean {
    let lo = 0;
    let hi = this.ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ranges[mid].to <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.ranges.length && this.ranges[lo].from < to;
  }

  contains(pos: number): boolean {
    let lo = 0;
    let hi = this.ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ranges[mid].to <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.ranges.length && this.ranges[lo].from <= pos;
  }
}

export function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA <= endB && endA >= startB;
}

export function sortRanges<T extends { from: number; to: number }>(a: T, b: T) {
  return a.from - b.from || a.to - b.to;
}

export function parseMarkdownImage(raw: string, references: MarkdownReferences = {}) {
  return parseMarkdownImageToken(raw, references);
}


