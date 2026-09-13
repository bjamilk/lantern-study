import React, { useEffect, useRef, useState } from 'react';
import type { StudySetPlanProgress } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { Button } from '../ui';
import { FEATURE_INK_BG, FEATURE_TINT_BG } from '../ui/featureClasses';
import { SetTile } from './SetRoomTile';
import { shareStudySet } from './shareStudySet';

export interface SetRoomHeaderMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

interface SetRoomHeaderProps {
  /** The set's id, so its identity tile matches the one on its card. */
  setId: string;
  title: string;
  /**
   * The set's cover. Optional so a caller that has no set row in hand keeps
   * today's pastel tile rather than failing to compile.
   */
  coverPath?: string | null;
  /** Null while the set has no plan and no materials to derive one from. */
  progress: StudySetPlanProgress | null;
  /** The one-line fallback when there is no plan: "4 notes · 2 decks". */
  counts?: string;
  /**
   * The set's stored visibility, passed only so the `Share` toast can be
   * specific. It does not gate the pill: the link is copyable either way, and
   * `public` grants no access today (see `shareLink.ts`).
   */
  visibility?: 'private' | 'public' | string | null;
  /** Timer pill, switcher pill, chat — the room's own controls. */
  controls?: React.ReactNode;
  /** The gear. Kept OUT of the kebab: it is the one setting students look for. */
  onOpenSettings: () => void;
  menu: readonly SetRoomHeaderMenuItem[];
}

/**
 * The set room's header, drawn as an OBJECT rather than as a page title.
 *
 * WHAT IT REPLACES. A generic `ScreenHeader` — a bare serif title and a row of
 * buttons — with the set's stats printed under it as one line of grey text
 * (`4 topics · 0 covered · 0 mastered`) and a native `<select>` for switching
 * sets. Read next to StudyFetch the difference is not decoration: their header
 * says "this is a thing you own and here is how far into it you are" with a
 * coloured identity tile and a bordered chip strip, and Lantern's said "you are
 * on a page".
 *
 * So: tile + serif title + gear on the first row; a bordered strip of
 * `📖 N Topics · ✓ N Covered · ✓ N Mastered` chips with the progress bar and the
 * kebab on the second. The room's own controls (timer, switcher) sit opposite
 * the title, where they were.
 *
 * The progress bar is drawn in the AI feature's violet-on-lilac pair (which is
 * literally StudyFetch's #f5d5ff track), not in the app's ink: this is the one
 * thing on the header that is a MEASUREMENT, and a black bar on a white strip
 * reads as a rule rather than as progress.
 */
export const SetRoomHeader: React.FC<SetRoomHeaderProps> = ({
  setId,
  title,
  coverPath,
  progress,
  counts,
  visibility,
  controls,
  onOpenSettings,
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

  const percent =
    progress && progress.topics > 0
      ? Math.round((progress.covered / progress.topics) * 100)
      : null;

  return (
    <header className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <SetTile setId={setId} title={title} coverPath={coverPath} size={44} />
          <h1 className="text-title text-lantern-text truncate">{title}</h1>
          {/* Share sits OUTSIDE the kebab and outside settings, where the
              reference puts it: copying a set's link was buried three levels
              deep (gear -> modal -> "Copy link"), which is why nobody found
              it. The secondary skin is the app's own outline pill — a light
              face and one hairline — so this does not compete with the room's
              real primary actions. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void shareStudySet({ setId, title, visibility })}
          >
            <AppIcon name="share" size={16} />
            Share
          </Button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Study set settings"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
          >
            <AppIcon name="settings" size={18} />
          </button>
        </div>
        {controls ? <div className="flex flex-wrap items-center gap-2">{controls}</div> : null}
      </div>

      {progress || counts ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2.5">
          {progress ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-caption text-lantern-text">
                <AppIcon name="book" size={16} className="text-lantern-text-secondary" />
                <span className="tabular-nums font-semibold">{progress.topics}</span> Topics
              </span>
              <span className="inline-flex items-center gap-1.5 text-caption text-lantern-text">
                <AppIcon name="checkmark" size={16} className="text-lantern-text-secondary" />
                <span className="tabular-nums font-semibold">{progress.covered}</span> Covered
              </span>
              <span className="inline-flex items-center gap-1.5 text-caption text-lantern-text">
                <AppIcon name="checkmark-done" size={16} className="text-lantern-text-secondary" />
                <span className="tabular-nums font-semibold">{progress.mastered}</span> Mastered
              </span>
            </>
          ) : (
            <span className="text-caption text-lantern-text-secondary">{counts}</span>
          )}

          {percent === null ? null : (
            <span className="flex min-w-[6rem] flex-1 items-center gap-2">
              <span
                className={`h-1.5 flex-1 overflow-hidden rounded-full ${FEATURE_TINT_BG.ai}`}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Topics covered"
              >
                <span
                  className={`block h-full rounded-full ${FEATURE_INK_BG.ai}`}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-caption tabular-nums text-lantern-text-secondary">{percent}%</span>
            </span>
          )}

          {menu.length > 0 ? (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Study set actions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
              >
                <AppIcon name="ellipsis-vertical" size={18} />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-30 mt-2 w-52 rounded-2xl border border-lantern-border bg-lantern-surface p-1"
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
                      className="block w-full min-h-[40px] rounded-xl px-3 text-left text-caption text-lantern-text hover:bg-lantern-background-secondary"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
};

export default SetRoomHeader;
