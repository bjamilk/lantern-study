import React from 'react';
import {
  planTopicActivityLabel,
  type PlanRing,
  type PlanTimelineUnit,
  type PlanTopicRow,
  type StudySetTopic,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';

/**
 * A unit's partial arc.
 *
 * The twin of `RoomTopicRing`, but driven by a PERCENT rather than by one
 * topic's status — a unit is nine topics in four states, and there is no single
 * status to hand that component. Same two tokens, deliberately: the plan page
 * and the plan band must not paint progress in two different violets.
 *
 * Decorative to a screen reader; the same numbers are written out beside it.
 */
export const PlanUnitRing: React.FC<{ ring: PlanRing; size?: number }> = ({ ring, size = 40 }) => {
  const stroke = Math.max(3, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-lantern-feature-ai-tint"
      />
      {ring.percent > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(circumference * ring.percent) / 100} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-lantern-feature-ai-ink"
        />
      ) : null}
    </svg>
  );
};

/** What the dot button will do next, spoken. */
function nextStatusLabel(topic: StudySetTopic): string {
  if (topic.status === 'unseen') return `Mark ${topic.title} as covered`;
  if (topic.status === 'covered') return `Mark ${topic.title} as mastered`;
  return `Mark ${topic.title} as not started`;
}

const TopicRow: React.FC<{
  row: PlanTopicRow;
  onCycleStatus: (topic: StudySetTopic) => void;
  onStartTopic: (topic: StudySetTopic) => void;
}> = ({ row, onCycleStatus, onStartTopic }) => {
  const { topic, state } = row;
  const done = state === 'done';
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
        state === 'next' ? 'bg-lantern-feature-ai-tint/40' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onCycleStatus(topic)}
        aria-label={nextStatusLabel(topic)}
        className="flex h-11 w-6 shrink-0 items-center justify-center"
      >
        {/* A filled grey dot is "finished"; a half-tone dot is "read once";
            a hollow one is untouched. The state is also in the caption beside
            it, so colour is never the only carrier. */}
        <span
          className={`block h-3 w-3 rounded-full ${
            done
              ? 'bg-lantern-text-tertiary'
              : topic.status === 'covered'
                ? 'bg-lantern-feature-ai-ink'
                : 'border border-lantern-border bg-lantern-surface'
          }`}
        />
      </button>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-body truncate ${
            done ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'
          }`}
        >
          {topic.title}
        </span>
        <span className="block text-caption text-lantern-text-secondary capitalize">
          {topic.status}
        </span>
      </span>

      {state === 'next' ? (
        // The one black pill on the page. It is not a `Button` variant because
        // the reference's Continue is a filled ink chip, and the room's primary
        // button is the app's accent; two accents in one card is the thing the
        // declutter pass removed everywhere else.
        <button
          type="button"
          onClick={() => onStartTopic(topic)}
          className="shrink-0 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-lantern-text px-4 text-caption font-semibold text-lantern-surface"
        >
          Continue
          <AppIcon name="chevron-forward" size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onStartTopic(topic)}
          className="shrink-0 min-h-[40px] rounded-full px-3 text-caption font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
        >
          {planTopicActivityLabel(topic)}
        </button>
      )}
    </li>
  );
};

interface StudyPlanTimelineProps {
  timeline: readonly PlanTimelineUnit[];
  openUnitIds: Readonly<Record<string, boolean>>;
  onToggleUnit: (unitId: string) => void;
  onCycleStatus: (topic: StudySetTopic) => void;
  onStartTopic: (topic: StudySetTopic) => void;
}

/**
 * The study plan as a route rather than a list.
 *
 * WHAT CHANGED. The plan was a stack of bordered boxes with a hairline behind
 * them and a checkbox per topic — it told a student what the plan CONTAINED and
 * never once where they were standing in it. The spine is the fix: one lilac
 * rail, `Start learning here` at the top of it, a node per unit, an arc that
 * fills as the unit does, and exactly one black `Continue` on the topic the
 * room would send you to anyway.
 *
 * The rail is the AI feature's tint and its ink, the same two tokens as
 * `RoomTopicRing` — the deliberate exception to the one-ink palette, already
 * argued there: progress is the one thing on a study screen that earns colour.
 *
 * Every decision about WHICH row is next, what strikes through, and what
 * `Continue` opens lives in `@lantern/shared`'s `planTimeline`, not here.
 */
export const StudyPlanTimeline: React.FC<StudyPlanTimelineProps> = ({
  timeline,
  openUnitIds,
  onToggleUnit,
  onCycleStatus,
  onStartTopic,
}) => {
  if (timeline.length === 0) return null;

  return (
    <div className="relative">
      {/* The rail itself. Inset to the centre of the nodes, and stopped short
          of the last card so it reads as a route with an end. */}
      <span
        aria-hidden="true"
        className="absolute left-[15px] top-4 bottom-8 w-0.5 rounded-full bg-lantern-feature-ai-tint"
      />

      <div className="relative flex items-center gap-3 pl-10">
        <span
          aria-hidden="true"
          className="absolute left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-lantern-feature-ai-ink text-lantern-surface"
        >
          <AppIcon name="send" size={11} className="text-lantern-surface" />
        </span>
        <p className="text-label uppercase tracking-wide text-lantern-feature-ai-ink">
          Start learning here
        </p>
      </div>

      <div className="mt-3 space-y-3">
        {timeline.map((entry, index) => {
          const { unit, ring, rows } = entry;
          const expanded = openUnitIds[unit.id] ?? false;
          const panelId = `plan-unit-${unit.id}`;
          return (
            <section key={unit.id} className="relative pl-10">
              <span
                aria-hidden="true"
                className={`absolute left-[9px] top-6 h-3.5 w-3.5 rounded-full border-2 border-lantern-feature-ai-ink ${
                  ring.percent > 0 ? 'bg-lantern-feature-ai-ink' : 'bg-lantern-surface'
                }`}
              />

              <div className="rounded-2xl border border-lantern-border bg-lantern-surface">
                <button
                  type="button"
                  onClick={() => onToggleUnit(unit.id)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  className="flex w-full min-h-[44px] items-center gap-3 p-3 text-left"
                >
                  <PlanUnitRing ring={ring} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-heading text-lantern-text truncate">
                      <span className="tabular-nums text-lantern-text-tertiary">
                        {String(index + 1).padStart(2, '0')}
                      </span>{' '}
                      {unit.title}
                    </span>
                    <span className="block text-caption text-lantern-text-secondary">
                      {ring.total === 0
                        ? 'No topics yet'
                        : `${ring.covered} of ${ring.total} covered · ${ring.mastered} mastered`}
                    </span>
                  </span>
                  <AppIcon
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    className="shrink-0 text-lantern-text-secondary"
                  />
                </button>

                {expanded ? (
                  <div id={panelId} className="border-t border-lantern-border p-2">
                    {rows.length === 0 ? (
                      <p className="px-3 py-2 text-caption text-lantern-text-secondary">
                        Nothing is filed under this unit yet.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {rows.map((row) => (
                          <TopicRow
                            key={row.topic.id}
                            row={row}
                            onCycleStatus={onCycleStatus}
                            onStartTopic={onStartTopic}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default StudyPlanTimeline;
