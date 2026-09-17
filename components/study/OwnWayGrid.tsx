import React, { useState } from 'react';
import {
  STUDY_SET_HOME_TOOLS,
  type StudySetHomeTool,
  type StudySetHomeToolId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';

/**
 * The order StudyFetch runs its own-way row in, with Lantern's extra doors
 * folded in rather than left as orphan pills underneath.
 *
 * WHY AN EXPLICIT ORDER AND NOT `STUDY_SET_HOME_TOOLS`. That array is the
 * registry — what a door IS — and it is shared with the phone. This is the
 * WALL: which door sits where on one screen.
 */
export const OWN_WAY_TOOL_ORDER: readonly StudySetHomeToolId[] = [
  'quiz',
  'cards',
  'ask',
  'lesson',
  'lecture',
  'import',
  'recap',
  'play',
  'essay',
  'notes',
  'walkthrough',
  'test',
  'plan',
];

/**
 * On the wall. Six, not thirteen: Hick's law.
 *
 * ORDERED BY WHAT A STUDENT ACTUALLY OPENS, not by the pipeline. `import`
 * (Add materials) led the row because it is what you do FIRST — once. Every
 * visit after that it is a door the student reads past to reach the quiz, so
 * it moves to the end and the two doors that carry the most traffic lead.
 * `recap` (Start listening) takes its place behind More: it is the same
 * generated-audio promise as `lecture` from the student's side, and the
 * cheaper one to reach from a note.
 *
 * Arcade, essay, notes, walkthrough, test and plan already live in the set
 * rail as well as in More.
 */
export const OWN_WAY_FEATURED_IDS: readonly StudySetHomeToolId[] = [
  'quiz',
  'cards',
  'ask',
  'lesson',
  'lecture',
  'import',
];

interface OwnWayGridProps {
  onTool: (tool: StudySetHomeTool) => void;
}

function toolsFor(ids: readonly StudySetHomeToolId[]): StudySetHomeTool[] {
  return ids
    .map((id) => STUDY_SET_HOME_TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is StudySetHomeTool => Boolean(tool));
}

function ToolButton({
  tool,
  onTool,
}: {
  tool: StudySetHomeTool;
  onTool: (tool: StudySetHomeTool) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onTool(tool)}
      title={tool.promise}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-lantern-background-secondary px-3 text-left text-caption font-medium text-lantern-text hover:bg-lantern-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
    >
      <AppIcon name={tool.icon} size={16} className={`shrink-0 ${FEATURE_INK_TEXT[tool.feature]}`} />
      <span className="min-w-0 truncate">{tool.label}</span>
    </button>
  );
}

/** Overflow doors. Parked as the last cell so the wall stays six pills. */
export const OwnWayShowAll: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const more = toolsFor(OWN_WAY_TOOL_ORDER.filter((id) => !OWN_WAY_FEATURED_IDS.includes(id)));
  const [open, setOpen] = useState(false);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        aria-label="More study options"
        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-lantern-background-secondary px-3 text-caption font-medium text-lantern-text hover:bg-lantern-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
      >
        <span>More</span>
        <AppIcon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          className="shrink-0 text-lantern-text-secondary"
        />
      </MenuTrigger>
      <MenuContent align="start" placement="bottom">
        {more.map((tool) => (
          <MenuItem
            key={tool.id}
            title={tool.promise}
            onSelect={() => onTool(tool)}
            icon={
              <AppIcon name={tool.icon} size={18} className={`shrink-0 ${FEATURE_INK_TEXT[tool.feature]}`} />
            }
          >
            {tool.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
};

/**
 * Compact own-way wall. StudyFetch draws these as a two-column row of small
 * pills under "Or start learning your own way", not as a second set of
 * illustrated doors. The recommended cards already named the next action.
 */
export const OwnWayGrid: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const featured = toolsFor(OWN_WAY_FEATURED_IDS);
  return (
    <div className="grid grid-cols-2 gap-2">
      {featured.map((tool) => (
        <ToolButton key={tool.id} tool={tool} onTool={onTool} />
      ))}
      <OwnWayShowAll onTool={onTool} />
    </div>
  );
};

export default OwnWayGrid;
