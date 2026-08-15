import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Table } from '@lezer/markdown';
import { buildDocMeta } from './markdownAnalysis';

function meta(doc: string) {
  return buildDocMeta(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [Table] })],
    }),
  );
}

describe('buildDocMeta — tables', () => {
  it('finds a table', () => {
    const { tables } = meta('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it('accepts a colon-aligned separator with spaces', () => {
    const { tables } = meta('| a | b |\n| :--- | ---: |\n| 1 | 2 |\n');
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it('stops at prose that merely contains a pipe', () => {
    // The reported symptom: the trailing line was absorbed into the widget.
    const { tables } = meta('| a | b |\n|---|---|\n| 1 | 2 |\nRun `git log | head` to see.\n');
    expect(tables).toHaveLength(1);
    expect(tables[0].endLine).toBe(3);
  });

  it('stops at a following heading', () => {
    const { tables } = meta('| a | b |\n|---|---|\n| 1 | 2 |\n## Next | section\n');
    expect(tables[0].endLine).toBe(3);
  });

  it('ignores a table inside a fenced code block', () => {
    const { tables } = meta('```\n| a | b |\n|---|---|\n```\n');
    expect(tables).toHaveLength(0);
  });
});

describe('buildDocMeta — block math', () => {
  it('finds a single-line block', () => {
    const { mathBlocks } = meta('$$x + y$$\n');
    expect(mathBlocks).toHaveLength(1);
    expect(mathBlocks[0].formula).toBe('x + y');
  });

  it('finds a multi-line block', () => {
    const { mathBlocks } = meta('$$\nx + y\n$$\n');
    expect(mathBlocks).toHaveLength(1);
    expect(mathBlocks[0]).toMatchObject({ startLine: 1, endLine: 3, formula: 'x + y' });
  });

  it('does not merge two blocks on one line into one formula', () => {
    // The lazy regex spanned both, producing the formula `x$$ and $$y`.
    const { mathBlocks } = meta('$$x$$ and $$y$$\n');
    expect(mathBlocks.map(b => b.formula)).not.toContain('x$$ and $$y');
  });

  it('does not treat a line with two blocks as an unclosed fence', () => {
    const { mathBlocks } = meta('$$x$$ and $$y$$\n\nplain text\n\n$$z$$\n');
    // Whatever it does with the crowded line, the standalone block below it
    // must still be found on its own line rather than swallowed.
    const standalone = mathBlocks.find(b => b.formula === 'z');
    expect(standalone).toMatchObject({ startLine: 5, endLine: 5 });
  });
});

describe('buildDocMeta — link references', () => {
  it('collects a reference definition', () => {
    const { references } = meta('[docs]: https://example.com "Docs"\n\nSee [docs].\n');
    expect(Object.keys(references)).toHaveLength(1);
    expect(Object.values(references)[0]).toMatchObject({ href: 'https://example.com' });
  });

  it('reuses the previous references when no definition changed', () => {
    // Collecting them means a full markdown-it parse of the document, which was
    // running on every keystroke. Identity matters too: `TableWidget.eq`
    // compares this object, so a fresh copy re-rendered every table.
    const first = meta('[docs]: https://example.com\n\nSee [docs].\n');
    const second = buildDocMeta(
      EditorState.create({
        doc: '[docs]: https://example.com\n\nSee [docs] now.\n',
        extensions: [markdown({ base: markdownLanguage, extensions: [Table] })],
      }),
      first,
    );

    expect(second.references).toBe(first.references);
  });

  it('recollects when a definition changes', () => {
    const first = meta('[docs]: https://example.com\n');
    const second = buildDocMeta(
      EditorState.create({
        doc: '[docs]: https://elsewhere.test\n',
        extensions: [markdown({ base: markdownLanguage, extensions: [Table] })],
      }),
      first,
    );

    expect(second.references).not.toBe(first.references);
    expect(Object.values(second.references)[0]).toMatchObject({ href: 'https://elsewhere.test' });
  });

  it('shares one object across documents that define nothing', () => {
    expect(meta('plain prose\n').references).toBe(meta('other prose\n').references);
  });
});

describe('buildDocMeta — fenced code', () => {
  it('records every line of a fence', () => {
    const { fencedLines } = meta('text\n```ts\nconst a = 1;\n```\nmore\n');
    expect(fencedLines.has(2)).toBe(true);
    expect(fencedLines.has(3)).toBe(true);
    expect(fencedLines.has(4)).toBe(true);
    expect(fencedLines.has(1)).toBe(false);
    expect(fencedLines.has(5)).toBe(false);
  });
});
