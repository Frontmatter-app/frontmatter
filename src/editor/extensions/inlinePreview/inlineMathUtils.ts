export function findInlineMath(text: string) {
  const ranges: Array<{ from: number; to: number; formula: string }> = [];
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || isEscaped(text, i)) continue;
    if (text[i + 1] === '$' || text[i - 1] === '$') continue;

    if (start === -1) {
      start = i;
      continue;
    }

    const formula = text.slice(start + 1, i).trim();
    if (formula) ranges.push({ from: start, to: i + 1, formula });
    start = -1;
  }

  return ranges;
}

function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}
