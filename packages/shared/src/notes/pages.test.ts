import { pageHeadings, walkthroughCheckpoint, type PageLike } from './pages';

function page(pageIndex: number, text: string): PageLike {
  return { pageIndex, text, charCount: text.length };
}

describe('pageHeadings', () => {
  it('titles a page from a markdown heading', () => {
    const [row] = pageHeadings([page(0, '# Enzyme kinetics\n\nEnzymes lower activation energy.')]);
    expect(row.title).toBe('Enzyme kinetics');
    expect(row.isDerived).toBe(true);
    expect(row.hasText).toBe(true);
  });

  it('titles a page from an outline number', () => {
    const [row] = pageHeadings([
      page(0, '3.2 Michaelis-Menten\nThe rate of reaction depends on substrate concentration.'),
    ]);
    expect(row.title).toBe('3.2 Michaelis-Menten');
    expect(row.isDerived).toBe(true);
  });

  it('treats an ALL CAPS slide title as a heading', () => {
    const [row] = pageHeadings([page(0, 'CELL RESPIRATION,\nglycolysis happens in the cytosol.')]);
    expect(row.title).toBe('CELL RESPIRATION,');
    expect(row.isDerived).toBe(true);
  });

  it('skips page furniture before looking for a heading', () => {
    const [row] = pageHeadings([page(0, '12\nPage 12 of 40\nOxidative phosphorylation')]);
    expect(row.title).toBe('Oxidative phosphorylation');
    expect(row.isDerived).toBe(true);
  });

  it('falls back to the opening sentence and marks it as a guess', () => {
    const long =
      'The mitochondrion is the organelle where the majority of cellular ATP is produced in eukaryotes, which matters here. A second sentence follows.';
    const [row] = pageHeadings([page(0, long)]);
    expect(row.isDerived).toBe(false);
    expect(row.title.endsWith('…')).toBe(true);
    expect(row.title.length).toBeLessThanOrEqual(80);
  });

  it('falls back to "Page N" for an empty page and reports no text', () => {
    const [row] = pageHeadings([page(3, '   \n\n  ')]);
    expect(row.title).toBe('Page 4');
    expect(row.hasText).toBe(false);
    expect(row.isDerived).toBe(false);
  });

  it('reports hasText false for a page with only a few characters', () => {
    const [row] = pageHeadings([page(0, 'Fig 1')]);
    expect(row.hasText).toBe(false);
    // It still gets a usable label rather than nothing.
    expect(row.title).toBe('Fig 1');
  });

  it('sorts rows by page index regardless of input order', () => {
    const rows = pageHeadings([page(2, '# Third'), page(0, '# First'), page(1, '# Second')]);
    expect(rows.map((r) => r.pageIndex)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('handles an empty list and missing text without throwing', () => {
    expect(pageHeadings([])).toEqual([]);
    const [row] = pageHeadings([{ pageIndex: 0, text: null, charCount: null }]);
    expect(row).toEqual({ pageIndex: 0, title: 'Page 1', hasText: false, isDerived: false });
  });
});

describe('walkthroughCheckpoint', () => {
  it('offers a check after every N pages, counting from page 1', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => walkthroughCheckpoint(i, 3))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('offers a check on every page when N is 1', () => {
    expect(walkthroughCheckpoint(0, 1)).toBe(true);
    expect(walkthroughCheckpoint(7, 1)).toBe(true);
  });

  it('never offers a check when checks are turned off', () => {
    expect(walkthroughCheckpoint(2, 0)).toBe(false);
    expect(walkthroughCheckpoint(2, -3)).toBe(false);
    expect(walkthroughCheckpoint(2, Number.NaN)).toBe(false);
  });

  it('rejects a nonsense page index rather than guessing', () => {
    expect(walkthroughCheckpoint(-1, 3)).toBe(false);
    expect(walkthroughCheckpoint(Number.NaN, 3)).toBe(false);
  });

  it('floors a fractional interval', () => {
    expect(walkthroughCheckpoint(1, 2.7)).toBe(true);
    expect(walkthroughCheckpoint(2, 2.7)).toBe(false);
  });
});
