import { describe, expect, it } from 'vitest';
import { calculateFsrsData } from '@lantern/shared/utils/fsrs';
import { isCardDue } from '@lantern/shared/utils/srs';
import {
  MAX_CARDS_PER_REQUEST,
  batchDeckName,
  deckNameFromFileName,
  describeImportPlan,
  planBatches,
  planCardImport,
  type ImportedCard,
} from './importPlanner';

describe('planCardImport', () => {
  it('reads a plain tab-separated export', () => {
    const plan = planCardImport('Mitochondria\tThe powerhouse of the cell\nOsmosis\tWater across a membrane');
    expect(plan.format).toBe('anki-txt');
    expect(plan.cards).toHaveLength(2);
    expect(plan.cards[0]).toMatchObject({
      type: 'BASIC',
      front: 'Mitochondria',
      back: 'The powerhouse of the cell',
    });
  });

  it('honours the header block Anki writes, HTML and all', () => {
    const text = [
      '#separator:tab',
      '#html:true',
      '#notetype column:1',
      '#deck column:2',
      '#tags column:5',
      'Basic\tBiology::Cells\t<b>Mitochondria</b>\tThe <i>powerhouse</i> of the cell\tcells',
    ].join('\n');
    const plan = planCardImport(text);
    expect(plan.cards).toHaveLength(1);
    expect(plan.cards[0]!.front).toBe('Mitochondria');
    expect(plan.cards[0]!.back).toBe('The powerhouse of the cell');
    expect(plan.cards[0]!.tags).toEqual(['cells']);
  });

  it('keeps a comma inside a tab-separated answer', () => {
    const plan = planCardImport('Krebs cycle\tAcetyl-CoA, oxaloacetate, citrate');
    expect(plan.cards[0]!.back).toBe('Acetyl-CoA, oxaloacetate, citrate');
  });

  it('reads a Quizlet-style CSV with a header row', () => {
    const plan = planCardImport('Term,Definition,Tags\nOhm,Unit of resistance,physics;units');
    expect(plan.format).toBe('csv');
    expect(plan.cards).toHaveLength(1);
    expect(plan.cards[0]!.tags).toEqual(['physics', 'units']);
  });

  it('keeps cloze cards as cloze', () => {
    const plan = planCardImport('Photosynthesis stores {{c1::glucose}}.\tglucose');
    expect(plan.cards[0]!.type).toBe('CLOZE');
    expect(plan.cards[0]!.clozeText).toContain('{{c1::glucose}}');
  });

  it('drops half-empty rows and repeats, and says so in plain words', () => {
    const plan = planCardImport(['A\tone', 'B\t', 'A\tone', 'C\ttwo'].join('\n'));
    expect(plan.cards).toHaveLength(2);
    expect(plan.skipped).toBe(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.warnings.join(' ')).toContain('left out');
  });

  it('reads a Lantern JSON export and takes its deck name', () => {
    const json = JSON.stringify({
      deck: { name: 'Pharmacology' },
      flashcards: [{ front: 'Half-life', back: 'Time to halve the concentration' }],
    });
    const plan = planCardImport(json);
    expect(plan.format).toBe('json');
    expect(plan.deckName).toBe('Pharmacology');
    expect(plan.cards).toHaveLength(1);
  });

  it('says plainly when nothing can be read', () => {
    const plan = planCardImport('just one column\nand another line');
    expect(plan.format).toBe('unreadable');
    expect(describeImportPlan(plan)).toContain('front and a back');
  });

  it('treats an empty paste as empty, not as an error', () => {
    expect(planCardImport('   ').format).toBe('empty');
    expect(describeImportPlan(planCardImport('  '))).toContain('Paste your export');
  });

  it('names the deck after the file when the student did not', () => {
    const plan = planCardImport('a\tb', { fileName: 'BIO_101-week3.txt' });
    expect(plan.deckName).toBe('BIO 101 week3');
  });
});

describe('a 200-card Anki export, offline', () => {
  const text = Array.from({ length: 200 }, (_, i) => `Term ${i + 1}\tDefinition ${i + 1}`).join('\n');

  it('reads every card into one save request, with no network call', () => {
    const plan = planCardImport(text, { fileName: 'anatomy.txt' });
    expect(plan.cards).toHaveLength(200);
    expect(plan.skipped).toBe(0);
    expect(plan.duplicates).toBe(0);
    expect(plan.batches).toHaveLength(1);
    expect(describeImportPlan(plan)).toBe('200 cards read from an Anki export.');
  });

  it('schedules them under FSRS: new cards first, then Good at three days', () => {
    const plan = planCardImport(text);
    const card = plan.cards[0]!;

    // Every imported card carries the FSRS seeds and no schedule, so it enters
    // through the daily new-card budget instead of landing as 200 due cards.
    expect(card.srsData.scheduler).toBe('fsrs');
    expect(card.srsData.nextReviewDate).toBe('');
    expect(plan.cards.every((c) => isCardDue(c.srsData) === false)).toBe(true);

    const first = calculateFsrsData(card.srsData, 'good');
    expect(first.interval).toBe(3);
    expect(first.scheduler).toBe('fsrs');
    expect(isCardDue(first)).toBe(false);
    expect(new Date(first.nextReviewDate).getTime()).toBeGreaterThan(Date.now());

    // …and a second Good keeps growing rather than resetting.
    const second = calculateFsrsData(first, 'good');
    expect(second.interval).toBeGreaterThanOrEqual(first.interval);

    // Again on a fresh import goes back to a day, not to a week.
    expect(calculateFsrsData(card.srsData, 'again').interval).toBe(1);
  });
});

describe('batching', () => {
  const card = (i: number): ImportedCard => ({
    type: 'BASIC',
    front: `f${i}`,
    back: `b${i}`,
    tags: [],
    srsData: { interval: 0, easeFactor: 2.4, repetitions: 0, nextReviewDate: '' },
  });

  it('splits past the per-request ceiling and names each deck', () => {
    const batches = planBatches(Array.from({ length: MAX_CARDS_PER_REQUEST * 2 + 1 }, (_, i) => card(i)));
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(MAX_CARDS_PER_REQUEST);
    expect(batches[2]).toHaveLength(1);
    expect(batchDeckName('Anatomy', 0, 3)).toBe('Anatomy (1 of 3)');
    expect(batchDeckName('Anatomy', 0, 1)).toBe('Anatomy');
  });

  it('warns when one import becomes several decks', () => {
    const rows = Array.from({ length: MAX_CARDS_PER_REQUEST + 5 }, (_, i) => `f${i}\tb${i}`).join('\n');
    const plan = planCardImport(rows);
    expect(plan.batches).toHaveLength(2);
    expect(plan.warnings.join(' ')).toContain('2 decks');
  });
});

describe('helpers', () => {
  it('makes a deck name out of a filename', () => {
    expect(deckNameFromFileName('BIO_101-week3.csv')).toBe('BIO 101 week3');
    expect(deckNameFromFileName(undefined)).toBeNull();
  });
});
