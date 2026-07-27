import { csvToImportData, deckToCsv, splitCsvRecords } from './deckFormats';

describe('deckFormats CSV integrity', () => {
  it('round-trips a single deck without inventing extra cards', () => {
    const payload = {
      deck: { name: 'Bio 101' },
      flashcards: [
        { type: 'BASIC', front: 'Mitochondria', back: 'Powerhouse', tags: ['cell'] },
        { type: 'BASIC', front: 'Has, comma', back: 'Quoted "value"', tags: [] },
      ],
    };

    const csv = deckToCsv(payload);
    const imported = csvToImportData(csv, 'Bio 101');

    expect(imported.deck.name).toBe('Bio 101');
    expect(imported.flashcards).toHaveLength(2);
    expect(imported.flashcards[0]).toMatchObject({
      type: 'BASIC',
      front: 'Mitochondria',
      back: 'Powerhouse',
      tags: ['cell'],
    });
    expect(imported.flashcards[1]).toMatchObject({
      front: 'Has, comma',
      back: 'Quoted "value"',
    });
  });

  it('keeps multiline quoted fields as one card', () => {
    const csv = [
      'front,back,tags,image_url',
      '"Line 1\nLine 2","Answer",,',
      'Simple,Back,,',
    ].join('\n');

    expect(splitCsvRecords(csv)).toHaveLength(3);
    const imported = csvToImportData(csv, 'Notes');
    expect(imported.flashcards).toHaveLength(2);
    expect(imported.flashcards[0]?.front).toBe('Line 1\nLine 2');
    expect(imported.flashcards[1]?.front).toBe('Simple');
  });

  it('never treats CSV as multi-deck — always one deck payload', () => {
    const imported = csvToImportData('front,back\na,b\nc,d', 'Only One');
    expect(imported.deck.name).toBe('Only One');
    expect(imported.flashcards).toHaveLength(2);
    expect((imported as { decks?: unknown }).decks).toBeUndefined();
  });
});
