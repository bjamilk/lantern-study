// @vitest-environment jsdom
/**
 * The collapsed companion rail, and the overlay its button opens on a room too
 * narrow to dock.
 *
 * Mounted rather than read as source, and mounted inside `<React.StrictMode>`,
 * because what is being asserted is behaviour a student can feel: a 44×44
 * target, a disclosure that says what it controls, Escape and a scrim that
 * close the sheet, and focus that comes back to the button that opened it.
 *
 * The overlay is `components/ui/Drawer` with the set room's own configuration —
 * the same component `AICompanionPanel` renders for `variant="drawer"` — so it
 * is mounted here the way the room configures it rather than mocked.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanionRailButton } from './CompanionRailButton';
import Drawer from '../ui/Drawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(<React.StrictMode>{node}</React.StrictMode>);
  });
};

const click = async (element: Element | null) => {
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

describe('the collapsed rail', () => {
  it('is a disclosure that names itself and what it opens', async () => {
    await render(<CompanionRailButton onExpand={() => {}} />);
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Open Lantern AI');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe('ai-companion-panel');
  });

  it('keeps a 44px target inside its 48px column', async () => {
    await render(<CompanionRailButton onExpand={() => {}} />);
    expect(container.querySelector('aside')?.className).toContain('w-12');
    const className = container.querySelector('button')?.className ?? '';
    expect(className).toContain('min-h-[44px]');
    expect(className).toContain('min-w-[44px]');
  });

  it('expands on click', async () => {
    const onExpand = vi.fn();
    await render(<CompanionRailButton onExpand={onExpand} />);
    await click(container.querySelector('button'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('shows a dot only when the companion is holding a note', async () => {
    await render(<CompanionRailButton onExpand={() => {}} />);
    expect(container.querySelector('button span')).toBeNull();

    await render(<CompanionRailButton onExpand={() => {}} hasAttachment />);
    const dot = container.querySelector('button span');
    expect(dot).not.toBeNull();
    // Decorative: the note is named in the panel, and a wordless announcement
    // here would only say "something".
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the overlay, on a room too narrow to dock', () => {
  /** The room's own configuration of the shared drawer. */
  const Overlay = ({ onClose }: { onClose: () => void }) => (
    <Drawer
      isOpen
      onClose={onClose}
      maxWidthClass="max-w-lg"
      zIndexClass="z-[70]"
      backdropClassName="bg-black/40"
    >
      <button type="button">Composer</button>
    </Drawer>
  );

  it('is a modal dialog over the studio, with a scrim at every width', async () => {
    await render(<Overlay onClose={() => {}} />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const scrim = document.querySelector('[role="presentation"] > [aria-hidden]');
    // `md:hidden` is the GLOBAL companion's scrim: a drawer that follows every
    // screen must not dim the app. This one is modal over the studio and dims.
    expect(scrim?.className).not.toContain('md:hidden');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await render(<Overlay onClose={onClose} />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a scrim click', async () => {
    const onClose = vi.fn();
    await render(<Overlay onClose={onClose} />);
    const scrim = document.querySelector('[role="presentation"] > [aria-hidden]') as HTMLElement;
    await act(async () => {
      scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('gives focus back to whatever opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await render(<Overlay onClose={() => {}} />);
    await render(<div />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
