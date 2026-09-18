import React, { useEffect, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import type { SetRoomHeaderMenuItem } from './SetRoomHeader';

interface SetRoomTopBarProps {
  /** The set's own name — the last crumb, and the one that is not a link. */
  setName: string;
  /** Back to the set picker. */
  onOpenStudy: () => void;
  onShare: () => void;
  /** The room's timer pill, rendered by the caller so it keeps its own state. */
  timer?: React.ReactNode;
  /**
   * Chat, and ONLY when there is no companion rail to open it from. Two chat
   * buttons on one screen is the bug #126 removed; the rail's own row is the
   * control whenever a rail exists.
   */
  onOpenChat?: () => void;
  menu: readonly SetRoomHeaderMenuItem[];
}

/**
 * The set room's top bar: where you are on the left, what you can do to the
 * whole set on the right.
 *
 * WHAT IT REPLACES (measured 2026-09-17,
 * docs/studyfetch-mysets-2026-09-17/01-set-home.md §Top bar). Lantern's set
 * room opened on a breadcrumb strip and a Study/Library tab row, and then put
 * the timer, Chat and the kebab down in the title row beside the set's name.
 * So the bar at the top of the window said nothing you could act on, and the
 * object header underneath was carrying a toolbar. The reference does the
 * opposite and it is the right way round: SET-level actions (Share, the timer,
 * the kebab) belong to the room, not to the set's name, and the header is then
 * free to be the set as an object — tile, title, gear, stats.
 *
 * Share is the one action here that was previously buried in the kebab, and it
 * takes the reference's distinguishing anatomy: a 1px INK border rather than
 * the hairline every other pill has, which is the page's only "this is the
 * thing you do with a set" mark.
 *
 * THE LIBRARY TAB IS NOT LOST. The Study/Library tab row this replaces inside
 * a set is still reachable two ways from here — the kebab's `All materials`
 * and the rail's `Materials · View all` — and a tab row that switches to a
 * different DESTINATION was always a strange thing to leave sitting inside a
 * room the student had already entered.
 *
 * The focus bar (#104) is untouched: a studio has its own chrome and this bar
 * is not drawn there.
 */
export const SetRoomTopBar: React.FC<SetRoomTopBarProps> = ({
  setName,
  onOpenStudy,
  onShare,
  timer,
  onOpenChat,
  menu,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div
      data-testid="set-room-top-bar"
      className="flex min-h-[52px] items-center gap-2 border-b border-lantern-border px-4 md:px-6"
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          onClick={onOpenStudy}
          className="shrink-0 rounded-lg px-1 py-1 text-body text-lantern-text-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          Study
        </button>
        <AppIcon
          name="chevron-forward"
          size={14}
          aria-hidden
          className="shrink-0 text-lantern-text-tertiary"
        />
        <span className="min-w-0 truncate text-body font-medium text-lantern-text">{setName}</span>
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        {/* 85×32 with the INK border — the one control on the page drawn in
            the theme's ink rather than the hairline. 44px hit target from the
            pseudo-element, as everywhere else in this wave. */}
        <button
          type="button"
          onClick={onShare}
          className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-lantern-ink bg-lantern-surface px-3 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          <AppIcon name="share-social" size={16} aria-hidden />
          Share
        </button>

        {timer}

        {onOpenChat ? (
          <button
            type="button"
            onClick={onOpenChat}
            aria-label="Chat"
            className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
          >
            <AppIcon name="chatbubbles" size={16} aria-hidden />
            Chat
          </button>
        ) : null}

        {menu.length > 0 ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Study set actions"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-lantern-text-secondary after:absolute after:-inset-1.5 after:content-[''] hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
            >
              <AppIcon name="ellipsis-vertical" size={18} />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-2 w-52 rounded-2xl border border-lantern-border bg-lantern-surface p-1 shadow-lantern-lg"
              >
                {menu.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect();
                    }}
                    className="block w-full min-h-[40px] rounded-xl px-3 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SetRoomTopBar;
