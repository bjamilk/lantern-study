import { calculateFsrsData } from '@lantern/shared/utils/fsrs';
import { isCardDue } from '@lantern/shared/utils/srs';
import {
  INITIAL_IMPORT_STATE,
  canSave,
  cardsToSave,
  importCardsReducer,
  importFileRefusal,
  importedCardsToLocalFlashcards,
  outcomeMessage,
  overflowNotice,
  previewCards,
  summaryLine,
} from './importCardsMachine';
import type { ImportCardsState } from './importCardsMachine';

const ankiRows = (n: number) =>
  Array.from({ length: n }, (_, i) => `Term ${i + 1}\tDefinition ${i + 1}`).join('\n');

function run(events: Parameters<typeof importCardsReducer>[1][]): ImportCardsState {
  return events.reduce(importCardsReducer, INITIAL_IMPORT_STATE);
}

describe('paste → parsed → named → saved', () => {
  it('walks the whole path', () => {
    let state = run([
      { type: 'text_changed', text: ankiRows(200) },
      { type: 'parse' },
    ]);
    expect(state.stage).toBe('review');
    expect(state.parsed!.cards).toHaveLength(200);
    expect(summaryLine(state)).toBe('200 cards found');
    expect(previewCards(state)).toHaveLength(3);
    expect(canSave(state)).toBe(true);

    state = importCardsReducer(state, { type: 'deck_name_changed', name: 'PHA 301' });
    state = importCardsReducer(state, { type: 'save_started' });
    expect(state.stage).toBe('saving');
    expect(canSave(state)).toBe(false);

    state = importCardsReducer(state, {
      type: 'save_succeeded',
      outcome: { kind: 'saved', count: 200, deckName: 'PHA 301' },
    });
    expect(state.stage).toBe('saved');
    expect(outcomeMessage(state.outcome!)).toContain('saved to “PHA 301”');
  });

  it('ends in queued, with copy that does not claim the account has them', () => {
    const state = importCardsReducer(
      run([{ type: 'text_changed', text: ankiRows(3) }, { type: 'parse' }]),
      { type: 'save_succeeded', outcome: { kind: 'queued', count: 3, deckName: 'Offline deck' } }
    );
    expect(state.stage).toBe('queued');
    const message = outcomeMessage(state.outcome!);
    expect(message).toContain('on this phone');
    expect(message).toContain('next time you');
    expect(message).not.toContain('saved to your account.');
  });
});

describe('naming', () => {
  it('suggests a name from the picked file and stops suggesting once edited', () => {
    let state = run([
      { type: 'file_picked', text: ankiRows(2), fileName: 'BIO_101-cards.txt' },
      { type: 'parse' },
    ]);
    expect(state.deckName).toBe('BIO 101 cards');

    state = importCardsReducer(state, { type: 'deck_name_changed', name: 'Cell biology' });
    state = importCardsReducer(state, { type: 'parse' });
    expect(state.deckName).toBe('Cell biology');
  });

  it('will not save an unnamed deck', () => {
    const state = run([{ type: 'text_changed', text: ankiRows(2) }, { type: 'parse' }]);
    expect(canSave(importCardsReducer(state, { type: 'deck_name_changed', name: '   ' }))).toBe(false);
  });
});

describe('re-parsing and failure', () => {
  it('drops a stale count when the source is edited', () => {
    const parsed = run([{ type: 'text_changed', text: ankiRows(5) }, { type: 'parse' }]);
    const edited = importCardsReducer(parsed, { type: 'text_changed', text: ankiRows(1) });
    expect(edited.stage).toBe('input');
    expect(edited.parsed).toBeNull();
  });

  it('keeps the parsed cards after a failed save so a retry costs nothing', () => {
    const parsed = run([{ type: 'text_changed', text: ankiRows(200) }, { type: 'parse' }]);
    const failed = importCardsReducer(parsed, { type: 'save_failed', message: 'Server said no.' });
    expect(failed.stage).toBe('failed');
    expect(failed.error).toBe('Server said no.');
    expect(cardsToSave(failed)).toHaveLength(200);
    expect(canSave(failed)).toBe(true);
  });

  it('refuses to save nothing', () => {
    const state = run([{ type: 'text_changed', text: 'prose with no separator' }, { type: 'parse' }]);
    expect(canSave(state)).toBe(false);
  });
});

describe('the door only reads what it can parse on the phone', () => {
  it('accepts a text export: a picked .txt/.csv/.tsv is not refused', () => {
    expect(importFileRefusal('BIO_101-cards.txt')).toBeNull();
    expect(importFileRefusal('quizlet-export.csv')).toBeNull();
    expect(importFileRefusal('deck.tsv')).toBeNull();
    // An extensionless Quizlet export is read on content, not refused here.
    expect(importFileRefusal('exported-cards')).toBeNull();
  });

  it('refuses an Anki .apkg/.colpkg package and names what to bring instead', () => {
    for (const name of ['French.apkg', 'Collection.colpkg', 'DECK.APKG']) {
      const message = importFileRefusal(name);
      // The rule must fire — this fails if the .apkg guard is removed.
      expect(message).not.toBeNull();
      // Plain words that tell the student what the door does accept…
      expect(message).toContain('.txt');
      // …and never a raw parser, file-system or vendor string.
      const lower = message!.toLowerCase();
      expect(lower).not.toContain('unexpected');
      expect(lower).not.toContain('json');
      expect(lower).not.toContain('sqlite');
      expect(lower).not.toContain('error');
    }
  });

  it('a picked .txt still parses to saveable cards (the accept path end to end)', () => {
    const state = run([
      { type: 'file_picked', text: ankiRows(4), fileName: 'deck.txt' },
      { type: 'parse' },
    ]);
    expect(state.parsed!.cards).toHaveLength(4);
    expect(canSave(importCardsReducer(state, { type: 'deck_name_changed', name: 'X' }))).toBe(true);
  });

  it('refusing through the machine keeps the paste box usable and drops any stale parse', () => {
    const parsed = run([{ type: 'text_changed', text: ankiRows(3) }, { type: 'parse' }]);
    const rejected = importCardsReducer(parsed, {
      type: 'file_rejected',
      message: importFileRefusal('deck.apkg')!,
    });
    expect(rejected.stage).toBe('input');
    expect(rejected.parsed).toBeNull();
    expect(rejected.error).toContain('.txt');
    expect(canSave(rejected)).toBe(false);
  });
});

describe('the server cap', () => {
  it('imports the first 500 and says what was left out', () => {
    const state = run([{ type: 'text_changed', text: ankiRows(620) }, { type: 'parse' }]);
    expect(state.parsed!.cards).toHaveLength(620);
    expect(cardsToSave(state)).toHaveLength(500);
    expect(overflowNotice(state)).toContain('120');
  });

  it('says nothing when everything fits', () => {
    const state = run([{ type: 'text_changed', text: ankiRows(200) }, { type: 'parse' }]);
    expect(overflowNotice(state)).toBeNull();
  });
});

describe('FSRS initial state', () => {
  const cards = [{ type: 'BASIC' as const, front: 'ATP', back: 'Adenosine triphosphate' }];

  it('imports cards as NEW — not as 200 cards due today', () => {
    const [card] = importedCardsToLocalFlashcards(cards, 'deck-1', (i) => `temp_import_${i}`);
    expect(card!.srsData).toBeDefined();
    expect(card!.srsData!.nextReviewDate).toBe('');
    expect(card!.srsData!.repetitions).toBe(0);
    expect(card!.srsData!.scheduler).toBe('fsrs');
    expect(isCardDue(card!.srsData)).toBe(false);
  });

  it('schedules the first review from the FSRS initial constants', () => {
    const [card] = importedCardsToLocalFlashcards(cards, 'deck-1', (i) => `temp_import_${i}`);
    const intervals = (['again', 'hard', 'good', 'easy'] as const).map(
      (rating) => calculateFsrsData(card!.srsData, rating).interval
    );
    expect(intervals).toEqual([1, 1, 3, 5]);
    expect(calculateFsrsData(card!.srsData, 'good').scheduler).toBe('fsrs');
  });

  it('carries type, sides, cloze text and tags onto the local row', () => {
    const [card] = importedCardsToLocalFlashcards(
      [
        {
          type: 'CLOZE',
          front: 'Photosynthesis makes {{c1::glucose}}.',
          back: 'glucose',
          clozeText: 'Photosynthesis makes {{c1::glucose}}.',
          tags: ['bio'],
        },
      ],
      'deck-9',
      (i) => `temp_import_${i}`
    );
    expect(card).toMatchObject({
      deckId: 'deck-9',
      type: 'CLOZE',
      clozeText: 'Photosynthesis makes {{c1::glucose}}.',
      tags: ['bio'],
    });
  });
});
