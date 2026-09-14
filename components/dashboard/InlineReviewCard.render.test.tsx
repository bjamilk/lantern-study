import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FlashcardType } from '../../types';
import { inlineDueLabelCount, inlineStudyAllTarget, type InlineDueCard } from './inlineReview';

/**
 * The inline card's `Study all N due` link has to be Home's own promise, not a
 * second one. Live it said 62 while the hub above it said 67, and it landed on
 * the flashcards hub — a deck list — instead of a session, because the card
 * counted its OWN queue (which drops the cloze/occlusion cards it cannot
 * render) and routed itself whenever the due pile spanned more than one deck.
 *
 * Both now arrive from Home: the plan total it labels itself with, and the
 * handler that starts the session.
 */

const due = (id: string, deckId: string) => ({
  id,
  deckId,
  type: FlashcardType.BASIC,
  front: `Front ${id}`,
  back: `Back ${id}`,
  srsData: { nextReviewDate: '2000-01-01T00:00:00.000Z' },
});

// Two decks, two due cards — the exact shape that used to send the link to the
// hub instead of into a session.
const storeState = {
  flashcards: [due('c1', 'd1'), due('c2', 'd2')],
  decks: [
    { id: 'd1', name: 'Deck one' },
    { id: 'd2', name: 'Deck two' },
  ],
};

vi.mock('../../stores/flashcardStore', () => ({
  useFlashcardStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock('../../hooks/useFlashcardHandlers', () => ({
  useFlashcardHandlers: () => ({ handleStartReview: vi.fn(), handleUpdateSrsData: vi.fn() }),
}));

const { InlineReviewCard } = await import('./InlineReviewCard');

const queue: InlineDueCard[] = [
  { id: 'c1', deckId: 'd1', deckName: 'Deck one', front: 'a', back: 'b' },
  { id: 'c2', deckId: 'd2', deckName: 'Deck two', front: 'a', back: 'b' },
];

describe('inlineStudyAllTarget', () => {
  it('defers to Home’s session whenever Home supplied one, even across decks', () => {
    expect(inlineStudyAllTarget(queue, true)).toEqual({ kind: 'home' });
  });

  it('still falls back to the single deck, or the hub, with no Home handler', () => {
    expect(inlineStudyAllTarget([queue[0]], false)).toEqual({ kind: 'deck', deckId: 'd1' });
    expect(inlineStudyAllTarget(queue, false)).toEqual({ kind: 'hub' });
  });
});

describe('inlineDueLabelCount', () => {
  it('prefers Home’s plan total over the shorter inline queue', () => {
    expect(inlineDueLabelCount(67, 62)).toBe(67);
  });

  it('uses the queue length only when there is no plan total', () => {
    expect(inlineDueLabelCount(null, 62)).toBe(62);
    expect(inlineDueLabelCount(undefined, 62)).toBe(62);
    expect(inlineDueLabelCount(Number.NaN, 62)).toBe(62);
  });
});

describe('InlineReviewCard', () => {
  it('labels both the link and the corner with Home’s plan total', () => {
    const html = renderToStaticMarkup(<InlineReviewCard dueTotal={67} onStudyAllDue={() => {}} />);
    expect(html).toContain('Study all 67 due');
    expect(html).toContain('67 due');
    // The inline queue holds 2 renderable cards; that number must not surface.
    expect(html).not.toContain('Study all 2 due');
  });

  it('falls back to its own queue length when Home passed no plan', () => {
    const html = renderToStaticMarkup(<InlineReviewCard />);
    expect(html).toContain('Study all 2 due');
  });
});
