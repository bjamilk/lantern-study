import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';
import { shellSidebarIsAColumn } from '../components/layout/shellSideColumn';

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
 * TRADE-OFF, KNOWN. Both flags are persisted (`ui-storage`). Closing the tab
 * mid-studio skips React's unmount, so the nav is still stood down on the next
 * visit. One click each restores it, and the alternative — a second,
 * non-persisted copy of both flags for the Sidebar to read — is a larger change
 * than the papercut is worth.
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
  const ours = useRef({ sidebar: false, chats: false });

  // The student's own toggle wins. Declared BEFORE the enter/leave effect so
  // that on the render where focus turns on it runs first and sees the memory
  // still unset, rather than clearing the bit the next effect is about to set.
  useEffect(() => {
    if (!focus) return;
    if (sidebarExpanded) ours.current.sidebar = false;
    if (chatsOpen) ours.current.chats = false;
  }, [focus, sidebarExpanded, chatsOpen]);

  useEffect(() => {
    if (!focus || !shellSidebarIsAColumn()) return;
    const memory = ours.current;
    if (useUIStore.getState().isSidebarExpanded) {
      memory.sidebar = true;
      useUIStore.getState().toggleSidebar();
    }
    if (useUIStore.getState().isChatsSectionExpanded) {
      memory.chats = true;
      useUIStore.getState().setChatsSectionExpanded(false);
    }
    return () => {
      if (memory.sidebar) {
        memory.sidebar = false;
        if (!useUIStore.getState().isSidebarExpanded) useUIStore.getState().toggleSidebar();
      }
      if (memory.chats) {
        memory.chats = false;
        if (!useUIStore.getState().isChatsSectionExpanded) {
          useUIStore.getState().setChatsSectionExpanded(true);
        }
      }
    };
  }, [focus]);
}

export default useFocusSidebarCollapse;
