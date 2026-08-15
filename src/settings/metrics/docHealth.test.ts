import { describe, expect, it } from 'vitest';
import { analyzeDocumentHealth, summarizeDocHealth, worstOffenders } from './docHealth';
import { GRADE_TARGET, STALE_AFTER_DAYS } from './metricsTypes';
import { gradeDefects, gradeStaleness, gradeReadability } from './metricsStatus';
import type { DocumentMeta } from '../../types';

const NOW = new Date(2026, 7, 15);

function makeDoc(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: 'doc-1',
    title: 'Getting started',
    content: '# Getting started\n\nInstall the package and run it.\n',
    stage: 'write',
    focus_mode: false,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-14T00:00:00.000Z',
    word_count: 8,
    ...overrides,
  };
}

describe('analyzeDocumentHealth', () => {
  it('flags a link with no target', () => {
    const doc = makeDoc({ content: 'See the [reference]() for details.' });
    expect(analyzeDocumentHealth(doc, NOW).brokenLinks).toBe(1);
  });

  it('flags placeholder and localhost targets', () => {
    const doc = makeDoc({
      content: '[a](http://localhost:3000)\n\n[b](TODO)\n\n[c](#)\n',
    });
    expect(analyzeDocumentHealth(doc, NOW).brokenLinks).toBe(3);
  });

  it('accepts a real link', () => {
    const doc = makeDoc({ content: 'See [the docs](https://example.com/guide).' });
    expect(analyzeDocumentHealth(doc, NOW).brokenLinks).toBe(0);
  });

  it('flags an image with no alt text but not one with it', () => {
    const doc = makeDoc({ content: '![](a.png)\n\n![A labelled diagram](b.png)\n' });
    expect(analyzeDocumentHealth(doc, NOW).missingAltText).toBe(1);
  });

  it('flags a heading with nothing under it', () => {
    const doc = makeDoc({ content: '# One\n\n## Empty\n\n## Full\n\nSome words here.\n' });
    expect(analyzeDocumentHealth(doc, NOW).emptySections).toBeGreaterThan(0);
  });

  it('flags an unclosed code fence', () => {
    const doc = makeDoc({ content: '# Title\n\n```js\nconst a = 1;\n' });
    expect(analyzeDocumentHealth(doc, NOW).unclosedFences).toBe(1);
  });

  it('does not flag a closed code fence', () => {
    const doc = makeDoc({ content: '# Title\n\n```js\nconst a = 1;\n```\n' });
    expect(analyzeDocumentHealth(doc, NOW).unclosedFences).toBe(0);
  });

  it('marks a document stale only past the threshold', () => {
    const fresh = makeDoc({ updated_at: new Date(2026, 7, 10).toISOString() });
    expect(analyzeDocumentHealth(fresh, NOW).isStale).toBe(false);

    const old = new Date(NOW);
    old.setDate(old.getDate() - (STALE_AFTER_DAYS + 5));
    const stale = makeDoc({ updated_at: old.toISOString() });
    const report = analyzeDocumentHealth(stale, NOW);
    expect(report.isStale).toBe(true);
    expect(report.daysSinceUpdate).toBeGreaterThanOrEqual(STALE_AFTER_DAYS);
  });

  it('detects the sections a reference doc is expected to carry', () => {
    const doc = makeDoc({
      content: '# Tool\n\n## Installation\n\nRun it.\n\n## Usage\n\nUse it.\n',
    });
    const { completeness } = analyzeDocumentHealth(doc, NOW);
    expect(completeness.installation).toBe(true);
    expect(completeness.usage).toBe(true);
    expect(completeness.license).toBe(false);
  });

  it('counts every defect it found in the defect total', () => {
    const doc = makeDoc({ content: '# T\n\n![](a.png)\n\n[x]()\n\n## Empty\n' });
    const report = analyzeDocumentHealth(doc, NOW);
    expect(report.defects).toBeGreaterThanOrEqual(
      report.brokenLinks + report.missingAltText + report.emptySections,
    );
  });

  it('survives an empty document', () => {
    const report = analyzeDocumentHealth(makeDoc({ content: '', word_count: 0 }), NOW);
    expect(report.words).toBe(0);
    expect(report.defects).toBe(0);
  });

  it('does not credit a blank page with the words it used to have', () => {
    // A local document that has been emptied is empty, whatever the stored
    // count still says.
    const report = analyzeDocumentHealth(makeDoc({ content: '', word_count: 800 }), NOW);
    expect(report.words).toBe(0);
  });

  it('falls back to the stored count for a cloud document not fetched locally', () => {
    const report = analyzeDocumentHealth(
      makeDoc({ content: '', word_count: 800, is_cloud: true }),
      NOW,
    );
    expect(report.words).toBe(800);
  });
});

describe('summarizeDocHealth', () => {
  it('reports nothing for an empty set', () => {
    expect(summarizeDocHealth([]).documents).toBe(0);
  });

  /**
   * A workspace of stubs must not read as a clean bill of health. Empty
   * documents have no defects to find, so counting them would let a set of
   * forty placeholders report a perfect median grade.
   */
  it('excludes empty documents from the roll-up', () => {
    const reports = [
      analyzeDocumentHealth(makeDoc({ id: 'a', content: '', word_count: 0 }), NOW),
      analyzeDocumentHealth(makeDoc({ id: 'b', content: '', word_count: 0 }), NOW),
      analyzeDocumentHealth(makeDoc({ id: 'c', content: 'Real content here, several words.' }), NOW),
    ];
    expect(summarizeDocHealth(reports).documents).toBe(1);
  });

  it('sums defects across documents', () => {
    const reports = [
      analyzeDocumentHealth(makeDoc({ id: 'a', content: 'Text [x]() more words.' }), NOW),
      analyzeDocumentHealth(makeDoc({ id: 'b', content: 'Text [y]() more words.' }), NOW),
    ];
    expect(summarizeDocHealth(reports).brokenLinks).toBe(2);
  });

  it('carries the review backlog through', () => {
    const reports = [analyzeDocumentHealth(makeDoc({ content: 'Words go here.' }), NOW)];
    const snapshot = summarizeDocHealth(reports, { open: 4, resolved: 9, oldestOpenDays: 23 });
    expect(snapshot.reviewOpen).toBe(4);
    expect(snapshot.reviewResolved).toBe(9);
    expect(snapshot.oldestOpenReviewDays).toBe(23);
  });

  it('reports the backlog even when there are no documents to score', () => {
    const snapshot = summarizeDocHealth([], { open: 2, resolved: 1, oldestOpenDays: 5 });
    expect(snapshot.reviewOpen).toBe(2);
    expect(snapshot.documents).toBe(0);
  });

  it('takes a median grade that one outlier cannot drag', () => {
    const reports = [
      { ...analyzeDocumentHealth(makeDoc({ id: 'a' }), NOW), readabilityGrade: 5, words: 10 },
      { ...analyzeDocumentHealth(makeDoc({ id: 'b' }), NOW), readabilityGrade: 6, words: 10 },
      { ...analyzeDocumentHealth(makeDoc({ id: 'c' }), NOW), readabilityGrade: 40, words: 10 },
    ];
    expect(summarizeDocHealth(reports).medianGrade).toBe(6);
  });

  it('counts documents over the grade target', () => {
    const reports = [
      { ...analyzeDocumentHealth(makeDoc({ id: 'a' }), NOW), readabilityGrade: GRADE_TARGET + 1, words: 10 },
      { ...analyzeDocumentHealth(makeDoc({ id: 'b' }), NOW), readabilityGrade: GRADE_TARGET, words: 10 },
    ];
    expect(summarizeDocHealth(reports).docsOverGradeTarget).toBe(1);
  });

  it('counts each undefined acronym once across the whole set', () => {
    const base = analyzeDocumentHealth(makeDoc({ content: 'Words here now.' }), NOW);
    const reports = [
      { ...base, id: 'a', undefinedAcronyms: ['API', 'SDK'], words: 10 },
      { ...base, id: 'b', undefinedAcronyms: ['API', 'CLI'], words: 10 },
    ];
    expect(summarizeDocHealth(reports).undefinedAcronyms).toBe(3);
  });
});

describe('worstOffenders', () => {
  it('ranks by defect count, then by staleness', () => {
    const base = analyzeDocumentHealth(makeDoc({ content: 'Some words here.' }), NOW);
    const reports = [
      { ...base, id: 'low', title: 'Low', defects: 1, daysSinceUpdate: 1, words: 10 },
      { ...base, id: 'high', title: 'High', defects: 9, daysSinceUpdate: 1, words: 10 },
      { ...base, id: 'mid', title: 'Mid', defects: 4, daysSinceUpdate: 1, words: 10 },
    ];
    expect(worstOffenders(reports).map((r) => r.id)).toEqual(['high', 'mid', 'low']);
  });

  it('leaves out clean, fresh documents', () => {
    const base = analyzeDocumentHealth(makeDoc({ content: 'Some words here.' }), NOW);
    const reports = [{ ...base, id: 'clean', defects: 0, isStale: false, words: 10 }];
    expect(worstOffenders(reports)).toHaveLength(0);
  });

  it('keeps a clean but stale document, since staleness is the defect', () => {
    const base = analyzeDocumentHealth(makeDoc({ content: 'Some words here.' }), NOW);
    const reports = [{ ...base, id: 'stale', defects: 0, isStale: true, words: 10 }];
    expect(worstOffenders(reports)).toHaveLength(1);
  });

  it('caps the list', () => {
    const base = analyzeDocumentHealth(makeDoc({ content: 'Some words here.' }), NOW);
    const reports = Array.from({ length: 20 }, (_, i) => ({
      ...base,
      id: `d${i}`,
      defects: i + 1,
      words: 10,
    }));
    expect(worstOffenders(reports, 5)).toHaveLength(5);
  });
});

describe('status grading', () => {
  it('treats zero defects as healthy and a pile as critical', () => {
    expect(gradeDefects(0)).toBe('good');
    expect(gradeDefects(1)).toBe('warning');
    expect(gradeDefects(50)).toBe('critical');
  });

  it('grades staleness by share of the set, not raw count', () => {
    expect(gradeStaleness(0, 10)).toBe('good');
    expect(gradeStaleness(1, 100)).toBe('warning');
    expect(gradeStaleness(5, 10)).toBe('critical');
  });

  it('has no opinion about an empty set', () => {
    expect(gradeStaleness(0, 0)).toBe('good');
  });

  it('grades readability against the target', () => {
    expect(gradeReadability(8, GRADE_TARGET)).toBe('good');
    expect(gradeReadability(GRADE_TARGET + 1, GRADE_TARGET)).toBe('warning');
    expect(gradeReadability(GRADE_TARGET + 9, GRADE_TARGET)).toBe('critical');
  });

  it('does not grade a document set with no measurable prose', () => {
    expect(gradeReadability(0, GRADE_TARGET)).toBe('good');
  });
});
