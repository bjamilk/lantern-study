// @vitest-environment jsdom
/**
 * The wizard's frame and its three controls, mounted.
 *
 * Read as source these would all pass — what is being asserted is behaviour a
 * student can feel: a step number that matches the screens, a title that takes
 * focus when the step changes (and NOT when the panel first opens), 44 px
 * targets, arrow keys across a radiogroup, and a disclosure that says what it
 * controls. Mounted inside StrictMode, because a ref-and-effect pair that
 * double-invokes is exactly how the focus move would break.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActionCard,
  ChoiceGroup,
  Disclosure,
  ToggleChip,
  WizardShell,
} from './WizardChrome';
import { wizardSteps } from './wizardSteps';

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

const press = async (element: Element | null | undefined, key: string) => {
  await act(async () => {
    (element as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true })
    );
  });
};

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

/** Index a node list and assert the element is really there. */
const at = <T extends Element>(list: ArrayLike<T>, position: number): T => {
  const node = list[position];
  if (!node) throw new Error(`no element at `);
  return node;
};

const QUIZ_STEPS = wizardSteps('quiz', 'materials');

describe('WizardShell', () => {
  it('numbers the step against the screens the path actually has', async () => {
    await render(
      <WizardShell steps={QUIZ_STEPS} index={2} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    expect(container.textContent).toContain('Step 3 of 5');
    expect(container.querySelector('h2')?.textContent).toBe('How many questions?');
  });

  it('asks one question, in the display voice, with one accented word', async () => {
    await render(
      <WizardShell steps={QUIZ_STEPS} index={0} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    const heading = container.querySelector('h2');
    expect(heading?.className).toContain('text-title');
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelector('[data-testid="headline-accent"]')?.textContent).toBe('your');
  });

  it('leaves focus alone when the wizard first opens', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    await render(
      <WizardShell steps={QUIZ_STEPS} index={0} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('moves focus to the title when the step changes', async () => {
    await render(
      <WizardShell steps={QUIZ_STEPS} index={0} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    await render(
      <WizardShell steps={QUIZ_STEPS} index={1} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    const holder = container.querySelector('[tabindex="-1"]');
    expect(document.activeElement).toBe(holder);
    expect(holder?.textContent).toContain('Which material');
  });

  it('only animates the step in when motion is welcome', async () => {
    await render(
      <WizardShell steps={QUIZ_STEPS} index={1} actions={<button type="button">Next</button>}>
        <p>answer</p>
      </WizardShell>
    );
    const animated = container.querySelector('[class*="animate-"]');
    expect(animated?.className).toContain('motion-safe:');
  });
});

describe('ChoiceGroup', () => {
  const OPTIONS = [
    { value: 'intro', label: 'Introductory', promise: 'First principles', icon: 'book-open' },
    { value: 'intermediate', label: 'Intermediate', promise: 'Worked examples', icon: 'layers' },
    { value: 'exam', label: 'Exam-ready', promise: 'What a paper asks', icon: 'trophy' },
  ] as const;

  const mountGroup = async (value: string, onChange = vi.fn()) => {
    await render(
      <ChoiceGroup label="How deep?" variant="card" value={value} onChange={onChange} options={OPTIONS} />
    );
    return onChange;
  };

  it('is a labelled radiogroup of radios, not a row of toggles', async () => {
    await mountGroup('intermediate');
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('How deep?');
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
    expect(at(radios, 1).getAttribute('aria-checked')).toBe('true');
    expect(at(radios, 0).getAttribute('aria-checked')).toBe('false');
    expect(at(radios, 0).getAttribute('aria-pressed')).toBeNull();
  });

  it('puts exactly one option in the tab order, the checked one', async () => {
    await mountGroup('exam');
    const tabbable = Array.from(container.querySelectorAll('[role="radio"]')).filter(
      (node) => node.getAttribute('tabindex') === '0'
    );
    expect(tabbable).toHaveLength(1);
    expect(at(tabbable, 0).textContent).toContain('Exam-ready');
  });

  it('draws a card with its icon, label and one line', async () => {
    await mountGroup('intro');
    const first = at(container.querySelectorAll('[role="radio"]'), 0);
    expect(first.querySelector('svg')).not.toBeNull();
    expect(first.textContent).toContain('Introductory');
    expect(first.textContent).toContain('First principles');
    expect(first.className).toContain('min-h-[44px]');
  });

  it('answers the arrow keys, and wraps', async () => {
    const onChange = await mountGroup('intermediate');
    const radios = container.querySelectorAll('[role="radio"]');
    await press(at(radios, 1), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('exam');
    await press(at(radios, 1), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('intro');
    await press(at(radios, 1), 'Home');
    expect(onChange).toHaveBeenLastCalledWith('intro');
    await press(at(radios, 1), 'End');
    expect(onChange).toHaveBeenLastCalledWith('exam');
  });

  it('answers a click', async () => {
    const onChange = await mountGroup('intro');
    await click(at(container.querySelectorAll('[role="radio"]'), 2));
    expect(onChange).toHaveBeenCalledWith('exam');
  });
});

describe('ToggleChip', () => {
  it('is a pressed button, because many can be on at once', async () => {
    const onClick = vi.fn();
    await render(
      <>
        <ToggleChip label="Multiple choice" on onClick={onClick} />
        <ToggleChip label="Short answer" on={false} onClick={onClick} />
      </>
    );
    const chips = container.querySelectorAll('button');
    expect(at(chips, 0).getAttribute('aria-pressed')).toBe('true');
    expect(at(chips, 1).getAttribute('aria-pressed')).toBe('false');
    expect(at(chips, 0).getAttribute('role')).toBeNull();
    expect(at(chips, 0).className).toContain('min-h-[44px]');
    await click(at(chips, 1));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Disclosure', () => {
  it('starts closed, says what it controls, and opens on a click', async () => {
    await render(
      <Disclosure id="more-here" label="More options">
        <input aria-label="Subject" />
      </Disclosure>
    );
    const trigger = container.querySelector('button');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-controls')).toBe('more-here');
    expect(container.querySelector('input')).toBeNull();

    await click(trigger);
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#more-here input')).not.toBeNull();
  });
});

describe('ActionCard', () => {
  it('is a button that acts, not a radio that selects', async () => {
    const onClick = vi.fn();
    await render(
      <ActionCard icon="document-text" title="From materials" promise="Use notes in this set" onClick={onClick} />
    );
    const card = container.querySelector('button');
    expect(card?.getAttribute('role')).toBeNull();
    expect(card?.textContent).toContain('From materials');
    expect(card?.textContent).toContain('Use notes in this set');
    await click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
