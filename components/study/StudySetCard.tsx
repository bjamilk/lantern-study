import React, { useState } from 'react';
import {
  relativeStudiedLabel,
  setCountChips,
  setTileArt,
  studySetLabel,
  type SetTileGlyph,
  type SetTileHue,
  type StudySet,
  type StudySetTopic,
} from '@lantern/shared';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FeatureDisc, Menu, MenuContent, MenuItem, MenuSeparator, MenuSubmenu } from '../ui';
import type { FeatureKey } from '../ui/featureClasses';
import { MenuTrigger } from '../ui/Menu';
import { SetCoverSquare } from './SetRoomTile';
import { shareStudySet } from './shareStudySet';

/**
 * Hue -> feature token. The six pastels the direction names are already in the
 * theme as feature tints (`--color-feature-*-tint`, index.css `:root` and
 * `.dark`), so a set tile reuses them rather than hardcoding a hex that would
 * stay pale-mint on a near-black ground in dark mode:
 *
 *   mint #b9f0e2 -> sets        peach #fef3c7 -> budget
 *   lilac #f5d5ff -> ai         lime  #bcf887 -> flashcards
 *   sky   #bbeef0 -> tests      butter #f9f284 -> recording
 *
 * The hue here is identity (which set is this), never state — the same rule
 * FeatureDisc documents.
 */
const HUE_FEATURE: Record<SetTileHue, FeatureKey> = {
  mint: 'sets',
  peach: 'budget',
  lilac: 'ai',
  lime: 'flashcards',
  sky: 'tests',
  butter: 'recording',
};

/** The six tile glyphs, in this icon set's names. */
const GLYPH_ICON: Record<SetTileGlyph, AppIconName> = {
  layers: 'layers',
  // No `monitor` in the map; `easel` is the screen/board mark it ships instead.
  monitor: 'easel',
  lightbulb: 'bulb',
  book: 'book',
  flask: 'flask',
  globe: 'globe',
};

/** One glyph per count kind, so a chip row reads without its labels. */
const CHIP_ICON: Record<string, AppIconName> = {
  materials: 'document-text',
  notes: 'create',
  lectures: 'mic',
  decks: 'albums',
  tests: 'clipboard-check',
  quizzes: 'help-circle',
};

/** How many chips fit before the row becomes a smear; the rest become `+N`. */
const MAX_VISIBLE_CHIPS = 4;

export interface StudySetCardProps {
  studySet: StudySet;
  counts: {
    materials?: number;
    notes?: number;
    lectures?: number;
    decks?: number;
    tests?: number;
    quizzes?: number;
  };
  /** 0–100. Omit when the set has no plan to measure against. */
  progressPercent?: number | null;
  /** The topic the set resumes at, when there is one. */
  currentTopic?: StudySetTopic | null;
  /** Folders offered by the kebab's `Move to folder` submenu. */
  folders?: ReadonlyArray<{ id: string; title: string }>;
  onOpen: () => void;
  onEdit: () => void;
  onMoveToFolder?: (folderId: string | null) => void;
  onDelete: () => void;
  /** Injected in tests so a relative label is not wall-clock dependent. */
  now?: Date;
}

/**
 * A study set as an object you can judge at a glance.
 *
 * The card this replaces showed one mint disc, the same glyph on every set,
 * `2 decks`, an absolute date, and — printed bare on the card face — an `Edit`
 * link and a red `Delete` link. Two problems: a set with four notes, two
 * lectures and a deck was indistinguishable from an empty one, and a single
 * mis-click from a list view destroyed a set. So: per-set art, a chip row per
 * artifact type, a relative time, a resume pill, and both actions behind a
 * kebab with a confirm on the destructive one.
 *
 * Flat by construction — a hairline border, no offset shadow. The colour is
 * carried by the pastel tile, which is the reference's own anatomy and the
 * founder's stated preference.
 */
export const StudySetCard: React.FC<StudySetCardProps> = ({
  studySet,
  counts,
  progressPercent = null,
  currentTopic = null,
  folders = [],
  onOpen,
  onEdit,
  onMoveToFolder,
  onDelete,
  now,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = studySetLabel(studySet);
  // The owner's own pick beats the hash; a cover picture still beats both,
  // which `SetCoverSquare` below decides. No new prop: the card already holds
  // the whole set.
  const art = setTileArt(studySet.id, title, {
    hue: studySet.tileHue,
    glyph: studySet.tileGlyph,
  });
  const feature = HUE_FEATURE[art.hue];
  const chips = setCountChips(counts);
  const visible = chips.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = chips.length - visible.length;
  const percent =
    typeof progressPercent === 'number' && Number.isFinite(progressPercent)
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null;

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4 transition-colors hover:border-lantern-text-tertiary">
      {/* The kebab sits ABOVE the open button rather than inside it: a button
          inside a button is invalid markup and the menu's clicks would bubble
          straight into "open the set". */}
      <div className="absolute right-2 top-2 z-10">
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            aria-label={`Actions for ${title}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/50"
          >
            <AppIcon name="ellipsis-vertical" size={18} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<AppIcon name="pencil" size={16} />} onSelect={onEdit}>
              Edit
            </MenuItem>
            {/* Copying a set's link used to require opening its settings
                modal. The card is where a student points at a set, so it is
                where "send me that one" starts. The toast says what the link
                actually does today — see `shareStudySet.ts`. */}
            <MenuItem
              icon={<AppIcon name="share" size={16} />}
              onSelect={() =>
                void shareStudySet({
                  setId: studySet.id,
                  title,
                  visibility: studySet.visibility,
                })
              }
            >
              Share
            </MenuItem>
            {onMoveToFolder ? (
              <MenuSubmenu label="Move to folder" icon={<AppIcon name="folder" size={16} />}>
                <MenuItem
                  className="pl-10"
                  onSelect={() => onMoveToFolder(null)}
                  disabled={!studySet.folderId}
                >
                  No folder
                </MenuItem>
                {folders.map((folder) => (
                  <MenuItem
                    key={folder.id}
                    className="pl-10"
                    onSelect={() => onMoveToFolder(folder.id)}
                    disabled={studySet.folderId === folder.id}
                  >
                    {folder.title}
                  </MenuItem>
                ))}
                {folders.length === 0 ? (
                  <p className="px-10 py-2 text-caption text-lantern-text-tertiary">
                    No folders yet.
                  </p>
                ) : null}
              </MenuSubmenu>
            ) : null}
            <MenuSeparator />
            <MenuItem destructive icon={<AppIcon name="trash" size={16} />} onSelect={onDelete}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-start gap-3 pr-9 text-left"
      >
        {/* The cover, when the set has one, stands exactly where the pastel
            tile stands: same 40px square, same radius, so a shelf of sets with
            and without pictures stays one aligned grid. */}
        <SetCoverSquare
          coverPath={studySet.coverPath}
          alt=""
          fallback={
            <FeatureDisc
              feature={feature}
              icon={<AppIcon name={GLYPH_ICON[art.glyph]} size={20} />}
            />
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-lantern-text">{title}</span>
          {percent !== null ? (
            <span className="mt-2 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-lantern-background-secondary">
                <span
                  className="block h-full rounded-full bg-lantern-ink"
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-caption tabular-nums text-lantern-text-secondary">
                {percent}%
              </span>
            </span>
          ) : null}
        </span>
      </button>

      {visible.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {visible.map((chip, index) => (
            <li
              key={chip.kind}
              className="inline-flex items-center gap-1 rounded-full bg-lantern-background-secondary px-2 py-1 text-caption text-lantern-text-secondary"
            >
              <AppIcon
                name={CHIP_ICON[chip.kind] || 'document-text'}
                size={13}
                className="text-lantern-text-tertiary"
              />
              {/* Only the leading chip spells its noun — the reference's row is
                  `8 Materials · 6 · 3 · 2`, and repeating six nouns is what made
                  the old line unreadable. The full form stays in the title
                  attribute and the sr-only span so nothing is lost to a reader. */}
              <span aria-hidden="true">{index === 0 ? chip.label : chip.count}</span>
              <span className="sr-only">{chip.label}</span>
            </li>
          ))}
          {overflow > 0 ? (
            <li className="inline-flex items-center rounded-full bg-lantern-background-secondary px-2 py-1 text-caption text-lantern-text-tertiary">
              +{overflow}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="text-caption text-lantern-text-tertiary">No materials yet</p>
      )}

      <p className="text-caption text-lantern-text-tertiary">
        Last studied · {relativeStudiedLabel(studySet.lastStudiedAt, now)}
      </p>

      {currentTopic ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-2 rounded-xl bg-lantern-feature-sets-tint px-3 py-2 text-left text-caption font-medium text-lantern-ink dark:text-lantern-feature-sets-ink"
        >
          <AppIcon name="play" size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{currentTopic.title}</span>
        </button>
      ) : null}
    </div>
  );
};

export default StudySetCard;
