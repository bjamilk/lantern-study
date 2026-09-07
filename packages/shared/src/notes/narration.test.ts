import {
  NARRATION_MIN_SEGMENT_SECONDS,
  NARRATION_PAGES_PER_BATCH,
  estimateNarrationSeconds,
  formatNarrationDuration,
  narrationDuration,
  narrationSegmentsFromModel,
  planNarrationBatches,
  segmentForPage,
  segmentsForPage,
  type NarrationScriptSegment,
} from './narration';

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

function segment(pageIndex: number, order: number, text: string): NarrationScriptSegment {
  const estimatedSeconds = estimateNarrationSeconds(text);
  return {
    pageIndex,
    order,
    text,
    estimatedSeconds,
    startMs: 0,
    durationMs: estimatedSeconds * 1000,
  };
}

describe('estimateNarrationSeconds', () => {
  it('estimates at the documented pace', () => {
    // 150 words at 150 wpm is a minute.
    expect(estimateNarrationSeconds(words(150))).toBe(60);
  });

  it('gives an empty paragraph no time at all', () => {
    expect(estimateNarrationSeconds('')).toBe(0);
    expect(estimateNarrationSeconds('   ')).toBe(0);
  });

  it('never estimates a real sentence at less than the floor', () => {
    expect(estimateNarrationSeconds('Stop.')).toBe(NARRATION_MIN_SEGMENT_SECONDS);
  });
});

describe('narrationDuration', () => {
  it('adds up a script', () => {
    const script = {
      sourceId: 'att-1',
      version: 1,
      pageCount: 2,
      segments: [segment(0, 0, words(150)), segment(1, 1, words(75))],
    };
    expect(narrationDuration(script)).toBe(90);
  });

  it('takes a bare segment list, so a player can price what is left', () => {
    const segments = [segment(0, 0, words(150)), segment(1, 1, words(150))];
    expect(narrationDuration(segments.slice(1))).toBe(60);
  });

  it('re-estimates a segment whose stored length is missing or nonsense', () => {
    const broken = [
      { pageIndex: 0, order: 0, text: words(150), estimatedSeconds: Number.NaN },
    ] as unknown as NarrationScriptSegment[];
    expect(narrationDuration(broken)).toBe(60);
  });

  it('answers zero for nothing', () => {
    expect(narrationDuration(null)).toBe(0);
    expect(narrationDuration(undefined)).toBe(0);
    expect(narrationDuration([])).toBe(0);
  });
});

describe('formatNarrationDuration', () => {
  it('prints seconds under a minute and minutes above it', () => {
    expect(formatNarrationDuration(40)).toBe('About 40 sec');
    expect(formatNarrationDuration(360)).toBe('About 6 min');
  });
});

describe('segmentForPage', () => {
  const script = {
    sourceId: 'att-1',
    version: 1,
    pageCount: 3,
    segments: [segment(0, 0, 'Page one.'), segment(2, 1, 'Page three.')],
  };

  it('finds the segment for a page', () => {
    expect(segmentForPage(script, 2)?.text).toBe('Page three.');
  });

  it('returns null for a page with nothing to say, rather than a neighbour', () => {
    expect(segmentForPage(script, 1)).toBeNull();
  });

  it('returns the first segment when a page has several', () => {
    const split = [segment(4, 3, 'Second half.'), segment(4, 2, 'First half.')];
    expect(segmentForPage(split, 4)?.text).toBe('First half.');
    expect(segmentsForPage(split, 4).map((s) => s.order)).toEqual([2, 3]);
  });
});

describe('planNarrationBatches', () => {
  const page = (pageIndex: number, text: string) => ({ pageIndex, text });

  it('batches narratable pages four at a time by default', () => {
    const pages = Array.from({ length: 9 }, (_, i) => page(i, `Page ${i} has real content here.`));
    const plan = planNarrationBatches(pages);
    expect(NARRATION_PAGES_PER_BATCH).toBe(4);
    expect(plan.batches.map((b) => b.pages.length)).toEqual([4, 4, 1]);
    expect(plan.batches.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('keeps blank pages out of the model calls but still counts them', () => {
    const plan = planNarrationBatches([
      page(0, 'A page with enough text to narrate.'),
      page(1, '   '),
      page(2, '7'),
      page(3, 'Another page with enough text to narrate.'),
    ]);
    expect(plan.pageIndexes).toEqual([0, 1, 2, 3]);
    expect(plan.blankPageIndexes).toEqual([1, 2]);
    expect(plan.batches[0].pages.map((p) => p.pageIndex)).toEqual([0, 3]);
  });

  it('sorts pages that arrive out of order', () => {
    const plan = planNarrationBatches([
      page(2, 'Third page content here.'),
      page(0, 'First page content here.'),
    ]);
    expect(plan.batches[0].pages.map((p) => p.pageIndex)).toEqual([0, 2]);
  });

  it('stops at the page ceiling and says that it did', () => {
    const pages = Array.from({ length: 6 }, (_, i) => page(i, `Page ${i} content that is real.`));
    const plan = planNarrationBatches(pages, { maxPages: 4 });
    expect(plan.pageIndexes).toEqual([0, 1, 2, 3]);
    expect(plan.truncated).toBe(true);
  });

  it('plans no calls at all for a document with no readable text', () => {
    const plan = planNarrationBatches([page(0, ''), page(1, ' ')]);
    expect(plan.batches).toEqual([]);
    expect(plan.blankPageIndexes).toEqual([0, 1]);
  });
});

describe('narrationSegmentsFromModel', () => {
  it('drops a page the document does not have', () => {
    const segments = narrationSegmentsFromModel(
      [
        { pageIndex: 0, text: 'Real page.' },
        { pageIndex: 9, text: 'A page that was never sent.' },
      ],
      [0, 1]
    );
    expect(segments.map((s) => s.pageIndex)).toEqual([0]);
  });

  it('re-derives order so a shuffled reply still plays front to back', () => {
    const segments = narrationSegmentsFromModel(
      [
        { pageIndex: 2, text: 'Third.' },
        { pageIndex: 0, text: 'First.' },
      ],
      [0, 1, 2]
    );
    expect(segments.map((s) => s.pageIndex)).toEqual([0, 2]);
    expect(segments.map((s) => s.order)).toEqual([0, 1]);
  });

  it('drops empty text instead of storing a silent segment', () => {
    expect(narrationSegmentsFromModel([{ pageIndex: 0, text: '   ' }], [0])).toEqual([]);
  });

  it('keeps only the first reply for a repeated page', () => {
    const segments = narrationSegmentsFromModel(
      [
        { pageIndex: 1, text: 'Kept.' },
        { pageIndex: 1, text: 'Duplicate.' },
      ],
      [0, 1]
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('Kept.');
  });

  it('estimates each segment as it stores it', () => {
    const [only] = narrationSegmentsFromModel([{ pageIndex: 0, text: words(150) }], [0]);
    expect(only.estimatedSeconds).toBe(60);
    expect(only.durationMs).toBe(60_000);
  });

  it('lays the estimates end to end so a client can print a length up front', () => {
    const segments = narrationSegmentsFromModel(
      [
        { pageIndex: 0, text: words(150) },
        { pageIndex: 1, text: words(75) },
      ],
      [0, 1]
    );
    expect(segments.map((s) => s.startMs)).toEqual([0, 60_000]);
    expect(narrationDuration(segments)).toBe(90);
  });
});
