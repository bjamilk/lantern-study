import React from 'react';
import {
  TURN_INTO_TARGETS,
  formatTurnIntoCost,
  type TurnIntoTargetId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import { MenuItem } from '../ui/Menu';

interface TurnIntoMenuProps {
  disabled?: boolean;
  /** Targets already made from this note — ticked so nobody pays twice. */
  existing?: Partial<Record<TurnIntoTargetId, boolean>>;
  onSelect: (target: TurnIntoTargetId) => void;
  /**
   * The row label. A chat answer says "Turn this answer into" so the student
   * knows the six pills act on the message under them, not on the note the
   * conversation happens to be holding.
   */
  heading?: string;
  /**
   * The spoken name of one pill, when it differs from its short label. A
   * message-scoped studio pill has to say it files a note first; the pill text
   * stays short, the accessible name carries the whole promise.
   */
  describeTarget?: (target: TurnIntoTargetId) => string;
}

export const TurnIntoMenu: React.FC<TurnIntoMenuProps> = ({
  disabled,
  existing,
  onSelect,
  heading = 'Turn into',
  describeTarget,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-label uppercase text-lantern-text-secondary">{heading}</span>
    {TURN_INTO_TARGETS.map((target) => {
      const made = Boolean(existing?.[target.id]);
      const cost = formatTurnIntoCost(target.id);
      return (
        <button
          key={target.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(target.id)}
          aria-label={`${describeTarget?.(target.id) ?? target.label} — ${cost}${made ? ' — already made' : ''}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text transition-colors hover:border-lantern-text-tertiary disabled:opacity-50"
        >
          <span className={FEATURE_INK_TEXT[target.feature]} aria-hidden="true">
            <AppIcon name={target.icon} size={16} />
          </span>
          {target.label}
          {made ? (
            <span className="text-lantern-feature-tests-ink" aria-hidden="true">
              <AppIcon name="checkmark" size={14} />
            </span>
          ) : null}
          <span className="text-caption font-normal text-lantern-text-tertiary" aria-hidden="true">
            · {cost}
          </span>
        </button>
      );
    })}
  </div>
);

/**
 * The same targets, as MENU ITEMS.
 *
 * The lecture room's header carries "Turn into" as an outlined menu rather than
 * as a row of six pills — a studio has one row of chrome and the pills were
 * most of it. The items are the same list, with the same prices and the same
 * ticks, so nothing about what a student is buying changes with the shape.
 * Render inside a `<MenuContent>`.
 */
export const TurnIntoMenuItems: React.FC<{
  existing?: Partial<Record<TurnIntoTargetId, boolean>>;
  onSelect: (target: TurnIntoTargetId) => void;
  disabled?: boolean;
}> = ({ existing, onSelect, disabled }) => (
  <>
    {TURN_INTO_TARGETS.map((target) => {
      const made = Boolean(existing?.[target.id]);
      const cost = formatTurnIntoCost(target.id);
      return (
        <MenuItem
          key={target.id}
          disabled={disabled}
          onSelect={() => onSelect(target.id)}
          aria-label={`${target.label} — ${cost}${made ? ' — already made' : ''}`}
          icon={
            <span className={FEATURE_INK_TEXT[target.feature]} aria-hidden="true">
              <AppIcon name={target.icon} size={16} />
            </span>
          }
        >
          <span className="flex-1">{target.label}</span>
          {made ? (
            <span className="text-lantern-feature-tests-ink" aria-hidden="true">
              <AppIcon name="checkmark" size={14} />
            </span>
          ) : null}
          {/* The price never leaves: it is stated wherever the action is. */}
          <span className="text-caption text-lantern-text-tertiary" aria-hidden="true">
            · {cost}
          </span>
        </MenuItem>
      );
    })}
  </>
);

export default TurnIntoMenu;
