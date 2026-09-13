// @vitest-environment jsdom
/**
 * Every deck surface on web must offer its owner a cover, and must not offer it
 * on a deck somebody else shared with me — the route answers 403 there, so the
 * entry would be a menu item that always fails.
 *
 * The gate used to be `!deck.isShared`, which is not ownership: sharing my own
 * deck out left it mine while hiding the cover entries from it. That is why the
 * live Library deck ⋮ showed only "Move to course…".
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canEditCover } from '../../stores/coverActions';
import { StudySetArtifactLibrary } from '../study/StudySetArtifactLibrary';

// Keep the real module (the auth store boots off it); only the network read
// the deck grid performs is stubbed.
vi.mock('../../services/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchDecks: vi.fn(async () => []),
}));

const FlashcardsScreen = (await import('../FlashcardsScreen')).default;
const { useAuthStore } = await import('../../stores/authStore');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'user-me';

const deck = (over: Partial<{ id: string; userId: string; isShared: boolean }> = {}) => ({
  id: 'deck-1',
  name: 'Cell Biology',
  createdAt: new Date().toISOString(),
  userId: ME,
  isShared: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useAuthStore.setState({ currentUser: { id: ME } as never });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const mount = async (node: React.ReactElement) => {
  await act(async () => {
    root.render(node);
  });
};

const openDeckMenu = async () => {
  const trigger = [...document.querySelectorAll('button')].find((el) =>
    (el.getAttribute('aria-label') || '').startsWith('Deck options for')
  );
  expect(trigger, 'the deck card has no ⋮ trigger').toBeTruthy();
  await act(async () => {
    trigger!.click();
  });
};

const menuText = () => document.body.textContent || '';

const screenFor = (row: ReturnType<typeof deck>) => (
  <FlashcardsScreen
    decks={[row] as never}
    flashcards={[]}
    onOpenCreateDeck={() => {}}
    onOpenCreateFlashcard={() => {}}
    onSelectDeck={() => {}}
    onImportDeck={() => {}}
    onStartStudy={() => {}}
  />
);

describe('Library deck card ⋮ (FlashcardsScreen)', () => {
  it('offers the owner a cover, even on a deck they have shared out', async () => {
    await mount(screenFor(deck({ isShared: true })));
    await openDeckMenu();
    expect(menuText()).toContain('Add cover');
  });

  it('labels it "Change cover" once the deck has one', async () => {
    await mount(screenFor({ ...deck(), coverPath: 'covers/deck-1.webp' } as never));
    await openDeckMenu();
    expect(menuText()).toContain('Change cover');
  });

  it('offers no cover on a deck somebody else shared with me', async () => {
    await mount(screenFor(deck({ userId: 'user-someone-else', isShared: true })));
    const trigger = [...document.querySelectorAll('button')].find((el) =>
      (el.getAttribute('aria-label') || '').startsWith('Deck options for')
    );
    if (trigger) {
      await act(async () => {
        trigger.click();
      });
    }
    expect(menuText()).not.toContain('cover');
  });
});

describe('in-set deck tile ⋮ (StudySetArtifactLibrary)', () => {
  const items = [
    { id: 'deck-1', title: 'Cell Biology', meta: '12 cards', feature: 'flashcards' as const, icon: 'layers' as const },
  ];

  it('renders the tile menu beside the tile, never inside its button', async () => {
    await mount(
      <StudySetArtifactLibrary
        title="Cards"
        empty="none"
        items={items}
        onOpen={() => {}}
        renderItemMenu={(item) => (
          <button type="button" aria-label={`Deck options for ${item.title}`}>
            ⋮
          </button>
        )}
      />
    );
    const trigger = container.querySelector('[aria-label="Deck options for Cell Biology"]');
    expect(trigger).toBeTruthy();
    // A <button> inside a <button> is invalid markup and unreachable by keyboard.
    expect(trigger!.closest('button')).toBe(trigger);
  });

  it('renders no menu slot when the surface supplies none', async () => {
    await mount(
      <StudySetArtifactLibrary title="Cards" empty="none" items={items} onOpen={() => {}} />
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('canEditCover', () => {
  it('is ownership, not sharing', () => {
    expect(canEditCover(ME, ME)).toBe(true);
    expect(canEditCover('user-someone-else', ME)).toBe(false);
    // A row with no owner id (optimistic/offline) is treated as mine; the route decides.
    expect(canEditCover(undefined, ME)).toBe(true);
  });
});
