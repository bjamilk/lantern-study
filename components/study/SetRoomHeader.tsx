import React, { useEffect, useRef, useState } from 'react';
import {
  STUDY_SET_MODES,
  examHeaderCountdown,
  type StudySetMode,
  type StudySetPlanProgress,
} from '@lantern/shared';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FEATURE_INK_BG, FEATURE_TINT_BG } from '../ui/featureClasses';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';
import { SetTile } from './SetRoomTile';

export interface SetRoomHeaderMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

/**
 * The three numbers, in the reference's order, each with its own 16px glyph.
 *
 * They were a run of bare numerals on one quiet line, which reads as a
 * sentence rather than as three separate facts — and `covered` and `mastered`
 * mean different things, so a student has to be able to find one of them
 * without reading the other two.
 */
const STAT_ICONS: Record<'topics' | 'covered' | 'mastered', AppIconName> = {
  topics: 'list',
  covered: 'checkmark-circle',
  mastered: 'trophy',
};

/**
 * A 32px control with a 44px hit target, which is the whole reason this class
 * exists rather than an `h-11 w-11`: the reference's icon buttons are 32×32
 * and making them physically bigger would be a different design, so the extra
 * 12px is a transparent pseudo-element that the pointer and the touch screen
 * can both find. `relative` + `after:absolute` only — nothing reflows.
 */
const ICON_BUTTON_32 =
  'relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' +
  "after:absolute after:content-[''] after:-inset-1.5 " +
  'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40';

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
   * The set's own exam date, drawn as "Exam in 23 days" in the stats row.
   *
   * In the STATS row rather than beside the title because it is a fact about
   * the set's state, like the topic counts, and the title row is the set as an
   * object. A past date draws nothing (`examHeaderCountdown` returns null) —
   * the date is still listed, struck through, in the set's exam rows, and a
   * header permanently reading "Exam in -40 days" is noise nobody can clear.
   */
  examDate?: string | null;
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
  /**
   * `home` is the set's own front door: a 64px tile and the stats row under
   * the title, as measured. `compact` is the same header worn while a studio
   * is open, where the set is a label rather than the subject — a 64px tile
   * and a progress bar over a quiz would be a second page header.
   */
  variant?: 'home' | 'compact';
  /**
   * The set's study mode, and the way to change it. Both optional: a caller
   * with no set row in hand draws the stats row without the Mode control
   * rather than drawing a control that cannot save.
   */
  mode?: StudySetMode | null;
  onSelectMode?: (mode: StudySetMode) => void;
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
  examDate,
  onOpenSettings,
  menu,
  controls,
  variant = 'compact',
  mode,
  onSelectMode,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const home = variant === 'home';
  const activeMode = STUDY_SET_MODES.find((item) => item.id === (mode || 'standard'));

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

  const examCountdown = examHeaderCountdown(examDate ?? null);

  const statsRow =
    progress || counts || examCountdown ? (
      // 38px high, as measured: the three counts with their own glyphs, the
      // bar, and Mode. A ROW rather than a line of prose under the title —
      // "covered" and "mastered" are different facts and a student has to be
      // able to find one without reading the other two.
      <div
        data-testid="set-room-stats"
        className="mt-1 flex min-h-[38px] flex-wrap items-center gap-x-4 gap-y-1 text-caption text-lantern-text-secondary"
      >
        {progress ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <AppIcon name={STAT_ICONS.topics} size={16} aria-hidden className="shrink-0" />
              <span className="tabular-nums text-lantern-text">{progress.topics}</span> Topics
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AppIcon name={STAT_ICONS.covered} size={16} aria-hidden className="shrink-0" />
              <span className="tabular-nums text-lantern-text">{progress.covered}</span> Covered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AppIcon name={STAT_ICONS.mastered} size={16} aria-hidden className="shrink-0" />
              <span className="tabular-nums text-lantern-text">{progress.mastered}</span> Mastered
            </span>
          </>
        ) : counts ? (
          <span>{counts}</span>
        ) : null}
        {examCountdown ? (
          <span
            data-testid="set-room-exam-countdown"
            className="inline-flex items-center gap-1.5 font-medium text-lantern-text"
          >
            <AppIcon name="calendar" size={16} aria-hidden className="shrink-0" />
            {examCountdown}
          </span>
        ) : null}
        {percent === null ? null : (
          <span className="inline-flex min-w-[8rem] flex-1 items-center gap-2">
            <span
              className={`h-1.5 min-w-0 flex-1 overflow-hidden rounded-full ${FEATURE_TINT_BG.ai}`}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Topics covered"
            >
              {/* `motion-reduce:transition-none`: the bar grows as topics are
                  covered, and a student who asked for less motion gets the new
                  width without the slide. */}
              <span
                className={`block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${FEATURE_INK_BG.ai}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="tabular-nums">{percent}%</span>
          </span>
        )}
        {onSelectMode && activeMode ? (
          <Menu open={modeOpen} onOpenChange={setModeOpen}>
            <MenuTrigger
              aria-label={`Mode: ${activeMode.label}. Change study mode`}
              title={`Mode: ${activeMode.label}`}
              className={ICON_BUTTON_32}
            >
              <AppIcon name="ellipsis-vertical" size={16} />
            </MenuTrigger>
            <MenuContent align="end" placement="bottom">
              {STUDY_SET_MODES.map((item) => (
                <MenuItem
                  key={item.id}
                  title={item.promise}
                  onSelect={() => onSelectMode(item.id)}
                  icon={
                    <AppIcon
                      name={item.id === activeMode.id ? 'radio-button-on' : 'radio-button-off'}
                      size={16}
                      className="shrink-0"
                    />
                  }
                >
                  {item.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
    ) : null;

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
            size={home ? 64 : 40}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="text-title text-lantern-text truncate">{title}</h1>
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Study set settings"
                className={ICON_BUTTON_32}
              >
                <AppIcon name="settings" size={16} />
              </button>
            </div>
            {statsRow}
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
              className={ICON_BUTTON_32}
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
