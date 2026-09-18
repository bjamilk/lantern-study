// @vitest-environment jsdom
/**
 * The suggestion pills, mounted.
 *
 * `companionSuggestions.test.ts` proves WHICH pills a page gets; this proves
 * what the student can actually do with them — three of them until "View more"
 * is pressed, a disclosure that says whether it is open, a question that sends
 * and a door that navigates instead, and a 44px target on every one.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanionPrompts } from './CompanionPrompts';
import { companionSuggestionsFor } from './companionSuggestions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(<React.StrictMode>{node}</React.StrictMode>);
  });
};

const click = async (element: Element | null | undefined) => {
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const buttons = () => Array.from(container.querySelectorAll('button'));
const byText = (text: string) =>
  buttons().find((button) => button.textContent?.includes(text));

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
});

const setHome = companionSuggestionsFor({ activity: 'home' });

const mount = async (props: Partial<React.ComponentProps<typeof CompanionPrompts>> = {}) => {
  const onAsk = vi.fn();
  const onOpenDoor = vi.fn();
  const onToggleExpanded = vi.fn();
  await render(
    <CompanionPrompts
      suggestions={setHome}
      expanded={false}
      onToggleExpanded={onToggleExpanded}
      onAsk={onAsk}
      onOpenDoor={onOpenDoor}
      {...props}
    />
  );
  return { onAsk, onOpenDoor, onToggleExpanded };
};

describe('three, then View more', () => {
  it('draws three pills and one disclosure', async () => {
    await mount();
    // Three pills + "View more".
    expect(buttons()).toHaveLength(4);
    expect(byText('What is this study set about?')).toBeTruthy();
    expect(byText('Create a study plan for me')).toBeTruthy();
    expect(byText('Generate flashcards for this set')).toBeTruthy();
    expect(byText('Quiz me on this study set')).toBeFalsy();
  });

  it('says whether it is open, on the control that opens it', async () => {
    const { onToggleExpanded } = await mount();
    const more = byText('View more');
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    await click(more);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    await mount({ expanded: true });
    const less = byText('View less');
    expect(less?.getAttribute('aria-expanded')).toBe('true');
    expect(byText('Quiz me on this study set')).toBeTruthy();
  });

  it('draws no disclosure when there is nothing behind it', async () => {
    // The play page has exactly three.
    await mount({ suggestions: companionSuggestionsFor({ activity: 'play' }) });
    expect(buttons()).toHaveLength(3);
    expect(byText('View more')).toBeFalsy();
  });
});

describe('what pressing one does', () => {
  it('sends a question through the ask path', async () => {
    const { onAsk, onOpenDoor } = await mount();
    await click(byText('What is this study set about?'));
    expect(onAsk).toHaveBeenCalledWith('What is this study set about?');
    expect(onOpenDoor).not.toHaveBeenCalled();
  });

  it('sends the longer prompt where the pill says less than it asks', async () => {
    const { onAsk } = await mount({ suggestions: companionSuggestionsFor({ activity: 'quiz' }) });
    await click(byText('Hint me'));
    expect(onAsk).toHaveBeenCalledWith('Give me one hint for this question — not the answer.');
  });

  it('opens a door instead of pretending to chat', async () => {
    const { onAsk, onOpenDoor } = await mount();
    const pill = byText('Generate flashcards for this set');
    // The accessible name says where it goes — a chip that looks like a
    // question and navigates instead is a lie about what pressing it does.
    expect(pill?.getAttribute('aria-label')).toBe(
      'Generate flashcards for this set — opens the tool'
    );
    await click(pill);
    expect(onOpenDoor).toHaveBeenCalledTimes(1);
    expect(onOpenDoor.mock.calls[0]?.[0]).toMatchObject({
      kind: 'door',
      door: 'open_create_flashcard',
    });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('goes quiet while the companion is busy', async () => {
    const { onAsk } = await mount({ disabled: true });
    const pill = byText('What is this study set about?');
    expect((pill as HTMLButtonElement).disabled).toBe(true);
    await click(pill);
    expect(onAsk).not.toHaveBeenCalled();
  });
});

describe('the pill anatomy', () => {
  it('keeps a 44px target on every pill, padding rather than a bigger pill', async () => {
    await mount();
    for (const button of buttons()) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('rounded-full');
    }
  });

  it('draws the glyph in the ink of the thing the pill is about', async () => {
    await mount();
    const cards = byText('Generate flashcards for this set');
    expect(cards?.innerHTML).toContain('text-lantern-feature-flashcards-ink');
    const about = byText('What is this study set about?');
    expect(about?.innerHTML).toContain('text-lantern-feature-sets-ink');
  });
});
