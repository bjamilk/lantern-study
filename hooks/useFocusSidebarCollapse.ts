import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/uiStore';

/**
 * Collapse the global sidebar while the student is inside a studio, and give
 * it back when they leave — without ever fighting them for it.
 *
 * THE POINT. Focus mode's whole claim is that the screen goes to studying, and
 * a 240px column of seven destinations beside a quiz is the largest single
 * thing left arguing with that. The sidebar is not REMOVED, though: it is the
 * app's navigation, and a studio is not a different app. Collapsing is
 * reversible in one click and the student can undo it at any moment.
 *
 * THE RULE, AND WHY IT IS A MEMORY RATHER THAN A SET/RESTORE PAIR. Naively
 * collapsing on enter and expanding on leave loses an argument with the
 * student: someone who deliberately opens the sidebar mid-quiz would find it
 * re-opened for them on exit (harmless) — but someone whose sidebar was
 * ALREADY collapsed before they started would find it forced open. So the hook
 * remembers one bit: "this collapse was ours". It is set only when we actually
 * collapsed an expanded sidebar, cleared the moment the student expands it
 * themselves, and it is what the restore is conditional on.
 *
 * Below `lg` the sidebar is an overlay the shell already hides, so the hook
 * does nothing at all — collapsing an overlay that is not drawn would make the
 * icon rail appear on the next resize for no reason a student could explain.
 *
 * Deliberately NOT animated: there is nothing here that respects
 * `prefers-reduced-motion` because there is no motion to reduce. The sidebar's
 * own transition is the shell's.
 */
export const FOCUS_SIDEBAR_QUERY = '(min-width: 1024px)';

function atDesktopWidth(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(FOCUS_SIDEBAR_QUERY).matches;
}

export function useFocusSidebarCollapse(focus: boolean): void {
  const expanded = useUIStore((s) => s.isSidebarExpanded);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Latest values, read from inside an effect that must not re-run when they
  // change — the enter/leave effect is keyed on `focus` alone, because a
  // re-run on `expanded` would collapse the sidebar again the instant the
  // student opened it.
  const expandedRef = useRef(expanded);
  const toggleRef = useRef(toggleSidebar);
  const oursRef = useRef(false);
  useEffect(() => {
    expandedRef.current = expanded;
    toggleRef.current = toggleSidebar;
  });

  // The student's own toggle wins. Declared BEFORE the enter/leave effect so
  // that on the render where focus turns on it runs first and sees the memory
  // still unset, rather than clearing the bit the next effect is about to set.
  useEffect(() => {
    if (focus && expanded) oursRef.current = false;
  }, [focus, expanded]);

  useEffect(() => {
    if (!focus || !atDesktopWidth()) return;
    if (expandedRef.current) {
      oursRef.current = true;
      toggleRef.current();
    }
    return () => {
      if (!oursRef.current) return;
      oursRef.current = false;
      if (!expandedRef.current) toggleRef.current();
    };
  }, [focus]);
}

export default useFocusSidebarCollapse;
