// @vitest-environment jsdom
/**
 * `Skip` on BOTH faces.
 *
 * The phone fixed this first: Skip used to vanish the moment the card turned
 * over, so a student who revealed an answer they could not grade honestly had
 * no exit but a grade — which writes an FSRS review they never meant. Web kept
 * the front-only arrangement. These tests pin the fixed shape: the button is
 * present on the back, it is the same ungraded `advance()` (nothing reaches
 * `handleUpdateSrsData`), and it moves the queue on to the next card.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashcardType } from '../../types';

const due = (id: string, deckId: string) => ({
  id,
  deckId,
  type: FlashcardType.BASIC,
  front: `Front ${id}`,
  back: `Back ${id}`,
  srsData: { nextReviewDate: '2000-01-01T00:00:00.000Z' },
});

const storeState = {
  flashcards: [due('c1', 'd1'), due('c2', 'd2')],
  decks: [
    { id: 'd1', name: 'Deck one' },
    { id: 'd2', name: 'Deck two' },
  ],
};

const { handleUpdateSrsData } = vi.hoisted(() => ({ handleUpdateSrsData: vi.fn() }));

vi.mock('../../stores/flashcardStore', () => ({
  useFlashcardStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock('../../hooks/useFlashcardHandlers', () => ({
  useFlashcardHandlers: () => ({ handleStartReview: vi.fn(), handleUpdateSrsData }),
}));

const { InlineReviewCard } = await import('./InlineReviewCard');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const byText = (text: string) =>
  [...container.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === text);

const skipButtons = () => [...container.querySelectorAll('[data-testid="home-inline-review-skip"]')];

beforeEach(async () => {
  handleUpdateSrsData.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<InlineReviewCard dueTotal={2} onStudyAllDue={() => {}} />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('InlineReviewCard skip', () => {
  it('offers Skip on the front face', () => {
    expect(container.textContent).toContain('Front c1');
    expect(skipButtons()).toHaveLength(1);
  });

  it('still offers Skip once the answer is revealed', async () => {
    await click(byText('Show answer'));
    expect(container.textContent).toContain('Back c1');
    expect(skipButtons()).toHaveLength(1);
  });

  it('skipping from the BACK advances without grading', async () => {
    await click(byText('Show answer'));
    await click(skipButtons()[0]);
    // Next card, and no review was written for the one that was skipped.
    expect(container.textContent).toContain('Front c2');
    expect(handleUpdateSrsData).not.toHaveBeenCalled();
  });
});
