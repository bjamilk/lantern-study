import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import {
  QUICK_PROMPTS,
  QUICK_PROMPT_CHIPS,
  QUICK_PROMPT_PREVIEW_COUNT,
} from './companionScope';

interface CompanionPromptsProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  onAsk: (prompt: string) => void;
  disabled?: boolean;
}

/**
 * The suggested prompts, as intent chips.
 *
 * Each carries a 16 px glyph in the ink of the thing it is ABOUT — flashcards
 * lilac-blue, tests, budget — rather than seven identical sparkles, so the one
 * you want is findable by shape before it is read. The list collapses to four
 * behind "View more" for the same reason the phone's does: the drawer is
 * `max-w-sm`, and seven of these stack into a wall.
 *
 * 44 px minimum, per the touch-target rule — on the empty state these chips
 * are the primary way in, not a garnish.
 */
export function CompanionPrompts({
  expanded,
  onToggleExpanded,
  onAsk,
  disabled,
}: CompanionPromptsProps) {
  const visible = expanded
    ? QUICK_PROMPT_CHIPS
    : QUICK_PROMPT_CHIPS.slice(0, QUICK_PROMPT_PREVIEW_COUNT);
  const canExpand = QUICK_PROMPTS.length > QUICK_PROMPT_PREVIEW_COUNT;

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {visible.map((chip) => (
        <button
          key={chip.prompt}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(chip.prompt)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border px-3.5 text-body font-medium text-lantern-text-secondary transition-colors hover:bg-lantern-background-secondary disabled:opacity-40 dark:hover:bg-lantern-surface-secondary"
        >
          <span className={FEATURE_INK_TEXT[chip.feature]} aria-hidden="true">
            <AppIcon name={chip.icon} size={16} />
          </span>
          {chip.prompt}
        </button>
      ))}
      {canExpand && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="inline-flex min-h-[44px] items-center rounded-full px-3.5 text-body font-medium text-lantern-feature-ai-ink hover:underline"
        >
          {expanded ? 'View less' : 'View more'}
        </button>
      )}
    </div>
  );
}

export default CompanionPrompts;
