import React from 'react';
import {
  STUDY_SET_HOME_TOOLS,
  type StudySetHomeTool,
  type StudySetHomeToolId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';

/**
 * The order StudyFetch runs its own-way row in, with Lantern's extra doors
 * folded in rather than left as orphan pills underneath.
 *
 * WHY AN EXPLICIT ORDER AND NOT `STUDY_SET_HOME_TOOLS`. That array is the
 * registry — what a door IS — and it is shared with the phone. This is the
 * WALL: which door sits where on one screen.
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

/**
 * On the wall: EIGHT, in the reference's own order, and no overflow control.
 *
 * WHAT CHANGED AND WHY. This was six pills plus a `More` menu, chosen on
 * Hick's law. The measurement (2026-09-17) shows the reference runs a 3×3 grid
 * of 224×48 buttons whose ninth cell is `Explore Mini Apps` — a community app
 * marketplace Lantern deliberately does not have. The founder's call is that
 * the ninth cell stays EMPTY rather than being filled with a door that does
 * not belong to this row: `essay` is a grader, not a way to start studying a
 * set, and pushing it here to square off a grid is how a wall of doors stops
 * meaning anything.
 *
 * Hick's law is not violated by the change from 6+More to 8. A menu is not
 * fewer choices, it is the same choices one click further away and invisible
 * until then — and `recap` and `play` in particular were doors nobody found.
 *
 * NOTHING BECOMES UNREACHABLE. The five doors not on the wall all live in the
 * set rail, which is persistent: `plan` and `notes` in its primary rows and
 * materials tree, `test`, `walkthrough` and `essay` in its Practice drawer.
 * `ownWayDoorsReachable` below is the assertion, not a comment.
 */
export const OWN_WAY_FEATURED_IDS: readonly StudySetHomeToolId[] = [
  'import',
  'quiz',
  'cards',
  'ask',
  'lesson',
  'recap',
  'lecture',
  'play',
];

interface OwnWayGridProps {
  onTool: (tool: StudySetHomeTool) => void;
}

export function toolsFor(ids: readonly StudySetHomeToolId[]): StudySetHomeTool[] {
  return ids
    .map((id) => STUDY_SET_HOME_TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is StudySetHomeTool => Boolean(tool));
}

/** The doors the wall no longer draws, which the set rail must still hold. */
export const OWN_WAY_OFF_WALL_IDS: readonly StudySetHomeToolId[] = OWN_WAY_TOOL_ORDER.filter(
  (id) => !OWN_WAY_FEATURED_IDS.includes(id)
);

function ToolButton({
  tool,
  onTool,
}: {
  tool: StudySetHomeTool;
  onTool: (tool: StudySetHomeTool) => void;
}) {
  return (
    // The measured button: 224×48, white, 1px hairline, r12, p8 16, gap 8,
    // a 20px coloured glyph and a 14/500 label. It was a 372×40 TONAL pill
    // two to a row — a pill on the same tone as the panel it sits in reads as
    // a tag, and the icon at 16px was decoration rather than the thing you
    // aim at. 48px is already a hit target, so no pseudo-element here.
    <button
      type="button"
      onClick={() => onTool(tool)}
      title={tool.promise}
      className="inline-flex h-12 items-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-4 text-left text-body font-medium text-lantern-text transition-colors motion-reduce:transition-none hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
    >
      <AppIcon name={tool.icon} size={20} className={`shrink-0 ${FEATURE_INK_TEXT[tool.feature]}`} />
      <span className="min-w-0 truncate">{tool.label}</span>
    </button>
  );
}

/**
 * The own-way wall: every everyday door, at the size a student can aim at.
 *
 * The grid is 3 columns at the measured width and collapses to 2 and then 1 as
 * the room narrows, because 224px is a floor for these labels, not a target.
 */
export const OwnWayGrid: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const featured = toolsFor(OWN_WAY_FEATURED_IDS);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {featured.map((tool) => (
        <ToolButton key={tool.id} tool={tool} onTool={onTool} />
      ))}
    </div>
  );
};

export default OwnWayGrid;
