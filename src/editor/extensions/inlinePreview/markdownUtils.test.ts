import { describe, expect, it } from 'vitest';
import { isMarkdownTableRow, isMarkdownTableSeparator, parseFenceInfo, stripInlineAttrs } from './markdownUtils';

describe('isMarkdownTableSeparator', () => {
  it('accepts the usual shapes', () => {
    expect(isMarkdownTableSeparator('|---|---|')).toBe(true);
    expect(isMarkdownTableSeparator('| :--- | ---: |')).toBe(true);
    expect(isMarkdownTableSeparator('---|---')).toBe(true);
  });

  it('rejects prose', () => {
    expect(isMarkdownTableSeparator('a | b')).toBe(false);
    expect(isMarkdownTableSeparator('---')).toBe(false);
  });
});

describe('isMarkdownTableRow', () => {
  it('accepts cell rows', () => {
    expect(isMarkdownTableRow('| a | b |')).toBe(true);
    expect(isMarkdownTableRow('a | b')).toBe(true);
  });

  it('rejects blank lines', () => {
    expect(isMarkdownTableRow('')).toBe(false);
    expect(isMarkdownTableRow('   ')).toBe(false);
  });

  it('rejects prose with no pipe', () => {
    expect(isMarkdownTableRow('just a sentence')).toBe(false);
  });

  it('does not count a pipe inside inline code', () => {
    // The reported symptom: this line was swallowed into the table above it.
    expect(isMarkdownTableRow('Run `git log | head` to see.')).toBe(false);
    expect(isMarkdownTableRow('Use `a | b` or `c | d`.')).toBe(false);
  });

  it('still accepts a row that has code in one cell', () => {
    expect(isMarkdownTableRow('| `git log | head` | prints the log |')).toBe(true);
  });

  it('stops the table at a new block structure', () => {
    // GFM breaks a table at the start of another block, even with a pipe on it.
    expect(isMarkdownTableRow('## Heading | with a pipe')).toBe(false);
    expect(isMarkdownTableRow('> quoted | text')).toBe(false);
    expect(isMarkdownTableRow('```sh')).toBe(false);
    expect(isMarkdownTableRow('---')).toBe(false);
  });
});

describe('parseFenceInfo', () => {
  it('reads the language', () => {
    expect(parseFenceInfo('```ts').language).toBe('ts');
    expect(parseFenceInfo('```Mermaid').language).toBe('mermaid');
    expect(parseFenceInfo('```').language).toBe('');
  });
});

describe('stripInlineAttrs', () => {
  it('drops a trailing attribute block', () => {
    expect(stripInlineAttrs('content {.class}')).toBe('content');
    expect(stripInlineAttrs('content')).toBe('content');
  });
});
