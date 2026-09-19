import React from 'react';
import {
  DEFAULT_PLAN_SORT,
  formatPlanSyllabusDate,
  planSyllabusMatchesByUnit,
  planSyllabusRows,
  planSyllabusUnitEyebrow,
  planTopicActivityLabel,
  unitSourceLabel,
  unitSources,
  type PlanComingUpWeek,
  type PlanExamDivider,
  type PlanRing,
  type PlanSortKey,
  type PlanSyllabusView,
  type PlanTimelineUnit,
  type PlanTopicRow,
  type StudySetTopic,
  type UnitSource,
  type UnitSourceKind,
  type UnitSourceMaterial,
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

/** A chip's glyph is the material's own, so chip and materials list agree. */
const SOURCE_GLYPH: Record<UnitSourceKind, 'document-text' | 'mic' | 'document'> = {
  note: 'document',
  pdf: 'document-text',
  lecture: 'mic',
};

/** How many chips before the row folds. Four fits a card at a glance. */
const SOURCE_CHIP_LIMIT = 4;

/**
 * `Sources: [Lecture 3] [Enzymes]` — which materials this unit was built from.
 *
 * Renders NOTHING when there is nothing to say: no label, no placeholder, no
 * reserved space. Which ids are worth drawing — and which are dropped because
 * they no longer resolve — is decided once, in `@lantern/shared`'s
 * `unitSources`, so this surface and the phone's cannot disagree.
 *
 * The word is `Sources:`, deliberately. A caller may hold a filtered materials
 * list, so a real source can resolve to nothing and vanish; the row is honest
 * about what it names and claims no completeness.
 */
const UnitSourcesRow: React.FC<{
  sources: readonly UnitSource[];
  onOpenSource: (source: UnitSource) => void;
}> = ({ sources, onOpenSource }) => {
  const [showAll, setShowAll] = React.useState(false);
  if (sources.length === 0) return null;
  const shown = showAll ? sources : sources.slice(0, SOURCE_CHIP_LIMIT);
  const hidden = sources.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
      <span className="text-caption text-lantern-text-secondary">Sources:</span>
      {shown.map((source) => (
        <button
          key={source.id}
          type="button"
          onClick={() => onOpenSource(source)}
          aria-label={unitSourceLabel(source)}
          title={source.title}
          className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border border-lantern-feature-ai-ink/30 bg-lantern-feature-ai-tint px-2.5 py-1 text-caption font-medium text-lantern-feature-ai-ink hover:underline"
        >
          <AppIcon name={SOURCE_GLYPH[source.kind]} size={14} className="flex-shrink-0" />
          <span className="truncate">{source.title}</span>
        </button>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="min-h-[40px] rounded-full px-2 text-caption font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
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

/**
 * `Exam 1 · 10 Oct` — a marker on the rail between two units.
 *
 * NOT a card and not a door: it opens nothing, because there is nothing behind
 * an exam except the units either side of it, which are already on the page.
 * What it does is answer the question the plan could not answer before — which
 * of these units is the midterm actually going to ask about.
 *
 * It takes the rail's own ink so it reads as part of the route rather than as a
 * notice pasted over it, and it is `role="separator"` with its text as the
 * label, which is what it is to a screen reader too.
 */
const PlanExamMarker: React.FC<{ divider: PlanExamDivider }> = ({ divider }) => (
  <div
    role="separator"
    aria-label={divider.label}
    className="relative flex items-center gap-2 pl-10"
  >
    <span
      aria-hidden="true"
      className="absolute left-[9px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-lantern-surface ring-2 ring-lantern-feature-ai-ink"
    >
      <span className="block h-1.5 w-1.5 rounded-full bg-lantern-feature-ai-ink" />
    </span>
    <span className="text-label uppercase tracking-wide text-lantern-feature-ai-ink">
      {divider.label}
    </span>
    <span aria-hidden="true" className="h-px flex-1 bg-lantern-feature-ai-tint" />
  </div>
);

/**
 * `Coming up in your syllabus` — the weeks with no material behind them yet.
 *
 * THIS IS THE HONEST HALF OF THE FEATURE. A syllabus week that nothing in the
 * set matches is real information the student wants, and it is NOT a plan unit:
 * it has no topics, no progress and nothing to open, so drawing it as one would
 * be a row of doors onto empty rooms — the pattern #142 refused to ship and the
 * reason the plan was left out of it.
 *
 * So it is a LIST. Text rows, no ring, no chevron, no per-week button, not
 * tappable. One door for the whole block, and it is the door that would
 * actually change the situation: add materials. Nothing here claims the week is
 * studied, studiable, or coming up in any sense other than the syllabus's own.
 */
export const PlanComingUpList: React.FC<{
  weeks: readonly PlanComingUpWeek[];
  onAddMaterials?: () => void;
}> = ({ weeks, onAddMaterials }) => {
  if (weeks.length === 0) return null;
  return (
    <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
      <h3 className="text-heading text-lantern-text">Coming up in your syllabus</h3>
      <p className="mt-1 text-caption text-lantern-text-secondary">
        {weeks.length === 1 ? 'One week has' : `${weeks.length} weeks have`} nothing filed under
        {weeks.length === 1 ? ' it' : ' them'} yet, so {weeks.length === 1 ? 'it is' : 'they are'}{' '}
        not in the plan.
      </p>
      <ul className="mt-3 space-y-1.5">
        {weeks.map((week) => (
          <li
            key={week.week}
            className="flex items-baseline justify-between gap-3 text-caption"
          >
            <span className="min-w-0 flex-1 truncate text-lantern-text">
              <span className="tabular-nums text-lantern-text-tertiary">Week {week.week}</span>{' '}
              {week.title}
            </span>
            {week.examLabel ? (
              <span className="shrink-0 rounded-full bg-lantern-feature-ai-tint px-2 py-0.5 text-label text-lantern-feature-ai-ink">
                {week.examLabel}
              </span>
            ) : null}
            {week.date ? (
              <span className="shrink-0 tabular-nums text-lantern-text-secondary">
                {formatPlanSyllabusDate(week.date)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {onAddMaterials ? (
        <button
          type="button"
          onClick={onAddMaterials}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border px-4 text-caption font-medium text-lantern-text hover:underline"
        >
          <AppIcon name="add" size={16} />
          Add materials
        </button>
      ) : null}
    </section>
  );
};

interface StudyPlanTimelineProps {
  timeline: readonly PlanTimelineUnit[];
  openUnitIds: Readonly<Record<string, boolean>>;
  onToggleUnit: (unitId: string) => void;
  onCycleStatus: (topic: StudySetTopic) => void;
  onStartTopic: (topic: StudySetTopic) => void;
  /**
   * The materials the caller holds, for the `Sources:` chips. An id that does
   * not resolve against THIS list is dropped rather than drawn — see
   * `unitSources`. Omitted means no chip row anywhere.
   */
  materials?: readonly UnitSourceMaterial[];
  /** Opens a chip's material. Without it the chips are not drawn at all. */
  onOpenSource?: (source: UnitSource) => void;
  /**
   * The unit's pre-assessment card, drawn at the top of an OPEN unit.
   *
   * A render prop rather than props, because the card's state (is there an
   * unfinished check, is one building right now) belongs to whoever owns the
   * API calls; the timeline's job is to say where it goes. Returning null for a
   * unit draws nothing at all — no placeholder, no reserved space.
   */
  renderUnitPreAssessment?: (unit: PlanTimelineUnit['unit']) => React.ReactNode;
  /**
   * The set's syllabus, read against these units. Null — the case for every set
   * that has never had one uploaded — draws exactly what this drew before the
   * syllabus existed: no eyebrows, no exam markers, the caller's own order.
   */
  syllabus?: PlanSyllabusView | null;
  /** Which sort is on, because the exam markers only mean anything in course order. */
  sort?: PlanSortKey;
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
  materials,
  onOpenSource,
  renderUnitPreAssessment,
  syllabus = null,
  sort = DEFAULT_PLAN_SORT,
}) => {
  if (timeline.length === 0) return null;

  const byUnitId = new Map(timeline.map((entry) => [entry.unit.id, entry]));
  const syllabusByUnit = planSyllabusMatchesByUnit(syllabus);
  // The rows to draw, exam markers folded in at their anchors. Whether a marker
  // is drawn at all is `planSyllabusRows`' call, not this component's — see its
  // header for why `weakest` gets none.
  const rows = planSyllabusRows(
    timeline.map((entry) => entry.unit.id),
    syllabus,
    sort
  );
  // The `01`–`0N` index counts UNITS only. A marker is not a stop on the route.
  let unitNumber = 0;

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
        {rows.map((row) => {
          if (row.kind === 'exam') {
            return <PlanExamMarker key={row.divider.id} divider={row.divider} />;
          }
          const entry = byUnitId.get(row.unitId);
          if (!entry) return null;
          const { unit, ring } = entry;
          const topicRows = entry.rows;
          const index = unitNumber++;
          const match = syllabusByUnit.get(unit.id) ?? null;
          const expanded = openUnitIds[unit.id] ?? false;
          const panelId = `plan-unit-${unit.id}`;
          // The chips sit under the heading whether or not the unit is open:
          // "what is this unit made of" is the question a shut drawer raises.
          const sources =
            materials && onOpenSource
              ? unitSources(unit, topicRows.map((topicRow) => topicRow.topic), materials)
              : [];
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
                    {/* The week this unit turned out to be. An eyebrow rather
                        than a suffix on the title: the title is the course's
                        name for the thing, and `Week 3 · 10 Oct` is where it
                        sits, which is a different kind of fact. */}
                    {match ? (
                      <span className="block text-label uppercase tracking-wide text-lantern-feature-ai-ink">
                        {planSyllabusUnitEyebrow(match)}
                      </span>
                    ) : null}
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

                {onOpenSource ? (
                  <UnitSourcesRow sources={sources} onOpenSource={onOpenSource} />
                ) : null}

                {expanded ? (
                  <div id={panelId} className="border-t border-lantern-border p-2">
                    {/* The check comes FIRST inside the unit, as the reference
                        draws it: "what do you already know" is the question
                        that decides which of these rows you need at all. */}
                    {renderUnitPreAssessment ? (
                      <div className="px-1 pb-2 pt-1">{renderUnitPreAssessment(unit)}</div>
                    ) : null}
                    {topicRows.length === 0 ? (
                      <p className="px-3 py-2 text-caption text-lantern-text-secondary">
                        Nothing is filed under this unit yet.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {topicRows.map((row) => (
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
