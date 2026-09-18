import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import {
  canExpandCompanionSuggestions,
  companionSuggestionPrompt,
  visibleCompanionSuggestions,
  type CompanionSuggestion,
} from './companionSuggestions';

interface CompanionPromptsProps {
  /** The ordered list for the page the student is on. */
  suggestions: readonly CompanionSuggestion[];
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Send this as a message — the same path a typed question takes. */
  onAsk: (prompt: string) => void;
  /** Open the door this pill names, through the companion's action path. */
  onOpenDoor: (suggestion: CompanionSuggestion) => void;
  disabled?: boolean;
}

/**
 * The suggested prompts, as intent chips — now the CONTEXTUAL three.
 *
 * WHAT CHANGED IN WAVE 4. The list is no longer a constant: it is whatever
 * `companionSuggestionsFor` returns for the page the student is on, and it
 * collapses to THREE behind "View more" rather than four, which is what the
 * reference shows and what a 400px rail holds without wrapping the row.
 *
 * Each chip carries a 16px glyph in the ink of the thing it is ABOUT —
 * flashcards lilac-blue, tests, notes — rather than seven identical sparkles,
 * so the one you want is findable by shape before it is read.
 *
 * DOORS SAY THEY ARE DOORS. "Generate flashcards for this set" does not chat:
 * it opens the flashcard create door, the same one the model's own tool call
 * opens. Those chips carry a trailing arrow and an accessible name that says
 * where they go, because a chip that looks like a question and navigates
 * instead is a lie about what pressing it does.
 *
 * 44px minimum, per the touch-target rule. The reference's pill is 34px tall;
 * ours keeps the extra padding — on the empty state these chips are the primary
 * way in, not a garnish, and an undersized primary control is the one parity
 * deviation this programme has kept throughout.
 */
export function CompanionPrompts({
  suggestions,
  expanded,
  onToggleExpanded,
  onAsk,
  onOpenDoor,
  disabled,
}: CompanionPromptsProps) {
  const visible = visibleCompanionSuggestions(suggestions, expanded);
  const canExpand = canExpandCompanionSuggestions(suggestions);

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {visible.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          disabled={disabled}
          onClick={() =>
            suggestion.kind === 'door'
              ? onOpenDoor(suggestion)
              : onAsk(companionSuggestionPrompt(suggestion))
          }
          aria-label={
            suggestion.kind === 'door' ? `${suggestion.label} — opens the tool` : undefined
          }
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface py-1 pl-1 pr-3 text-body font-medium text-lantern-text-secondary transition-colors hover:bg-lantern-background-secondary disabled:opacity-40 dark:bg-transparent dark:hover:bg-lantern-surface-secondary"
        >
          <span
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${FEATURE_INK_TEXT[suggestion.feature]}`}
            aria-hidden="true"
          >
            <AppIcon name={suggestion.icon} size={16} />
          </span>
          {suggestion.label}
          {suggestion.kind === 'door' && (
            <AppIcon name="arrow-forward" size={12} className="flex-shrink-0 opacity-60" />
          )}
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
