// @vitest-environment jsdom
/**
 * The tutor-style picker, mounted.
 *
 * `packages/shared/src/ai/tutorStyles.test.ts` proves WHAT the four styles are;
 * this proves what a student can do with them — open the menu, read four rows
 * with a label and a description each, see which one is in force, and pick a
 * different one. It mounts under `<StrictMode>` (double-invoked render and
 * effects) because every render test next door does: the menu positions itself
 * in a layout effect, and a picker that only worked on the second mount would
 * pass a lax test and fail in the app.
 *
 * Also asserted here: the icon name each style carries resolves in the web's
 * icon vocabulary. That check cannot live in `packages/shared` — `AppIconName`
 * is a client vocabulary — so this is where a typo in the registry is caught.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TUTOR_STYLES, TUTOR_STYLE_HONESTY_NOTE } from '@lantern/shared/ai';
import { isAppIconName } from '../ui/AppIcon';
import { TutorStylePicker } from './TutorStylePicker';

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

/** The menu renders through a portal, so look at the document, not the div. */
const menuItems = () => Array.from(document.querySelectorAll('[role="menuitemradio"]'));
const trigger = () =>
  document.querySelector('button[aria-label="Tutor style"]') as HTMLButtonElement;

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
  document.body.innerHTML = '';
});

const mount = async (props: Partial<React.ComponentProps<typeof TutorStylePicker>> = {}) => {
  const onChange = vi.fn();
  await render(<TutorStylePicker value="default" onChange={onChange} {...props} />);
  return { onChange };
};

describe('the trigger', () => {
  it('is one labelled icon button, named for what it changes', async () => {
    await mount();
    expect(trigger()).toBeTruthy();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // 32x32 glyph on a 44px target — the header's rule.
    expect(trigger().className).toContain('min-h-[44px]');
    expect(trigger().querySelector('span')?.className).toContain('h-8 w-8');
  });

  it('says which style is in force, for a student who never opens the menu', async () => {
    await mount({ value: 'coach' });
    expect(trigger().getAttribute('title')).toBe('Tutor style: Coach');
  });
});

describe('the menu', () => {
  it('offers the four styles, each with its label and its description', async () => {
    await mount();
    await click(trigger());

    const items = menuItems();
    expect(items).toHaveLength(4);
    for (const [index, style] of TUTOR_STYLES.entries()) {
      expect(items[index]?.textContent).toContain(style.label);
      expect(items[index]?.textContent).toContain(style.description);
    }
  });

  it('checks the one in force, and only that one', async () => {
    await mount({ value: 'professor' });
    await click(trigger());

    const checked = menuItems().filter((item) => item.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain('Professor');
  });

  it('reports the picked id and closes', async () => {
    const { onChange } = await mount({ value: 'default' });
    await click(trigger());
    await click(menuItems().find((item) => item.textContent?.includes('Study buddy')));

    expect(onChange).toHaveBeenCalledWith('peer');
    expect(menuItems()).toHaveLength(0);
  });

  it('holds no state of its own — the value it shows is the one it is given', async () => {
    const { onChange } = await mount({ value: 'default' });
    await click(trigger());
    await click(menuItems().find((item) => item.textContent?.includes('Coach')));

    // The pick was reported, but nothing was applied locally: the account's
    // settings are the single source, and a picker that also remembered its
    // own choice is how a drawer and a docked rail end up disagreeing.
    expect(onChange).toHaveBeenCalledWith('coach');
    expect(trigger().getAttribute('title')).toBe('Tutor style: Lantern');
  });
});

describe('honesty', () => {
  it('says the style changes the voice, not the knowledge', async () => {
    await mount();
    await click(trigger());

    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain(TUTOR_STYLE_HONESTY_NOTE);
  });

  it('promises nothing about accuracy in any row', async () => {
    await mount();
    await click(trigger());

    const text = (document.querySelector('[role="menu"]')?.textContent || '').toLowerCase();
    for (const claim of ['accurate', 'smarter', 'expert', 'better answers']) {
      expect(text).not.toContain(claim);
    }
  });
});

describe('the registry meets the web icon vocabulary', () => {
  it.each(TUTOR_STYLES.map((style) => [style.id, style.icon] as const))(
    '%s names a real AppIcon (%s)',
    (_id, icon) => {
      expect(isAppIconName(icon)).toBe(true);
    }
  );
});
