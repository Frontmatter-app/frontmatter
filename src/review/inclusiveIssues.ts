/**
 * Inclusive-language checking, in process.
 *
 * This is the one thing worth keeping from the Vale style packages. Alex — the
 * tool the old `Alex` package wrapped — is built on `retext-equality`, so using
 * the library directly gets the same checks with none of the machinery: no
 * bundled binary to locate, no style tree staged in a temp directory, no
 * subprocess per scan, no JSON round trip. It also gets *better* data out, because
 * the library reports the replacement list as an array rather than as prose
 * inside a message.
 *
 * It runs synchronously via `runSync`, so it joins the rest of the analysis on
 * one debounce instead of arriving separately and re-rendering the review.
 */

import { unified } from "unified";
import retextEnglish from "retext-english";
import retextEquality from "retext-equality";
import { VFile } from "vfile";
import type { LintIssue } from "./lintTypes";
import { LineIndex, type MaskedMarkdown } from "./markdownMask";

/**
 * Built once.
 *
 * `unified()` resolves and freezes its plugin chain on first use; rebuilding it
 * per keystroke would repeat that for every scan.
 */
const processor = unified().use(retextEnglish).use(retextEquality);

/**
 * Past this, the check is skipped.
 *
 * Unlike the other checks this one parses the document into a syntax tree, and
 * it runs on the same synchronous path that renders the review. On a document
 * of book length that parse is long enough to be felt as a stutter while
 * typing, and a stutter is a worse outcome than a missed suggestion about the
 * word "chairman".
 */
const MAX_LENGTH = 200_000;

interface EqualityMessage {
  ruleId?: string | null;
  actual?: string | null;
  expected?: string[] | null;
  place?: { start?: { offset?: number }; end?: { offset?: number } } | null;
}

/**
 * Writes the message ourselves.
 *
 * `retext-equality`'s own wording is long, repeats the alternatives already
 * carried in `expected`, and contains a typo ("in somes cases") that would end
 * up on screen in a writing app.
 */
function describe(actual: string, expected: string[]): string {
  if (expected.length === 0) return `"${actual}" may read as insensitive.`;
  const shown = expected.slice(0, 3).map((option) => `"${option}"`).join(", ");
  return `"${actual}" may read as insensitive. Consider ${shown}.`;
}

export interface InclusiveConversionOptions {
  lines?: LineIndex;
}

/**
 * @param masked  The length-preserving mask, so offsets are source offsets and
 *                code, URLs and front matter are already blanked out.
 */
export function analyzeInclusiveLanguage(
  source: string,
  masked: MaskedMarkdown,
  options: InclusiveConversionOptions = {},
): LintIssue[] {
  if (!source || source.length > MAX_LENGTH) return [];

  const lines = options.lines ?? new LineIndex(source);
  const file = new VFile(masked.text);

  try {
    processor.runSync(processor.parse(file), file);
  } catch {
    // A parse failure is not worth taking the whole review down for.
    return [];
  }

  const counts = new Map<string, number>();
  const issues: LintIssue[] = [];

  for (const raw of file.messages as unknown as EqualityMessage[]) {
    const from = raw.place?.start?.offset;
    const to = raw.place?.end?.offset;
    if (typeof from !== "number" || typeof to !== "number" || to <= from) continue;
    if (to > source.length) continue;

    const match = source.slice(from, to);
    const expected = (raw.expected ?? []).filter((option): option is string => typeof option === "string");
    const rule = raw.ruleId ?? "inclusive";
    const key = `${rule}|${match.toLowerCase()}`;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);

    issues.push({
      id: `${key}|${nth}`,
      from,
      to,
      line: lines.lineAt(from),
      column: lines.columnAt(from),
      // Advisory by nature: the library's own framing is "potentially
      // insensitive", and a writer may have good reason to keep the word.
      severity: "suggestion",
      category: "inclusive",
      rule,
      message: describe(raw.actual ?? match, expected),
      match,
      replacements: expected,
    });
  }

  return issues;
}
