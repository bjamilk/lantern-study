import React, { useEffect, useRef, useState } from 'react';
import type { StudySetPlanProgress } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_BG, FEATURE_TINT_BG } from '../ui/featureClasses';
import { SetTile } from './SetRoomTile';

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
  /**
   * The set's saved tile pick. Without these the header derived its art from
   * the id hash, so a student who chose a hue and a glyph saw the choice on
   * the hub card and nowhere else — the room they actually study in still
   * showed the old pastel. Optional for the same reason `coverPath` is.
   */
  tileHue?: string | null;
  tileGlyph?: string | null;
  /** Null while the set has no plan and no materials to derive one from. */
  progress: StudySetPlanProgress | null;
  /** The one-line fallback when there is no plan: "4 notes · 2 decks". */
  counts?: string;
  /**
   * The set's stored visibility, passed only so a caller that still wants it
   * for a share toast can keep threading it. The header no longer draws Share
   * itself — that lives in the kebab, so the title row stays one object.
   */
  visibility?: 'private' | 'public' | string | null;
  /** Timer and chat — the room's own controls. */
  controls?: React.ReactNode;
  /** The gear. Kept OUT of the kebab: it is the one setting students look for. */
  onOpenSettings: () => void;
  menu: readonly SetRoomHeaderMenuItem[];
}

/**
 * The set room's header, drawn as an OBJECT rather than as a page title.
 *
 * StudyFetch keeps this to tile + name + a quiet count line. A bordered chip
 * strip, a labelled Share pill and a second set switcher were a second
 * toolbar sitting on top of the set rail — Hick's law says those choices
 * already have a home (rail switcher, kebab Share, settings gear).
 */
export const SetRoomHeader: React.FC<SetRoomHeaderProps> = ({
  setId,
  title,
  coverPath,
  tileHue,
  tileGlyph,
  progress,
  counts,
  onOpenSettings,
  menu,
  controls,
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
    <header className="mb-2">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SetTile
            setId={setId}
            title={title}
            coverPath={coverPath}
            tileHue={tileHue}
            tileGlyph={tileGlyph}
            size={40}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="text-title text-lantern-text truncate">{title}</h1>
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Study set settings"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
              >
                <AppIcon name="settings" size={16} />
              </button>
            </div>
            {progress || counts ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-lantern-text-secondary">
                {progress ? (
                  <>
                    <span>
                      <span className="tabular-nums text-lantern-text">{progress.topics}</span> topics
                    </span>
                    <span>
                      <span className="tabular-nums text-lantern-text">{progress.covered}</span> covered
                    </span>
                    <span>
                      <span className="tabular-nums text-lantern-text">{progress.mastered}</span> mastered
                    </span>
                  </>
                ) : (
                  <span>{counts}</span>
                )}
                {percent === null ? null : (
                  <span className="inline-flex w-24 items-center gap-1.5">
                    <span
                      className={`h-1 min-w-0 flex-1 overflow-hidden rounded-full ${FEATURE_TINT_BG.ai}`}
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
                    <span className="tabular-nums">{percent}%</span>
                  </span>
                )}
              </p>
            ) : null}
          </div>
        </div>
        {controls ? <div className="flex shrink-0 items-center gap-2">{controls}</div> : null}
        {menu.length > 0 ? (
          <div className="relative shrink-0" ref={menuRef}>
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
    </header>
  );
};

export default SetRoomHeader;
