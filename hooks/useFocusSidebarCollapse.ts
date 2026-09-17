import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import {
  SHELL_SIDEBAR_COLUMN_QUERY,
  shellSidebarIsAColumn,
} from '../components/layout/shellSideColumn';

/** The two nav panels focus mode stands down. Order is not significant. */
const PANELS = ['sidebar', 'chats'] as const;

/**
 * Stand the left-hand nav chrome down while the student is inside a studio,
 * and give it back when they leave — without ever fighting them for it.
 *
 * TWO PANELS, ONE RULE. The chrome is not one thing: there is the sidebar rail
 * (`isSidebarExpanded`, 224px labelled vs a 64px icon rail) and the chats
 * flyout column beside it (`isChatsSectionExpanded`, a further 320px, and it
 * defaults to OPEN for every account). Together they are up to 608px of a
 * 1258px window, which is why a focus bar measured fine on its own and then
 * arrived crushed: the studio was reading ~480px. They are handled here rather
 * than in a second hook because they share the rule, and two hooks racing for
 * the same "did the student touch it" bit is how this gets subtly wrong.
 *
 * THE POINT. Focus mode's claim is that the screen goes to studying. The nav is
 * not REMOVED, though — it is the app's navigation, and a studio is not a
 * different app. Both changes are reversible in one click.
 *
 * THE RULE, AND WHY IT IS A MEMORY RATHER THAN A SET/RESTORE PAIR. Naively
 * closing on enter and opening on leave loses an argument with the student:
 * someone whose sidebar was ALREADY collapsed before they started would find it
 * forced open on the way out. So the hook remembers one bit PER PANEL: "this
 * close was ours". It is set only when we actually closed something that was
 * open, cleared the moment the student opens it again themselves, and it is
 * what the restore is conditional on.
 *
 * WHY THE LIVE STORE AND NOT A RENDER SNAPSHOT.
 * FIXED: the first version of this hook read `isSidebarExpanded` out of a ref
 * synced on render, and under `<React.StrictMode>` — which index.tsx wraps the
 * whole app in — it left the sidebar exactly as it found it. StrictMode
 * double-invokes mount effects (effect → cleanup → effect), and no re-render
 * happens in between, so the ref still said "expanded" on the second pass: the
 * effect collapsed, the cleanup was skipped because the STALE ref disagreed
 * with the store, and the second effect toggled it straight back open. Unit
 * tests that mount outside StrictMode invoke each effect once and can never see
 * this. `useUIStore.getState()` is read at the moment of use, so the second
 * pass sees what the first pass actually did. The suite now mounts inside
 * StrictMode for exactly this reason.
 *
 * WHERE THE BREAKPOINT COMES FROM. `shellSidebarIsAColumn()`, which is the one
 * question that matters: is the nav taking width from the content right now?
 * FIXED: this gated on an invented `(min-width: 1024px)`. The founder browses
 * at 125% zoom, where a 1258 device-px window is a 1006 CSS-px viewport — under
 * `lg`, well over the `md` at which AppShell draws the sidebar as a column, and
 * the nav was still 224px of a 1006px screen. The hook did nothing for exactly
 * the person the redesign was for. It now shares AppShell's own constant, so a
 * change to one is a change to both.
 *
 * Below that the sidebar is not drawn at all (BottomNav is the navigation), so
 * the hook does nothing — closing something that is not on screen would make
 * the change appear on the next resize for no reason a student could explain.
 *
 * SURVIVING A RELOAD. The memory is not a ref in this hook; it is
 * `focusStoodDown` in the ui store, persisted in the same `ui-storage` blob as
 * the two panel flags and written in the SAME `set` as the collapse, so the two
 * can never disagree. A reload inside a studio skips React's unmount, so a ref
 * died there while `isSidebarExpanded: false` survived — the student came back
 * to a collapsed sidebar with nothing that knew to restore it. That is the
 * common path, not an edge. `useFocusStandDownRestore` below puts the panel
 * back on the first non-studio route of the next visit.
 *
 * Deliberately NOT animated: nothing here respects `prefers-reduced-motion`
 * because there is no motion to reduce. The panels' own transitions are the
 * shell's.
 */
export function useFocusSidebarCollapse(focus: boolean): void {
  // Subscriptions, so the hook re-renders when the student touches either
  // panel. The VALUES are only used to notice that; every decision below reads
  // `getState()` instead — see the StrictMode note above.
  const sidebarExpanded = useUIStore((s) => s.isSidebarExpanded);
  const chatsOpen = useUIStore((s) => s.isChatsSectionExpanded);

  // The student's own toggle wins: a panel they have opened stops being ours to
  // close again or to restore. Declared BEFORE the enter/leave effect so that
  // on the render where focus turns on it runs first and sees the state the
  // next effect is about to change, rather than clearing the flag it just set.
  useEffect(() => {
    if (!focus || !shellSidebarIsAColumn()) return;
    if (sidebarExpanded) useUIStore.getState().clearFocusStandDown('sidebar');
    if (chatsOpen) useUIStore.getState().clearFocusStandDown('chats');
  }, [focus, sidebarExpanded, chatsOpen]);

  useEffect(() => {
    if (!focus || !shellSidebarIsAColumn()) return;
    // Each action is a no-op on a panel that is already closed, so arriving in
    // FOCUS after a reload neither toggles anything nor disturbs the flag.
    for (const panel of PANELS) useUIStore.getState().standDownForFocus(panel);
    return () => {
      for (const panel of PANELS) useUIStore.getState().restoreFromFocus(panel);
    };
  }, [focus]);
}

/**
 * The other half of the restore, and the reason the flags are persisted.
 *
 * FIXED: a reload inside a studio (or closing the tab, or a hard navigation)
 * skips React's unmount, so nothing runs the room hook's cleanup. Before the
 * flags moved into the store that lost the memory entirely; now the memory
 * survives, but something still has to act on it, and it cannot be the room —
 * the student may land on Home, or on Chat, or anywhere the room never mounts.
 *
 * So this lives at the SHELL, which mounts on every route: any time the app is
 * not in a set-room studio and a flag is still set, put that panel back and
 * clear it. Idempotent, and it shares `restoreFromFocus` with the room hook, so
 * there is one restore rule rather than two that can disagree — whichever runs
 * first does the work and the other sees a cleared flag.
 *
 * Below the sidebar's breakpoint it does NOTHING, including no clearing: a
 * phone-width reload must not spend the memory of a desktop-width collapse the
 * student has not seen undone yet. That is why it also LISTENS to the
 * breakpoint rather than only sampling it — a student who reloaded a studio on
 * a narrow window and then widened it would otherwise keep a collapsed sidebar
 * and an unspent flag until something unrelated re-rendered the shell.
 */
export function useFocusStandDownRestore(focus: boolean): void {
  const stoodDown = useUIStore((s) => s.focusStoodDown);

  useEffect(() => {
    if (focus) return;
    const restore = () => {
      if (!shellSidebarIsAColumn()) return;
      for (const panel of PANELS) {
        if (useUIStore.getState().focusStoodDown[panel]) {
          useUIStore.getState().restoreFromFocus(panel);
        }
      }
    };
    restore();
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(SHELL_SIDEBAR_COLUMN_QUERY);
    mq.addEventListener('change', restore);
    return () => mq.removeEventListener('change', restore);
  }, [focus, stoodDown]);
}

export default useFocusSidebarCollapse;
