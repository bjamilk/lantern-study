import { describe, expect, it } from 'vitest';
import { FlashcardType, type Flashcard } from '../types';
import { buildDeckStudyContent, testTitleForSource } from './testGeneration';

const card = (over: Partial<Flashcard>): Flashcard =>
  ({
    id: 'c1',
    deckId: 'd1',
    type: FlashcardType.BASIC,
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  }) as Flashcard;

describe('buildDeckStudyContent', () => {
  it('turns each two-sided card into one line', () => {
    expect(
      buildDeckStudyContent([
        card({ front: 'Mitosis', back: 'Cell division' }),
        card({ id: 'c2', front: 'Meiosis', back: 'Gamete division' }),
      ])
    ).toBe('Mitosis — Cell division\nMeiosis — Gamete division');
  });

  it('keeps a cloze card as its own sentence', () => {
    expect(buildDeckStudyContent([card({ clozeText: 'The powerhouse is the {{mitochondria}}.' })])).toBe(
      'The powerhouse is the {{mitochondria}}.'
    );
  });

  it('drops a card with no usable text — an image-occlusion card gives a generator nothing', () => {
    expect(buildDeckStudyContent([card({ imageUrl: 'https://x/y.png' })])).toBe('');
    expect(buildDeckStudyContent([card({ front: 'Front only' })])).toBe('');
  });

  it('is empty for an empty deck, which is what the caller checks', () => {
    expect(buildDeckStudyContent([])).toBe('');
  });

  it('caps how many cards go to the generator', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      card({ id: `c${i}`, front: `F${i}`, back: `B${i}` })
    );
    expect(buildDeckStudyContent(many).split('\n')).toHaveLength(120);
  });
});

describe('testTitleForSource', () => {
  it('uses one name — "Test" — and hangs the source off it', () => {
    expect(testTitleForSource({ source: 'note', sourceTitle: 'Lecture 4' })).toBe('Test · Lecture 4');
    expect(testTitleForSource({ source: 'deck', sourceTitle: '  ' })).toBe('Test');
    expect(testTitleForSource({ source: 'deck', sourceTitle: null })).toBe('Test');
  });

  it('stays inside the column a list can show', () => {
    expect(testTitleForSource({ source: 'note', sourceTitle: 'x'.repeat(500) })).toHaveLength(120);
  });
});
