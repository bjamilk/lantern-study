import React from 'react';
import {
  PRE_ASSESSMENT_MINUTES,
  preAssessmentCardLabel,
  type PreAssessmentCardAction,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';

/**
 * "See what you already know · Takes 3 minutes · Continue" — one per unit.
 *
 * The reference draws this INSIDE each unit, above its topics, because the
 * check is scoped to that unit: it asks about those topics and moves those
 * rows. A single page-level diagnostic (which is what shipped before) asked a
 * student to sit through the whole course to skip one lecture.
 *
 * WHAT THE PILL COSTS, SAID OUT LOUD. Building a check spends one AI use.
 * Resuming or reopening one does not, and the card says which it is about to
 * do rather than making the student find out from their credit balance. The
 * verb comes from `@lantern/shared`'s `preAssessmentCardLabel`, off the same
 * fact the server resumes from, so the card and the API cannot disagree about
 * whether a check is finished.
 */
export const UnitPreAssessmentCard: React.FC<{
  action: PreAssessmentCardAction;
  busy?: boolean;
  /** Set once a check has been graded onto the plan, for the closing line. */
  covered?: number | null;
  onStart: () => void;
}> = ({ action, busy, covered, onStart }) => {
  const label = preAssessmentCardLabel(action);
  const costs = action !== 'resume';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <AppIcon name="sparkles" size={18} className="shrink-0 text-lantern-feature-ai-ink" />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-lantern-text">
          See what you already know
        </span>
        <span className="block text-caption text-lantern-text-secondary">
          {action === 'resume'
            ? 'Pick up the check you started — no new questions, no AI use.'
            : `Takes about ${PRE_ASSESSMENT_MINUTES} minutes · marks topics covered so the plan skips them${
                costs ? ' · uses 1 AI credit' : ''
              }`}
        </span>
        {typeof covered === 'number' && covered > 0 ? (
          <span className="block text-caption text-lantern-text-secondary">
            Your last check moved {covered} {covered === 1 ? 'topic' : 'topics'} forward.
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        // The reference's dark 32px pill. Height 32 with padding taking the hit
        // target to 44, the same anatomy as the spine's own Continue.
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-full bg-lantern-text px-4 py-1.5 text-caption font-semibold text-lantern-surface disabled:opacity-60"
      >
        {busy ? 'Building…' : label}
        {busy ? null : <AppIcon name="chevron-forward" size={14} />}
      </button>
    </div>
  );
};

export default UnitPreAssessmentCard;
