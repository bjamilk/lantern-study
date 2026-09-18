// @vitest-environment jsdom
/**
 * The create wizard, walked end to end the way a student walks it.
 *
 * The step machine and the counts splitter have their own unit tests, and
 * `CreateFromSource.payload.test.ts` freezes what is sent. What is left for a
 * mount is the WIRING: that the screens come in the order the machine says,
 * that each one shows its number and asks one thing, and that the answers
 * collected across five screens arrive at `onPickNote` as one payload.
 *
 * The material tile, the API and the toast store are mocked: this file is
 * about the wizard, and a tile that re-signs a cover image would drag storage
 * into it.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/apiEndpoints', () => ({ createDeckWithCards: vi.fn() }));
vi.mock('../../stores/toastStore', () => ({
  useToastStore: (select: (state: { showToast: () => void }) => unknown) =>
    select({ showToast: () => undefined }),
}));
vi.mock('./StudySetMaterialTile', () => ({
  StudySetMaterialTile: ({ note, onClick }: { note: { id: string; title?: string }; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {note.title ?? note.id}
    </button>
  ),
}));

import { CreateFromSource } from './CreateFromSource';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const NOTES = [{ id: 'note-1', title: 'Glycolysis' }] as never;

const props = () => ({
  notes: NOTES,
  decks: [] as never,
  onCancel: vi.fn(),
  onPickNote: vi.fn(),
  onPickTopic: vi.fn(),
  onPickScratch: vi.fn(),
  onPickDecks: vi.fn(),
});

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(<React.StrictMode>{node}</React.StrictMode>);
  });
};

const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** The first button whose text is exactly `label`. */
const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label
  );

const stepLine = () => container.querySelector('p')?.textContent?.trim();
const question = () => container.querySelector('h2')?.textContent?.trim();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

describe('the quiz path, one question per screen', () => {
  it('numbers every screen and collects one answer on each', async () => {
    const handlers = props();
    await render(<CreateFromSource kind="quiz" {...handlers} />);

    expect(stepLine()).toBe('Step 1');
    expect(question()).toBe('How would you like to create your quiz?');
    // Four source cards, none of them hidden behind More ways.
    expect(container.querySelectorAll('button').length).toBe(4 + 1 /* Cancel */);

    await click(button('From materialsUse notes already in this set'));
    expect(stepLine()).toBe('Step 2 of 5');
    expect(question()).toBe('Which material should we use?');

    await click(button('Glycolysis'));
    expect(stepLine()).toBe('Step 3 of 5');
    expect(question()).toBe('How many questions?');
    // One choice row: 5 / 10 / 15 / 20 / Custom, and no number input on show.
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(5);
    expect(container.querySelector('input[type="number"]')).toBeNull();

    await click(button('10'));
    await click(button('Next'));
    expect(stepLine()).toBe('Step 4 of 5');
    expect(question()).toBe('Which question types?');
    const chips = Array.from(container.querySelectorAll('[aria-pressed]'));
    expect(chips).toHaveLength(4);
    expect(chips.every((chip) => chip.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(container.textContent).toContain("We'll mix them.");

    // Turn two off: the copy stops promising a mix and says what is left.
    await click(button('Fill in the blank'));
    await click(button('Short answer'));
    expect(container.textContent).toContain('Only these — 10 questions in total.');

    await click(button('Next'));
    expect(stepLine()).toBe('Step 5 of 5');
    expect(question()).toBe('What should we call this quiz?');
    // The name is the only field on show; focus lives under More options.
    expect(container.querySelectorAll('input')).toHaveLength(1);

    await click(button('Create quiz'));
    expect(handlers.onPickNote).toHaveBeenCalledWith('note-1', {
      questionCount: 10,
      title: undefined,
      focus: undefined,
      quizTypes: {
        multiple_choice: 5,
        true_false: 5,
        fill_in_blank: 0,
        short_answer: 0,
      },
      lessonMode: undefined,
      recapStyle: undefined,
      recapLength: undefined,
      rubricText: undefined,
    });
  });

  it('keeps a precise per-type mix behind Set each type', async () => {
    const handlers = props();
    await render(<CreateFromSource kind="quiz" {...handlers} />);
    await click(button('From materialsUse notes already in this set'));
    await click(button('Glycolysis'));
    await click(button('Next'));

    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    await click(button('Set each type'));
    const inputs = container.querySelectorAll('input[type="number"]');
    expect(inputs).toHaveLength(4);
    // Seeded from the split the student was already looking at: 20 across four.
    expect(Array.from(inputs).map((node) => (node as HTMLInputElement).value)).toEqual([
      '5',
      '5',
      '5',
      '5',
    ]);
  });

  it('reveals one number input for a custom total', async () => {
    await render(<CreateFromSource kind="quiz" {...props()} />);
    await click(button('From materialsUse notes already in this set'));
    await click(button('Glycolysis'));
    expect(container.querySelector('input[type="number"]')).toBeNull();
    await click(button('Custom'));
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
  });
});

describe('the topic path, split in two', () => {
  it('asks the topic, then the depth, with the rest under More options', async () => {
    const handlers = props();
    await render(<CreateFromSource kind="lesson" {...handlers} />);

    expect(stepLine()).toBe('Step 1');
    expect(question()).toBe('How would you like to create your lesson?');
    await click(button('From a topicGenerate from a topic — not from a note you already have'));
    expect(stepLine()).toBe('Step 2 of 3');
    expect(question()).toBe('What do you want to study?');
    // ONE field on the screen.
    expect(container.querySelectorAll('input')).toHaveLength(1);

    const field = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(field, 'Cell respiration');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Next'));

    expect(stepLine()).toBe('Step 3 of 3');
    expect(question()).toBe('How deep should it go?');
    // Three depth cards as radios, and nothing else visible to answer.
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.textContent).toContain('More options');

    // The lesson mode is there for whoever wants it, not in the way.
    await click(button('More options'));
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);

    await click(button('Create lesson'));
    expect(handlers.onPickTopic).toHaveBeenCalledWith(
      { title: 'Cell respiration', level: 'intermediate' },
      expect.objectContaining({ lessonMode: 'explore', questionCount: 20 })
    );
  });
});
