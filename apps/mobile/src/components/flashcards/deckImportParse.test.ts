import {
  MAX_IMPORT_CARDS,
  describeImport,
  parseDeckImport,
  suggestDeckName,
} from './deckImportParse';

/** A real-shaped Anki text export: directives, HTML, a tags column. */
function ankiExport(rows: number): string {
  const lines = ['#separator:tab', '#html:true'];
  for (let i = 1; i <= rows; i++) {
    lines.push(`Term ${i}\t<b>Definition ${i}</b>`);
  }
  return lines.join('\n');
}

describe('parseDeckImport — Anki text export', () => {
  it('reads a 200-card export with no server and no loss', () => {
    const parsed = parseDeckImport(ankiExport(200), 'PHA 301 export.txt');
    expect(parsed.format).toBe('anki-txt');
    expect(parsed.cards).toHaveLength(200);
    expect(parsed.skipped).toBe(0);
    expect(parsed.cards[0]).toMatchObject({
      type: 'BASIC',
      front: 'Term 1',
      back: 'Definition 1',
    });
    expect(parsed.cards[199]!.back).toBe('Definition 200');
    expect(parsed.suggestedName).toBe('PHA 301 export');
    expect(parsed.cards.length).toBeLessThanOrEqual(MAX_IMPORT_CARDS);
    expect(describeImport(parsed)).toBe('200 cards found');
  });

  it('strips the HTML Anki wraps fields in', () => {
    const parsed = parseDeckImport('#separator:tab\n#html:true\nATP\t<div>Adenosine triphosphate</div>');
    expect(parsed.cards[0]!.back).toBe('Adenosine triphosphate');
  });

  it('keeps a cloze row as a cloze card', () => {
    const parsed = parseDeckImport(
      '#separator:tab\nPhotosynthesis makes {{c1::glucose}}.\tglucose'
    );
    expect(parsed.cards[0]!.type).toBe('CLOZE');
    expect(parsed.cards[0]!.clozeText).toContain('{{c1::glucose}}');
  });

  it('counts a one-sided row as skipped rather than importing half a card', () => {
    const parsed = parseDeckImport('#separator:tab\nTerm A\tBack A\nOrphan row');
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(describeImport(parsed)).toBe('1 card found · 1 line skipped (no back)');
  });
});

describe('parseDeckImport — Quizlet and CSV', () => {
  it('reads a Quizlet tab export', () => {
    const parsed = parseDeckImport('mitochondrion\tthe powerhouse\nribosome\tmakes protein');
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
  });

  it('reads a CSV export, quoted fields and all, without counting the header as a card', () => {
    const parsed = parseDeckImport('front,back\n"Krebs, citric acid cycle","Runs in the matrix"');
    expect(parsed.format).toBe('csv');
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]).toMatchObject({
      front: 'Krebs, citric acid cycle',
      back: 'Runs in the matrix',
    });
    expect(parsed.skipped).toBe(0);
  });
});

describe('parseDeckImport — nothing usable', () => {
  it('says what it read instead of importing empty cards', () => {
    const parsed = parseDeckImport('just\nsome\nprose lines');
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.skipped).toBe(3);
    expect(describeImport(parsed)).toContain('no two-sided cards');
  });

  it('is empty, not an error, for empty input', () => {
    const parsed = parseDeckImport('   ');
    expect(parsed.cards).toHaveLength(0);
    expect(describeImport(parsed)).toBe('Nothing to import yet.');
  });
});

describe('suggestDeckName', () => {
  it('cleans a file name up', () => {
    expect(suggestDeckName('/tmp/BIO_101-cards.txt')).toBe('BIO 101 cards');
  });
  it('falls back when there is no file', () => {
    expect(suggestDeckName(undefined)).toBe('Imported cards');
  });
});
