/**
 * What the FOCUS bar is allowed to put in front of a student.
 *
 * The bug this file guards is not a broken control — it is a bar that slowly
 * grows back into the header it replaced. So the assertions are as much about
 * what is ABSENT (stats, counts, a Share pill, a set switcher) as about what
 * renders, and the menu's grouping is asserted by size, because eleven flat
 * entries in a dropdown is the tool-chip strip in a smaller box.
 *
 * `renderToStaticMarkup`: no effect runs and nothing is fetched. The real
 * `Menu` portals through `createPortal`, which a static render drops, so the
 * primitives are stubbed to render their children — open/closed and keyboard
 * behaviour belong to `components/ui/Menu.tsx` and are not retested here.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FOCUS_TOOL_GROUPS, SetRoomFocusBar, type SetRoomFocusBarProps } from './SetRoomFocusBar';
import { WORKSPACE_ACTIVITIES } from '@lantern/shared';

vi.mock('../ui/Menu', () => ({
  Menu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  MenuTrigger: ({ children, ...rest }: Record<string, unknown>) => (
    <button {...rest}>{children as React.ReactNode}</button>
  ),
  MenuContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
  MenuItem: ({ children, ...rest }: Record<string, unknown>) => (
    <button type="button" role="menuitem" {...rest}>
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) => (src ? `https://signed.example/${src}` : undefined),
}));

const noop = () => {};

const baseProps: SetRoomFocusBarProps = {
  setId: 'set-1',
  setName: 'Cell Biology',
  activity: 'quiz',
  onBack: noop,
  onActivity: noop,
  onOpenSettings: noop,
  menu: [
    { id: 'home', label: 'Set home', onSelect: noop },
    { id: 'share', label: 'Share set', onSelect: noop },
    { id: 'all-sets', label: 'All study sets', onSelect: noop },
  ],
};

function render(overrides: Partial<SetRoomFocusBarProps> = {}) {
  return renderToStaticMarkup(<SetRoomFocusBar {...baseProps} {...overrides} />);
}

describe('SetRoomFocusBar', () => {
  it('names the way out after the set, not after the tool', () => {
    expect(render()).toContain('aria-label="Back to Cell Biology"');
  });

  it('carries the trail: the set name and the tool that is open', () => {
    const html = render();
    expect(html).toContain('Cell Biology');
    expect(html).toContain('Quiz');
  });

  it('groups every ready tool, and keeps no group over four rows', () => {
    for (const group of FOCUS_TOOL_GROUPS) {
      expect(group.ids.length).toBeLessThanOrEqual(4);
    }
    const grouped = FOCUS_TOOL_GROUPS.flatMap((group) => [...group.ids]);
    expect(new Set(grouped).size).toBe(grouped.length);
    const ready = WORKSPACE_ACTIVITIES.filter((row) => row.status === 'ready').map((row) => row.id);
    expect([...grouped].sort()).toEqual([...ready].sort());

    const html = render();
    for (const group of FOCUS_TOOL_GROUPS) {
      expect(html).toContain(group.heading.replace(/&/g, '&amp;'));
    }
    for (const row of WORKSPACE_ACTIVITIES) {
      if (row.status === 'ready') expect(html).toContain(`>${row.label}</button>`);
    }
  });

  it('renders the timer slot the room hands it', () => {
    expect(render({ timer: <span>25m</span> })).toContain('25m');
  });

  it('offers chat only when the rail is not already docked', () => {
    expect(render({ onOpenChat: noop })).toContain('aria-label="Chat"');
    expect(render()).not.toContain('aria-label="Chat"');
  });

  it('puts Set settings first in the kebab, because the gear is gone', () => {
    const html = render();
    expect(html).not.toContain('aria-label="Study set settings"');
    expect(html).toContain('Set settings');
    expect(html.indexOf('Set settings')).toBeLessThan(html.indexOf('Set home'));
    expect(html.indexOf('Set home')).toBeLessThan(html.indexOf('Share set'));
  });

  it('draws no stats, no counts, no Share pill and no set switcher', () => {
    const html = render();
    expect(html).not.toContain('progressbar');
    expect(html).not.toMatch(/Topics|Covered|Mastered/);
    expect(html).not.toMatch(/\d+ notes|\d+ decks/);
    expect(html).not.toContain('<select');
    // Share exists, but only as a kebab row — never as a labelled pill.
    expect(html).not.toMatch(/>\s*Share\s*</);
  });

  it('keeps every control at the 44px touch minimum', () => {
    const html = render({ onOpenChat: noop, timer: <span>25m</span> });
    // The bar's own controls. Menu rows are the primitive's business (and are
    // stubbed above), so they are excluded rather than asserted twice.
    const buttons = (html.match(/<button[^>]*>/g) ?? []).filter(
      (button) => !button.includes('role="menuitem"')
    );
    expect(buttons.length).toBe(4); // back, tool menu, chat, kebab
    for (const button of buttons) {
      expect(button).toContain('min-h-[44px]');
    }
  });
});
