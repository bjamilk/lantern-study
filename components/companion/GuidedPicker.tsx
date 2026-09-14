/**
 * Guided mode's entry surface: a goal picker, not a blank box.
 *
 * With Guided on, the intent chips are the wrong offer — those ask a question,
 * and Guided is a lesson through a TOPIC. So the chips are replaced by rows
 * built from the student's own material: `Continue learning:` only when the
 * host actually has a stored next topic (an invented continue claims progress
 * that was never saved), `Start learning:` for the rest, and a free-text row
 * that hands the composer back for anything else.
 *
 * The picker itself spends nothing — every row is rendered locally, and the
 * first model call happens on the row that is tapped. The cost line says so,
 * because "start a guided session" invites the assumption that a session is
 * billed separately from a message. It is not.
 */
import React from 'react';
import {
  GUIDED_COST_NOTE,
  GUIDED_PICKER_TITLE,
  type GuidedGoal,
} from '@lantern/shared/api';
import { AppIcon } from '../ui/AppIcon';

interface GuidedPickerProps {
  goals: readonly GuidedGoal[];
  /** Send the first guided turn for this goal. */
  onPick: (goal: GuidedGoal) => void;
  /** "Something else…" — hands focus back to the composer rather than opening a second box. */
  onSomethingElse: () => void;
  disabled?: boolean;
  theme?: 'light' | 'dark';
}

export function GuidedPicker({
  goals,
  onPick,
  onSomethingElse,
  disabled,
  theme = 'light',
}: GuidedPickerProps) {
  return (
    <div
      className={`w-full rounded-xl border border-lantern-border p-3 text-left
        ${theme === 'dark' ? 'bg-lantern-surface-secondary' : 'bg-lantern-background-secondary'}`}
    >
      <p
        id="companion-guided-picker-title"
        className={`text-body font-semibold ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}
      >
        {GUIDED_PICKER_TITLE}
      </p>
      <div
        role="group"
        aria-labelledby="companion-guided-picker-title"
        className="mt-2 flex flex-col gap-1.5"
      >
        {goals.map((goal) => (
          <button
            key={goal.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(goal)}
            aria-label={
              goal.kind === 'continue'
                ? `Continue learning ${goal.topic}`
                : `Start learning ${goal.topic}`
            }
            className="inline-flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-lantern-border bg-lantern-surface px-3 text-left text-body font-medium text-lantern-text transition-colors hover:bg-lantern-background-secondary disabled:opacity-40 dark:bg-lantern-surface dark:text-white dark:hover:bg-lantern-surface-secondary"
          >
            <span className="min-w-0 truncate">{goal.label}</span>
            <span className="text-lantern-text-tertiary" aria-hidden="true">
              <AppIcon name="chevron-forward" size={16} />
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={onSomethingElse}
          aria-label="Something else — type what you want to be guided through"
          className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-body font-medium text-lantern-feature-ai-ink hover:underline disabled:opacity-40"
        >
          Something else…
        </button>
      </div>
      <p className="mt-2 text-caption text-lantern-text-secondary dark:text-lantern-text-tertiary">
        {GUIDED_COST_NOTE}
      </p>
    </div>
  );
}

export default GuidedPicker;
