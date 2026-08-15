/**
 * Locates `$…$` spans on a single line.
 *
 * The delimiter rules are Pandoc's, and they are the whole point of this
 * function: an opening `$` must not be followed by whitespace, and a closing
 * `$` must be neither preceded by whitespace nor followed by a digit. Without
 * them `It costs $5 to $10` rendered as a formula reading "5 to" — prose about
 * money is far more common in these documents than inline maths is.
 */
export function findInlineMath(text: string) {
  const ranges: Array<{ from: number; to: number; formula: string }> = [];
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || isEscaped(text, i)) continue;
    if (text[i + 1] === '$' || text[i - 1] === '$') continue;

    if (start === -1) {
      if (isOpener(text, i)) start = i;
      continue;
    }

    if (!isCloser(text, i)) continue;

    const formula = text.slice(start + 1, i).trim();
    if (formula) ranges.push({ from: start, to: i + 1, formula });
    start = -1;
  }

  return ranges;
}

/** An opening delimiter is attached to the formula, not floating in prose. */
function isOpener(text: string, index: number) {
  const next = text[index + 1];
  return next !== undefined && !/\s/.test(next);
}

/**
 * A closing delimiter is attached to the formula, and is not the start of a
 * price — `$5 and $10` has two openers and no closer, which is what we want.
 */
function isCloser(text: string, index: number) {
  const prev = text[index - 1];
  const next = text[index + 1];
  if (prev === undefined || /\s/.test(prev)) return false;
  return next === undefined || !/\d/.test(next);
}

function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}
