import {
  ankiTxtToImportData,
  detectDeckImportFormat,
  importedCardsToFsrs,
  parseDeckImport,
  quizletToImportData,
} from './deckFormats';
import { calculateFsrsData, createInitialFsrsData } from './fsrs';
import { isNewFlashcard, isCardDueForReview } from '../settings/studySession';

/** A real-shaped Anki "Notes in Plain Text" export: header, HTML, tags column. */
function ankiExport(rows: number): string {
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  for (let i = 1; i <= rows; i++) {
    lines.push(
      [
        `<div>Term ${i}</div>`,
        `<div>Definition ${i}&nbsp;— with <b>markup</b></div>`,
        i % 10 === 0 ? 'bio unit1' : 'bio',
      ].join('\t')
    );
  }
  return lines.join('\n');
}

describe('Anki .txt import (offline, 200+ rows)', () => {
  const text = ankiExport(200);

  it('imports every row of a 200-card export', () => {
    const payload = ankiTxtToImportData(text, { deckName: 'BIO 101' });
    expect(payload.deck.name).toBe('BIO 101');
    expect(payload.flashcards).toHaveLength(200);
  });

  it('strips the note HTML rather than showing tags in study', () => {
    const [first] = ankiTxtToImportData(text).flashcards;
    expect(first).toMatchObject({
      type: 'BASIC',
      front: 'Term 1',
      back: 'Definition 1 — with markup',
    });
  });

  it('reads the declared tags column and splits Anki space-separated tags', () => {
    const cards = ankiTxtToImportData(text).flashcards;
    expect(cards[0]?.tags).toEqual(['bio']);
    expect(cards[9]?.tags).toEqual(['bio', 'unit1']);
  });

  it('keeps a cloze note as a cloze card', () => {
    const payload = ankiTxtToImportData(
      [
        '#separator:tab',
        '#html:false',
        'Photosynthesis stores energy as {{c1::glucose}}.\tglucose\tbio',
      ].join('\n')
    );
    expect(payload.flashcards).toEqual([
      {
        type: 'CLOZE',
        clozeText: 'Photosynthesis stores energy as {{c1::glucose}}.',
        tags: ['bio'],
      },
    ]);
  });

  it('keeps a quoted field containing a newline as one card', () => {
    const payload = ankiTxtToImportData(
      ['#separator:tab', 'Front A\t"Line 1\nLine 2"\ttag', 'Front B\tBack B\ttag'].join('\n')
    );
    expect(payload.flashcards).toHaveLength(2);
    expect(payload.flashcards[0]?.back).toBe('Line 1\nLine 2');
  });

  it('skips the deck and notetype columns Anki can prepend', () => {
    const payload = ankiTxtToImportData(
      [
        '#separator:tab',
        '#notetype column:1',
        '#deck column:2',
        '#tags column:5',
        'Basic\tBIO 101::Week 1\tOsmosis\tWater movement\tbio',
      ].join('\n')
    );
    expect(payload.flashcards[0]).toEqual({
      type: 'BASIC',
      front: 'Osmosis',
      back: 'Water movement',
      tags: ['bio'],
    });
  });

  it('handles a headerless two-column export', () => {
    const payload = ankiTxtToImportData('Osmosis\tWater movement\nMitosis\tCell division');
    expect(payload.flashcards).toHaveLength(2);
    expect(payload.flashcards[1]).toMatchObject({ front: 'Mitosis', back: 'Cell division' });
  });

  it('drops a one-sided row instead of letting the server reject the save', () => {
    const payload = ankiTxtToImportData('#separator:tab\nOsmosis\t\nMitosis\tCell division');
    expect(payload.flashcards).toHaveLength(1);
  });
});

describe('Quizlet import with custom separators', () => {
  it('splits term/definition and rows on the separators the student chose', () => {
    const text = 'Osmosis - water movement;;Mitosis - cell division;;Meiosis - gamete formation';
    const payload = quizletToImportData(text, {
      termSeparator: ' - ',
      rowSeparator: ';;',
      deckName: 'Quizlet set',
    });
    expect(payload.deck.name).toBe('Quizlet set');
    expect(payload.flashcards).toHaveLength(3);
    expect(payload.flashcards[0]).toMatchObject({ front: 'Osmosis', back: 'water movement' });
  });

  it('splits at the first separator only, so a definition may contain it', () => {
    const payload = quizletToImportData('Osmosis - water moves - down a gradient', {
      termSeparator: ' - ',
    });
    expect(payload.flashcards[0]).toMatchObject({
      front: 'Osmosis',
      back: 'water moves - down a gradient',
    });
  });

  it('handles a 200-row tab/newline set', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Term ${i + 1}\tDefinition ${i + 1}`);
    const payload = quizletToImportData(rows.join('\n'));
    expect(payload.flashcards).toHaveLength(200);
  });
});

describe('format detection', () => {
  it('recognises Anki metadata, tabs, commas and plain pairs', () => {
    expect(detectDeckImportFormat('#separator:tab\nA\tB')).toBe('anki-txt');
    expect(detectDeckImportFormat('A\tB\nC\tD')).toBe('anki-txt');
    expect(detectDeckImportFormat('front,back\nA,B')).toBe('csv');
    expect(detectDeckImportFormat('Osmosis - water movement')).toBe('quizlet');
  });

  it('routes through one door and reports which format it used', () => {
    const result = parseDeckImport(ankiExport(200), { deckName: 'BIO 101' });
    expect(result.format).toBe('anki-txt');
    expect(result.flashcards).toHaveLength(200);
  });
});

describe('imported cards schedule under FSRS', () => {
  const imported = importedCardsToFsrs(
    ankiTxtToImportData(ankiExport(200)).flashcards.map((card, i) => ({ id: `c${i}`, ...card }))
  );

  it('gives every card the FSRS starting state', () => {
    expect(imported).toHaveLength(200);
    for (const card of imported) {
      expect(card.srsData).toEqual(createInitialFsrsData());
      expect(card.srsData.scheduler).toBe('fsrs');
      expect(card.srsData.stability).toBeGreaterThan(0);
      expect(card.srsData.difficulty).toBeGreaterThan(0);
    }
  });

  it('leaves them new, so 200 cards do not land in one review queue', () => {
    expect(imported.every(isNewFlashcard)).toBe(true);
    // New still means studiable now — the new-card budget decides how many.
    expect(imported.every(isCardDueForReview)).toBe(true);
  });

  it('schedules the first review exactly like a freshly made card', () => {
    const seeded = imported[0]!.srsData;
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      expect(calculateFsrsData(seeded, rating).interval).toBe(
        calculateFsrsData(undefined, rating).interval
      );
    }
    expect(calculateFsrsData(seeded, 'again').interval).toBe(1);
    expect(calculateFsrsData(seeded, 'hard').interval).toBe(1);
    expect(calculateFsrsData(seeded, 'good').interval).toBe(3);
    expect(calculateFsrsData(seeded, 'easy').interval).toBe(5);
  });

  it('puts a real date on the card once it has been reviewed', () => {
    const after = calculateFsrsData(imported[0]!.srsData, 'good');
    expect(Number.isNaN(new Date(after.nextReviewDate).getTime())).toBe(false);
    expect(isNewFlashcard({ id: 'x', srsData: after })).toBe(false);
  });

  it('does not disturb a lapsed card (repetitions 0, but reviewed)', () => {
    const lapsed = calculateFsrsData(calculateFsrsData(undefined, 'good'), 'again');
    expect(lapsed.repetitions).toBe(0);
    expect(isNewFlashcard({ id: 'x', srsData: lapsed })).toBe(false);
    // Still scheduled by the review branch, not reset to a new card.
    expect(lapsed.stability).toBeLessThan(createInitialFsrsData().stability!);
  });
});
