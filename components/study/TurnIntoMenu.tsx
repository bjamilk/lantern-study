import React from 'react';
import {
  TURN_INTO_TARGETS,
  type TurnIntoTargetId,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';

const COST: Record<TurnIntoTargetId, number> = {
  cards: AI_CREDIT_COSTS.generate_flashcards,
  test: AI_CREDIT_COSTS.generate_questions,
};

interface TurnIntoMenuProps {
  disabled?: boolean;
  onSelect: (target: TurnIntoTargetId) => void;
}

export const TurnIntoMenu: React.FC<TurnIntoMenuProps> = ({ disabled, onSelect }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-label uppercase text-lantern-text-secondary">Turn into</span>
    {TURN_INTO_TARGETS.map((target) => (
      <button
        key={target.id}
        type="button"
        disabled={disabled}
        onClick={() => onSelect(target.id)}
        aria-label={`${target.label} — ${formatCreditCost(COST[target.id])}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text transition-colors hover:border-lantern-text-tertiary disabled:opacity-50"
      >
        <span className={FEATURE_INK_TEXT[target.feature]} aria-hidden="true">
          <AppIcon name={target.icon} size={16} />
        </span>
        {target.label}
        <span className="text-caption font-normal text-lantern-text-tertiary" aria-hidden="true">
          · {formatCreditCost(COST[target.id])}
        </span>
      </button>
    ))}
  </div>
);

export default TurnIntoMenu;
