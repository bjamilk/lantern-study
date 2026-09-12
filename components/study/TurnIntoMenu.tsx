import React from 'react';
import {
  TURN_INTO_TARGETS,
  formatTurnIntoCost,
  type TurnIntoTargetId,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';

interface TurnIntoMenuProps {
  disabled?: boolean;
  /** Targets already made from this note — ticked so nobody pays twice. */
  existing?: Partial<Record<TurnIntoTargetId, boolean>>;
  onSelect: (target: TurnIntoTargetId) => void;
}

export const TurnIntoMenu: React.FC<TurnIntoMenuProps> = ({ disabled, existing, onSelect }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-label uppercase text-lantern-text-secondary">Turn into</span>
    {TURN_INTO_TARGETS.map((target) => {
      const made = Boolean(existing?.[target.id]);
      const cost = formatTurnIntoCost(target.id);
      return (
        <button
          key={target.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(target.id)}
          aria-label={`${target.label} — ${cost}${made ? ' — already made' : ''}`}
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

export default TurnIntoMenu;
