import React from 'react';
import {
  STUDY_SET_HOME_TOOLS,
  type StudySetHomeTool,
  type StudySetHomeToolId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';

/**
 * The order StudyFetch runs its own grid in, with Lantern's four extra doors
 * folded into the same list rather than left as orphan pills underneath.
 *
 * WHY AN EXPLICIT ORDER AND NOT `STUDY_SET_HOME_TOOLS`. That array is the
 * registry — what a door IS — and it is shared with the phone. This is the
 * WALL: which door sits where on one screen. They were the same list only by
 * accident, and the accident is what produced a grid whose first four entries
 * were doors and whose last three were pills.
 */
export const OWN_WAY_TOOL_ORDER: readonly StudySetHomeToolId[] = [
  'import',
  'quiz',
  'cards',
  'ask',
  'lesson',
  'recap',
  'lecture',
  'play',
  'essay',
  'notes',
  'walkthrough',
  'test',
  'plan',
];

interface OwnWayGridProps {
  onTool: (tool: StudySetHomeTool) => void;
}

/**
 * "Start learning your own way" — every door in the set, in one visual language.
 *
 * WHAT THIS REPLACES, AND WHY IT IS SMALLER ON PURPOSE. The grid was ten
 * `DoorTile`s — a full-bleed pastel header ~112px tall, a big glyph, a title, a
 * one-line description and a repeated small glyph in a footer — followed by
 * three little outlined pills for the doors that did not fit. Two visual
 * languages for one job, about 900px of screen for thirteen links, and ten
 * pastel panels shouting at once, at which point the hue has stopped telling
 * anybody anything.
 *
 * StudyFetch's answer is a 3x3 of OUTLINED TEXT BUTTONS: a small glyph in the
 * feature's own ink, a noun label, a hairline border, no description, no fill.
 * The descriptions are not lost — every button keeps its promise as a `title`,
 * which is where a one-line clarification belongs when the label is already a
 * noun a student recognises.
 *
 * 3 columns from `sm` up (the reference's shape), 2 on a narrow phone — the
 * brief's "2x5 on narrow" generalised, since Lantern has thirteen doors to the
 * reference's nine.
 */
export const OwnWayGrid: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const tools = OWN_WAY_TOOL_ORDER.map((id) =>
    STUDY_SET_HOME_TOOLS.find((tool) => tool.id === id)
  ).filter((tool): tool is StudySetHomeTool => Boolean(tool));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          onClick={() => onTool(tool)}
          title={tool.promise}
          className="inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2 text-left text-caption font-medium text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          <AppIcon
            name={tool.icon}
            size={20}
            className={`shrink-0 ${FEATURE_INK_TEXT[tool.feature]}`}
          />
          <span className="min-w-0 truncate">{tool.label}</span>
        </button>
      ))}
    </div>
  );
};

export default OwnWayGrid;
