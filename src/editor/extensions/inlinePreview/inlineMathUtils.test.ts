import { describe, expect, it } from 'vitest';
import { findInlineMath } from './inlineMathUtils';

/**
 * Delimiter rules follow Pandoc's, which is what readers actually expect:
 * an opening `$` is not followed by whitespace, and a closing `$` is neither
 * preceded by whitespace nor followed by a digit. Without them, prose about
 * money turns into equations.
 */
describe('findInlineMath', () => {
  it('finds a single formula', () => {
    expect(findInlineMath('$x + y$')).toEqual([
      { from: 0, to: 7, formula: 'x + y' },
    ]);
  });

  it('finds several formulas on one line', () => {
    expect(findInlineMath('$a$ and $b$')).toEqual([
      { from: 0, to: 3, formula: 'a' },
      { from: 8, to: 11, formula: 'b' },
    ]);
  });

  it('leaves prices alone', () => {
    // The reported symptom: this rendered as a formula reading "5 to".
    expect(findInlineMath('It costs $5 to $10')).toEqual([]);
    expect(findInlineMath('between $5 and $10 per seat')).toEqual([]);
  });

  it('ignores an opening delimiter followed by a space', () => {
    expect(findInlineMath('a $ b $ c')).toEqual([]);
  });

  it('ignores an unterminated delimiter', () => {
    expect(findInlineMath('$foo')).toEqual([]);
    expect(findInlineMath('costs $5')).toEqual([]);
  });

  it('ignores block delimiters', () => {
    expect(findInlineMath('$$x$$')).toEqual([]);
  });

  it('ignores escaped delimiters', () => {
    expect(findInlineMath('\\$x\\$')).toEqual([]);
    // An escaped opener must not swallow the rest of the line.
    expect(findInlineMath('\\$5 and $x$')).toEqual([
      { from: 8, to: 11, formula: 'x' },
    ]);
  });

  it('ignores an empty formula', () => {
    expect(findInlineMath('$$')).toEqual([]);
  });

  it('keeps a formula that ends against punctuation', () => {
    expect(findInlineMath('the value $x$.')).toEqual([
      { from: 10, to: 13, formula: 'x' },
    ]);
  });
});
