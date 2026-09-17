/**
 * Contract test for the three actions focus mode moves the nav with.
 *
 * WHAT THEY ARE FOR. The study room stands the sidebar and the chats flyout
 * down while a studio is open. Which panels were ITS doing has to survive a
 * reload — a reload inside a quiz skips React's unmount, so a memory kept in a
 * hook died there while the persisted `isSidebarExpanded: false` lived on, and
 * the student came back to a collapsed sidebar with nothing that knew to put it
 * back. So the flag lives beside the panel it describes, and these actions are
 * the ONLY way either is written: one `set` each, so the two can never disagree.
 *
 * `hooks/useFocusSidebarCollapse.test.tsx` drives the React side against a copy
 * of this logic; these are the real reducers.
 *
 * `partialize` lists `focusStoodDown` beside the two panel flags, which is what
 * makes the reload work at all. The persist middleware has no storage under the
 * web suite's plain-Node environment, so that listing is asserted as source
 * rather than by round-tripping it.
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { useUIStore } from './uiStore';

const reset = () =>
  useUIStore.setState({
    isSidebarExpanded: true,
    isChatsSectionExpanded: true,
    focusStoodDown: { sidebar: false, chats: false },
  });

beforeEach(reset);

describe('standDownForFocus', () => {
  it('closes an open panel and records that it was ours', () => {
    useUIStore.getState().standDownForFocus('sidebar');
    expect(useUIStore.getState().isSidebarExpanded).toBe(false);
    expect(useUIStore.getState().focusStoodDown).toEqual({ sidebar: true, chats: false });

    useUIStore.getState().standDownForFocus('chats');
    expect(useUIStore.getState().isChatsSectionExpanded).toBe(false);
    expect(useUIStore.getState().focusStoodDown).toEqual({ sidebar: true, chats: true });
  });

  it('never claims a panel the student had already closed', () => {
    useUIStore.setState({ isSidebarExpanded: false, isChatsSectionExpanded: false });
    useUIStore.getState().standDownForFocus('sidebar');
    useUIStore.getState().standDownForFocus('chats');
    expect(useUIStore.getState().focusStoodDown).toEqual({ sidebar: false, chats: false });
  });

  it('is a no-op when the flag is already set — the reload case', () => {
    // What a reload inside a studio looks like: panel down, flag up, and then
    // focus mode mounts again. It must not toggle anything.
    useUIStore.setState({
      isSidebarExpanded: false,
      focusStoodDown: { sidebar: true, chats: false },
    });
    useUIStore.getState().standDownForFocus('sidebar');
    expect(useUIStore.getState().isSidebarExpanded).toBe(false);
    expect(useUIStore.getState().focusStoodDown.sidebar).toBe(true);
  });
});

describe('restoreFromFocus', () => {
  it('reopens a panel we closed and clears the flag', () => {
    useUIStore.getState().standDownForFocus('sidebar');
    useUIStore.getState().restoreFromFocus('sidebar');
    expect(useUIStore.getState().isSidebarExpanded).toBe(true);
    expect(useUIStore.getState().focusStoodDown.sidebar).toBe(false);
  });

  it('leaves a panel the student closed alone', () => {
    useUIStore.setState({ isSidebarExpanded: false });
    useUIStore.getState().restoreFromFocus('sidebar');
    expect(useUIStore.getState().isSidebarExpanded).toBe(false);
  });

  it('is idempotent, so the room and the shell can both call it', () => {
    useUIStore.getState().standDownForFocus('chats');
    useUIStore.getState().restoreFromFocus('chats');
    useUIStore.setState({ isChatsSectionExpanded: false }); // the student, after
    useUIStore.getState().restoreFromFocus('chats');
    expect(useUIStore.getState().isChatsSectionExpanded).toBe(false);
  });
});

describe('clearFocusStandDown', () => {
  it('forgets one panel without touching the other, or either panel’s state', () => {
    useUIStore.getState().standDownForFocus('sidebar');
    useUIStore.getState().standDownForFocus('chats');
    useUIStore.getState().clearFocusStandDown('sidebar');
    expect(useUIStore.getState().focusStoodDown).toEqual({ sidebar: false, chats: true });
    // Clearing is about ownership, not about the panel: both stay closed.
    expect(useUIStore.getState().isSidebarExpanded).toBe(false);
    expect(useUIStore.getState().isChatsSectionExpanded).toBe(false);
  });

  it('means a later restore leaves that panel where the student put it', () => {
    useUIStore.getState().standDownForFocus('sidebar');
    useUIStore.getState().clearFocusStandDown('sidebar');
    useUIStore.getState().restoreFromFocus('sidebar');
    expect(useUIStore.getState().isSidebarExpanded).toBe(false);
  });
});

describe('persistence', () => {
  it('persists the flag alongside the panels it describes', () => {
    const source = fs.readFileSync(path.join(__dirname, 'uiStore.ts'), 'utf8');
    const partialize = /partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/.exec(source)?.[1] ?? '';
    expect(partialize).toContain('isSidebarExpanded: state.isSidebarExpanded');
    expect(partialize).toContain('isChatsSectionExpanded: state.isChatsSectionExpanded');
    expect(partialize).toContain('focusStoodDown: state.focusStoodDown');
  });
});
