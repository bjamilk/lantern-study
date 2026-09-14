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
 * The order StudyFetch runs its own grid in, with Lantern's four extra doors
 * folded into the same list rather than left as orphan pills underneath.
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

/** Always on the wall. The rest live behind Show all. */
export const OWN_WAY_FEATURED_IDS: readonly StudySetHomeToolId[] = [
  'import',
  'quiz',
  'cards',
  'ask',
  'lesson',
  'recap',
  'lecture',
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
      className="inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2 text-left text-caption font-medium text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
    >
      <AppIcon name={tool.icon} size={20} className={`shrink-0 ${FEATURE_INK_TEXT[tool.feature]}`} />
      <span className="min-w-0 truncate">{tool.label}</span>
    </button>
  );
}

/**
 * Compact Show all, parked beside the section heading so the wall stays
 * seven doors. The menu is portaled, so it cannot stretch the chat rail.
 */
export const OwnWayShowAll: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const more = toolsFor(OWN_WAY_TOOL_ORDER.filter((id) => !OWN_WAY_FEATURED_IDS.includes(id)));
  const [open, setOpen] = useState(false);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        aria-label="Show all study options"
        className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption font-medium text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
      >
        <span>Show all</span>
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

/** The seven everyday doors. Show all lives next to the heading, not here. */
export const OwnWayGrid: React.FC<OwnWayGridProps> = ({ onTool }) => {
  const featured = toolsFor(OWN_WAY_FEATURED_IDS);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {featured.map((tool) => (
        <ToolButton key={tool.id} tool={tool} onTool={onTool} />
      ))}
    </div>
  );
};

export default OwnWayGrid;
