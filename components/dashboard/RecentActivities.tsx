import React from 'react';
import {
  recentActivities,
  relativeActivityTime,
  type RecentActivity,
  type RecentActivityKind,
  type RecentActivitiesInput,
} from '@lantern/shared/dashboard';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import type { FeatureKey } from '../ui/featureClasses';
import { InlineReviewCard } from './InlineReviewCard';

/**
 * "Recent activities" — the resume feed, in the reference product's anatomy:
 * a hue tile, a grey past-tense VERB above a bold title, and the age of the
 * row on the right. Tapping a row goes back to the thing you were doing.
 *
 * The rows come from `recentActivities()` in `@lantern/shared/dashboard`, the
 * same model mobile renders, so the two Homes cannot drift on what counts as
 * an activity, what it is called, or how it is ordered.
 *
 * THE HONESTY RULE. Home does not invent rows. A source the client has not
 * loaded contributes nothing rather than a plausible blank: decks carry no
 * per-deck study timestamp (only `StudySet.lastStudiedAt` and the resume
 * feed's own `cards` rows do), and companion conversations are only in memory
 * once the student has opened the companion panel. Both are passed in when
 * they exist and omitted when they do not. Nothing here fetches — the caller
 * hands over what Home already has.
 */

/** Hue = the kind of object, never state. */
const KIND_FEATURE: Record<RecentActivityKind, FeatureKey> = {
  flashcards: 'flashcards',
  test: 'tests',
  material: 'notes',
  lecture: 'recording',
  companion: 'ai',
};

const KIND_ICON: Record<RecentActivityKind, AppIconName> = {
  flashcards: 'layers',
  test: 'clipboard-check',
  material: 'document-text',
  lecture: 'mic',
  companion: 'sparkles',
};

export interface RecentActivitiesProps extends RecentActivitiesInput {
  /** Resume the row. The model already resolved where it goes. */
  onOpen: (activity: RecentActivity) => void;
  /** Fixed "now" for tests; defaults to the real clock. */
  now?: Date;
}

export const RecentActivities: React.FC<RecentActivitiesProps> = ({
  onOpen,
  now,
  ...input
}) => {
  const rows = recentActivities(input);
  // Nothing done yet is not a failure state and not worth a heading: Home's
  // other regions already tell a brand-new student where to start.
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="text-title font-semibold text-lantern-text mb-4">Recent activities</h2>
      {/*
        The first row is a live card when something is already due: the real
        front of a real flashcard, gradeable in place. It renders nothing when
        nothing is due, which leaves the plain rows exactly as they were.
      */}
      <InlineReviewCard />
      <ul className="rounded-2xl border border-lantern-border bg-lantern-surface divide-y divide-lantern-border overflow-hidden">
        {rows.map((row) => {
          const age = relativeActivityTime(row.at, now);
          return (
            <li key={`${row.kind}:${row.id}`}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lantern-background-secondary/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lantern-ink/40"
              >
                <FeatureDisc
                  feature={KIND_FEATURE[row.kind]}
                  size={32}
                  icon={<AppIcon name={KIND_ICON[row.kind]} size={16} />}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-caption text-lantern-text-secondary">{row.verb}</span>
                  <span className="block text-body font-semibold text-lantern-text truncate">
                    {row.title}
                  </span>
                  {row.subtitle ? (
                    <span className="block text-caption text-lantern-text-tertiary truncate">
                      {row.subtitle}
                    </span>
                  ) : null}
                </span>
                {age ? (
                  <span className="shrink-0 text-caption text-lantern-text-tertiary tabular-nums">
                    {age}
                  </span>
                ) : null}
                <AppIcon
                  name="chevron-forward"
                  size={16}
                  className="shrink-0 text-lantern-text-tertiary"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default RecentActivities;
