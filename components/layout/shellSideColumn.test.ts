/**
 * The sidebar's breakpoint, asserted from both ends.
 *
 * `SHELL_SIDEBAR_COLUMN_CLASS` is what MAKES the sidebar a column;
 * `SHELL_SIDEBAR_COLUMN_QUERY` is what `hooks/useFocusSidebarCollapse` ASKS to
 * find out whether it is one. Tailwind's scanner cannot see a class built at
 * runtime, so the class has to stay a literal and the pair cannot be derived
 * from each other — which is exactly the shape that drifts. This is the guard.
 *
 * The bug it is standing in for: focus mode picked `(min-width: 1024px)` out of
 * the air while AppShell drew the sidebar from `md`. At 1006 CSS px — a 1258px
 * window at 125% zoom, which is how the founder browses — the sidebar was a
 * 224px column and the hook that was supposed to stand it down did nothing.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { SHELL_SIDEBAR_COLUMN_CLASS, SHELL_SIDEBAR_COLUMN_QUERY } from './shellSideColumn';

/** Tailwind's defaults. No `screens` override exists in tailwind.config.js. */
const TAILWIND_SCREENS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

describe('the sidebar column breakpoint', () => {
  it('states the same width as a class and as a query', () => {
    const prefix = /(?:^|\s)([a-z0-9]+):block/.exec(SHELL_SIDEBAR_COLUMN_CLASS)?.[1];
    expect(prefix).toBeDefined();
    const px = TAILWIND_SCREENS[prefix as string];
    expect(px).toBeDefined();
    expect(SHELL_SIDEBAR_COLUMN_QUERY).toBe(`(min-width: ${px}px)`);
  });

  it('hides the sidebar below that width rather than drawing a narrow one', () => {
    // `hidden md:block`, not `w-0 md:w-56`: below the breakpoint BottomNav is
    // the navigation and the sidebar is not on screen at all, which is why the
    // hook has nothing to stand down there.
    expect(SHELL_SIDEBAR_COLUMN_CLASS.split(/\s+/)).toContain('hidden');
  });

  it('is the class AppShell actually renders', () => {
    const shell = fs.readFileSync(path.join(__dirname, 'AppShell.tsx'), 'utf8');
    expect(shell).toContain('className={SHELL_SIDEBAR_COLUMN_CLASS}');
    // And not a second hand-written copy of it beside the import.
    expect(shell).not.toContain('"hidden md:block"');
  });

  it('config has not overridden the screens this file assumes', () => {
    const config = fs.readFileSync(
      path.join(__dirname, '../../tailwind.config.js'),
      'utf8'
    );
    expect(config).not.toMatch(/\bscreens\s*:/);
  });
});
