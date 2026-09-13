import {
  cleanDeckTitle,
  deckDisplaySubtitle,
  deckDisplayTitle,
  isEmptyGeneratedDeck,
  sortDecksForList,
  type DeckListItem,
} from './deckList';

const deck = (over: Partial<DeckListItem> = {}): DeckListItem => ({
  name: 'Pharmacology',
  due_count: 0,
  card_count: 10,
  ...over,
});

describe('cleanDeckTitle', () => {
  it('drops an upload epoch and the dash it leaves behind', () => {
    // The device pass: "-Gestational_Diabetes_PPT" as a deck title, from
    // "1782589411975-Gestational_Diabetes_PPT".
    expect(cleanDeckTitle('1782589411975-Gestational_Diabetes_PPT')).toBe(
      'Gestational Diabetes PPT'
    );
    expect(cleanDeckTitle('-Gestational_Diabetes_PPT')).toBe('Gestational Diabetes PPT');
  });

  it('drops a file extension the uploader kept', () => {
    expect(cleanDeckTitle('N448_Gas_Exchange_Study_Guide.pdf')).toBe(
      'N448 Gas Exchange Study Guide'
    );
  });

  it('drops the From: prefix a generated deck name carries', () => {
    expect(cleanDeckTitle('From: SDOH')).toBe('SDOH');
    expect(cleanDeckTitle('From: N448_Gas_Exchange_Study_Guide')).toBe(
      'N448 Gas Exchange Study Guide'
    );
  });

  it('leaves a title a person typed exactly as they typed it', () => {
    expect(cleanDeckTitle('Fluid and Electrolytes — NCLEX Review')).toBe(
      'Fluid and Electrolytes — NCLEX Review'
    );
    // A number that is not an epoch stamp is part of the name.
    expect(cleanDeckTitle('PHARM 212 week 3')).toBe('PHARM 212 week 3');
  });

  it('never empties a row', () => {
    expect(cleanDeckTitle('1782589411975')).toBe('1782589411975');
    expect(cleanDeckTitle('   ')).toBe('');
  });
});

describe('deckDisplaySubtitle', () => {
  it('does not recategorize a deck as the note it was made from', () => {
    expect(
      deckDisplaySubtitle(
        deck({
          name: 'From: SDOH',
          description: 'Generated from note: SDOH',
        })
      )
    ).toBeNull();
    expect(
      deckDisplaySubtitle(
        deck({
          name: 'Cardiology cards',
          description: 'Generated from note: 1782589411975-Gestational_Diabetes_PPT',
        })
      )
    ).toBeNull();
  });

  it('leaves a description the student wrote alone', () => {
    expect(deckDisplaySubtitle(deck({ description: 'optioal' }))).toBe('optioal');
    expect(deckDisplaySubtitle(deck({ description: null }))).toBeNull();
  });
});

describe('deckDisplayTitle', () => {
  it('falls back rather than drawing a nameless row', () => {
    expect(deckDisplayTitle(deck({ name: '   ' }))).toBe('Untitled deck');
  });

  it('draws a generated deck as a deck, not as From: a note', () => {
    expect(deckDisplayTitle(deck({ name: 'From: SDOH' }))).toBe('SDOH');
  });
});

describe('isEmptyGeneratedDeck', () => {
  it('hides a From: shell with no cards', () => {
    expect(isEmptyGeneratedDeck(deck({ name: 'From: SDOH', card_count: 0 }))).toBe(true);
    expect(
      isEmptyGeneratedDeck(
        deck({ name: 'SDOH', description: 'Generated from note: SDOH', card_count: 0 })
      )
    ).toBe(true);
  });

  it('keeps a generated deck that has cards, and any empty deck a person made', () => {
    expect(isEmptyGeneratedDeck(deck({ name: 'From: SDOH', card_count: 20 }))).toBe(false);
    expect(isEmptyGeneratedDeck(deck({ name: 'biology', card_count: 0 }))).toBe(false);
  });
});

describe('sortDecksForList', () => {
  it('puts what can be studied now above what cannot', () => {
    // The device pass: five "Nothing ready" decks filled the first screen
    // while a deck with 10 due sat below the fold.
    const list = [
      deck({ name: 'nothing a', due_count: 0 }),
      deck({ name: 'nothing b', due_count: 0 }),
      deck({ name: 'due 10', due_count: 10 }),
      deck({ name: 'due 14', due_count: 14 }),
    ];
    expect(sortDecksForList(list).map((d) => d.name)).toEqual([
      'due 14',
      'due 10',
      'nothing a',
      'nothing b',
    ]);
  });

  it('keeps the order it was given inside each band', () => {
    const list = [
      deck({ name: 'b', due_count: 0 }),
      deck({ name: 'a', due_count: 0 }),
      deck({ name: 'c', due_count: 3 }),
      deck({ name: 'd', due_count: 3 }),
    ];
    expect(sortDecksForList(list).map((d) => d.name)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('treats a missing count as nothing due rather than crashing', () => {
    const list = [deck({ name: 'unknown', due_count: null }), deck({ name: 'due', due_count: 1 })];
    expect(sortDecksForList(list).map((d) => d.name)).toEqual(['due', 'unknown']);
  });

  it('does not mutate the list it was handed', () => {
    const list = [deck({ name: 'a', due_count: 0 }), deck({ name: 'b', due_count: 5 })];
    sortDecksForList(list);
    expect(list.map((d) => d.name)).toEqual(['a', 'b']);
  });
});
