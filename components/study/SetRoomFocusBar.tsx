import React from 'react';
import {
  WORKSPACE_ACTIVITIES,
  type WorkspaceActivity,
  type WorkspaceActivityId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';
import { SetTile } from './SetRoomTile';
import type { SetRoomHeaderMenuItem } from './SetRoomHeader';

/**
 * The set room's FOCUS chrome: one slim bar, and the rest of the screen is the
 * studio.
 *
 * WHAT IT REPLACES. Opening a quiz on production put ~36 interactive controls
 * and a ~540px sticky header block (57% of a 952px window) in front of the
 * first question: the global sidebar, the set rail, a breadcrumb strip, the
 * Study/Library tab bar, the title row with Share and a gear, a chip row with
 * a second set switcher, a stats row with a kebab, eleven tool chips over two
 * rows, and a Materials panel. The student had already chosen "quiz" and was
 * then re-offered every other choice — Hick's law, paid twice.
 *
 * So the bar carries exactly what a student in a studio can still want: out
 * (back to the set), where am I (tile, set name, current tool), somewhere else
 * (the tool menu), how long (the timer), help (chat), and everything rare (the
 * kebab). No stats, no counts, no Share pill, no set switcher: those are the
 * set home's job, one Back press away.
 *
 * VISUAL HEIGHT IS 48px AND HIT TARGETS ARE 44px. Those do not contradict each
 * other — the controls are 44×44 boxes centred in a 48px row, so the bar reads
 * as a hairline strip while every target still clears the touch minimum. Do not
 * "fix" the h-12 by shrinking the buttons.
 */

/**
 * The tool menu, grouped so no list exceeds four rows.
 *
 * Eleven flat entries in a dropdown is the tool-chip strip again in a smaller
 * box. Three headed groups of ≤4 turn one scan of eleven into a scan of three
 * then a scan of four — which is the whole reason the strip came out.
 *
 * `later` activities are filtered at render (there are none today), so a tool
 * that regresses to `later` leaves the menu instead of offering a refusal.
 */
export const FOCUS_TOOL_GROUPS: readonly {
  heading: string;
  ids: readonly WorkspaceActivityId[];
}[] = [
  { heading: 'Learn', ids: ['notes', 'walkthrough', 'lecture', 'recap'] },
  { heading: 'Practise', ids: ['cards', 'quiz', 'test', 'play'] },
  // Tutor is `lesson`: it writes a plan and a draft rather than drilling you,
  // so it sits with Plan and Essay and keeps Practise at four.
  { heading: 'Plan & write', ids: ['plan', 'lesson', 'essay'] },
];

function activityById(id: WorkspaceActivityId): WorkspaceActivity | undefined {
  return WORKSPACE_ACTIVITIES.find((row) => row.id === id);
}

export interface SetRoomFocusBarProps {
  setId: string;
  /** The set's name. The bar is the breadcrumb trail, so it must say it. */
  setName: string;
  coverPath?: string | null;
  tileHue?: string | null;
  tileGlyph?: string | null;
  /** The studio that is open. Its row is the menu's label. */
  activity: WorkspaceActivityId;
  /** Back to the set home. */
  onBack: () => void;
  /** Switch studios — the room's own `handleActivity`, ready tools only. */
  onActivity: (id: WorkspaceActivityId, status: 'ready' | 'later') => void;
  /** `StudySetTimer`, passed as a slot so this file owns no timer state. */
  timer?: React.ReactNode;
  /** Only rendered when the companion rail is NOT docked beside the studio. */
  onOpenChat?: () => void;
  onOpenSettings: () => void;
  /** The room's kebab. `Set settings` is prepended, since the gear is gone. */
  menu: SetRoomHeaderMenuItem[];
}

/** 44×44 inside a 48px bar. Shared so no control drifts below the minimum. */
const ICON_BUTTON =
  'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40';

export const SetRoomFocusBar: React.FC<SetRoomFocusBarProps> = ({
  setId,
  setName,
  coverPath,
  tileHue,
  tileGlyph,
  activity,
  onBack,
  onActivity,
  timer,
  onOpenChat,
  onOpenSettings,
  menu,
}) => {
  const current = activityById(activity);
  const kebab: SetRoomHeaderMenuItem[] = [
    { id: 'settings', label: 'Set settings', onSelect: onOpenSettings },
    ...menu,
  ];

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-lantern-border">
      <button
        type="button"
        onClick={onBack}
        aria-label={`Back to ${setName}`}
        className={ICON_BUTTON}
      >
        <AppIcon name="chevron-back" size={20} />
      </button>

      {/* The trail. Hidden below `sm`, where the phone-width bar needs its
          width for the tool name and the controls, and where Back already
          says where the student came from. */}
      <span className="hidden min-w-0 items-center gap-2 sm:flex">
        <SetTile
          setId={setId}
          title={setName}
          coverPath={coverPath}
          tileHue={tileHue}
          tileGlyph={tileGlyph}
          size={24}
        />
        <span className="min-w-0 truncate text-caption text-lantern-text-secondary">{setName}</span>
        <AppIcon
          name="chevron-forward"
          size={14}
          className="shrink-0 text-lantern-text-tertiary"
          aria-hidden
        />
      </span>

      <Menu>
        <MenuTrigger
          aria-label={`${current?.label ?? 'Tool'} — switch tool`}
          className="inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-full px-2.5 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          {current ? (
            <AppIcon
              name={current.icon}
              size={18}
              className={`shrink-0 ${FEATURE_INK_TEXT[current.feature]}`}
            />
          ) : null}
          <span className="min-w-0 truncate">{current?.label ?? 'Tool'}</span>
          <AppIcon
            name="chevron-down"
            size={14}
            className="shrink-0 text-lantern-text-secondary"
            aria-hidden
          />
        </MenuTrigger>
        <MenuContent align="start" placement="bottom">
          {FOCUS_TOOL_GROUPS.map((group) => {
            const rows = group.ids.flatMap((id) => {
              const row = activityById(id);
              return row && row.status === 'ready' ? [row] : [];
            });
            if (rows.length === 0) return null;
            return (
              <div key={group.heading} role="group" aria-label={group.heading}>
                <p className="px-4 pb-1 pt-2 text-label uppercase text-lantern-text-tertiary">
                  {group.heading}
                </p>
                {rows.map((row) => (
                  <MenuItem
                    key={row.id}
                    title={row.promise}
                    aria-current={row.id === activity ? 'true' : undefined}
                    onSelect={() => onActivity(row.id, row.status)}
                    icon={
                      <AppIcon
                        name={row.icon}
                        size={18}
                        className={`shrink-0 ${FEATURE_INK_TEXT[row.feature]}`}
                      />
                    }
                  >
                    {row.label}
                  </MenuItem>
                ))}
              </div>
            );
          })}
        </MenuContent>
      </Menu>

      <span className="ml-auto flex shrink-0 items-center gap-1">
        {timer}
        {onOpenChat ? (
          <button type="button" onClick={onOpenChat} aria-label="Chat" className={ICON_BUTTON}>
            <AppIcon name="chatbubbles" size={18} />
          </button>
        ) : null}
        {kebab.length > 0 ? (
          <Menu>
            <MenuTrigger aria-label="Study set actions" className={ICON_BUTTON}>
              <AppIcon name="ellipsis-vertical" size={18} />
            </MenuTrigger>
            <MenuContent align="end" placement="bottom">
              {kebab.map((item) => (
                <MenuItem key={item.id} onSelect={item.onSelect}>
                  {item.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
      </span>
    </div>
  );
};

export default SetRoomFocusBar;
