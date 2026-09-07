import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { Illustration } from './ui';
import {
  MASTERY_BAND_LABELS,
  masteryBand,
  type CourseClassSignal,
  type CourseReadiness,
} from '@lantern/shared/network';
import {
  buildReadinessRow,
  type ReadinessNavTarget,
} from '@lantern/shared/learning/readinessCard';
import { fetchCourseReadiness, refreshMasteryGraph } from '../services/supabase';
import { ManageOutlineModal } from './academic/ManageOutlineModal';

/**
 * "Exam readiness" — the syllabus-aware rollup of the mastery graph, per
 * enrolled course. Day-one useful: a brand-new student with zero activity
 * still sees each course's outline size and a "Start here" pointer; every
 * test and review then moves the numbers. Expanding a course shows the
 * per-topic breakdown plus the class signal (what students of this course
 * find hardest — only shown at a 20+ cohort, never for a small class).
 *
 * Honesty rule inherited from the mastery graph: a missing score renders as
 * "not enough data yet", never as 0%.
 *
 * And the card never disappears. It has the same three honest states as the
 * mobile card (`apps/mobile/src/components/dashboard/CourseReadinessCard.tsx`):
 * courses, no courses yet (say what would fill it), and could-not-load (say
 * so). A card that renders nothing is indistinguishable from a card that
 * failed, and both read to a student as "the app forgot my exams" — which is
 * also why Home's second card must not silently become its first.
 */

const BAND_BAR_CLASSES: Record<string, string> = {
  unknown: 'bg-lantern-border',
  weak: 'bg-red-400',
  developing: 'bg-amber-400',
  strong: 'bg-emerald-500',
};

const BAND_CHIP_CLASSES: Record<string, string> = {
  unknown: 'bg-lantern-background-secondary text-lantern-text-tertiary',
  weak: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  developing: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  strong: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

export interface CourseReadinessCardProps {
  /** Open a deck by id — the "Review …" action. Hidden when not wired. */
  onOpenDeck?: (deckId: string) => void;
  /** Open a note by id — the "Read your … note" action. */
  onOpenNote?: (noteId: string) => void;
  /** The tests home — the "Take a test on …" action. */
  onOpenTests?: () => void;
  /** Settings → Academic, where `examDate` is edited. */
  onOpenAcademicSettings?: () => void;
}

export const CourseReadinessCard: React.FC<CourseReadinessCardProps> = ({
  onOpenDeck,
  onOpenNote,
  onOpenTests,
  onOpenAcademicSettings,
}) => {
  const [courses, setCourses] = useState<CourseReadiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [classSignals, setClassSignals] = useState<Record<string, CourseClassSignal | 'loading'>>({});
  /** The course whose outline is open for editing, from a "topics" action. */
  const [outlineCourse, setOutlineCourse] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCourseReadiness();
      setCourses(data.courses);
      setError(null);
    } catch (e) {
      console.error('Error loading course readiness:', e);
      setError('We could not load your readiness just now. Your study still counts — try Refresh.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMasteryGraph();
      await load();
    } catch (e) {
      console.error('Error refreshing mastery graph:', e);
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The card's one action, routed to whichever handler the host wired.
   *
   * An action the host cannot honour is not rendered at all (`canRun`): a
   * button that goes nowhere teaches the student that the card is scenery,
   * which costs more than the button was ever worth. Topics are always
   * honourable — the outline editor is right here in the card.
   */
  const canRun = (target: ReadinessNavTarget): boolean => {
    switch (target.kind) {
      case 'deck':
        return !!onOpenDeck;
      case 'note':
        return !!onOpenNote;
      case 'test':
        return !!onOpenTests;
      case 'examDate':
        return !!onOpenAcademicSettings;
      case 'topics':
        return true;
    }
  };

  const run = (target: ReadinessNavTarget) => {
    switch (target.kind) {
      case 'deck':
        onOpenDeck?.(target.deckId);
        return;
      case 'note':
        onOpenNote?.(target.noteId);
        return;
      case 'test':
        onOpenTests?.();
        return;
      case 'examDate':
        onOpenAcademicSettings?.();
        return;
      case 'topics':
        setOutlineCourse({ id: target.courseId, label: target.courseLabel || 'Course' });
        return;
    }
  };

  const toggleCourse = (courseId: string) => {
    const next = expandedCourseId === courseId ? null : courseId;
    setExpandedCourseId(next);
    if (next && classSignals[next] === undefined) {
      setClassSignals(prev => ({ ...prev, [next]: 'loading' }));
      fetchCourseReadiness(next)
        .then(data =>
          setClassSignals(prev => ({ ...prev, [next]: data.classSignal ?? { available: false } }))
        )
        .catch(() => setClassSignals(prev => ({ ...prev, [next]: { available: false } })));
    }
  };

  return (
    <div className="bg-lantern-surface rounded-2xl overflow-hidden ring-1 ring-lantern-border/60">
      {/* The screen's one hero band (§5.6): 56 px of sky tint on a neutral card,
          the title in the tests ink (5.17:1 on its own tint), and the
          `readiness-ring` illustration. Home's doors below it are 56 px bands
          too, so this earns its place by being the only band with a TITLE in
          it — the readiness question is the one Home exists to answer. */}
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5 bg-lantern-feature-tests-tint text-lantern-feature-tests-ink">
        <div className="flex items-center gap-2.5 min-w-0">
          <Illustration name="readiness-ring" feature="tests" size={56} />
          <h2 className="text-heading font-bold truncate">Exam readiness</h2>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="flex shrink-0 items-center gap-1 px-2.5 py-1.5 rounded-lg text-caption font-medium transition-opacity hover:opacity-80 disabled:opacity-60"
          aria-label="Recompute readiness from your latest tests and reviews"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      <div className="p-4 sm:p-5">
        {error ? (
          <p className="text-body text-lantern-text-secondary py-2">{error}</p>
        ) : courses === null ? (
          <p className="text-body text-lantern-text-tertiary py-2" role="status">
            Working out where you stand…
          </p>
        ) : courses.length === 0 ? (
          // No enrolled courses. The nudge says what would fill the card rather
          // than what is missing from it, and the card keeps its place.
          <p className="text-body text-lantern-text-secondary py-2">
            Add your courses and exam dates and this becomes a per-course readiness score.
          </p>
        ) : (
          <div className="space-y-3">
            {courses.map(course => {
              // The same row mobile's card is built from, so the two surfaces
              // can never name a different next action for the same course.
              const row = buildReadinessRow(course);
              const pct = row.barPct;
              const band = row.band;
              const expanded = expandedCourseId === course.courseId;
              const signal = classSignals[course.courseId];
              const barClass =
                course.readinessScore != null
                  ? BAND_BAR_CLASSES[band]
                  : 'bg-lantern-primary/50';
              const statusLine = row.statusLine;

              return (
                <div key={course.courseId} className="rounded-xl border border-lantern-border/70 p-3">
                  <button
                    type="button"
                    onClick={() => toggleCourse(course.courseId)}
                    aria-expanded={expanded}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 text-body font-semibold text-lantern-text truncate">
                        {course.courseCode || 'Course'}
                        {course.courseTitle ? (
                          <span className="font-normal text-lantern-text-secondary"> — {course.courseTitle}</span>
                        ) : null}
                      </p>
                      <span className="flex items-center gap-1.5 shrink-0 text-caption text-lantern-text-tertiary">
                        {row.daysLeftLabel}
                        {expanded ? (
                          <ChevronDownIcon className="w-4 h-4" aria-hidden />
                        ) : (
                          <ChevronRightIcon className="w-4 h-4" aria-hidden />
                        )}
                      </span>
                    </div>

                    <div className="mt-2 h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barClass}`}
                        style={{ width: `${Math.max(pct ?? 0, pct != null ? 4 : 0)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-caption text-lantern-text-secondary">{statusLine}</span>
                      {course.coveragePct != null && course.readinessScore != null ? (
                        <span className="text-label text-lantern-text-tertiary">
                          {course.coveredCount}/{course.outlineTotal} topics · syllabus {course.coveragePct}%
                        </span>
                      ) : null}
                    </div>

                  </button>

                  {/* The three topics holding the score down, named — a score
                      without them is a verdict rather than a lead. */}
                  {row.weakestChips.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {row.weakestChips.map(chip => (
                        <li
                          key={chip}
                          className="rounded-full bg-lantern-feature-tests-tint px-2 py-0.5 text-label font-medium text-lantern-feature-tests-ink"
                        >
                          {chip}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* ONE action. Rendered only when the host wired somewhere
                      for it to go. */}
                  {canRun(row.nextAction.target) ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => run(row.nextAction.target)}
                        aria-label={row.nextAction.accessibilityLabel}
                        className="rounded-lg bg-lantern-feature-tests-tint px-3 py-1.5 text-caption font-semibold text-lantern-feature-tests-ink transition-opacity hover:opacity-80"
                      >
                        {row.nextAction.label}
                      </button>
                      {row.nextAction.reason ? (
                        <p className="mt-1 text-label text-lantern-text-tertiary">
                          {row.nextAction.reason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* The countdown's stand-in when there is no exam date —
                      never a second action beside a countdown. */}
                  {row.examDatePrompt && onOpenAcademicSettings ? (
                    <button
                      type="button"
                      onClick={() => run(row.examDatePrompt!.target)}
                      className="mt-1.5 text-label font-medium text-lantern-primary hover:underline"
                      aria-label={`${row.examDatePrompt.label}. ${row.examDatePrompt.reason}`}
                    >
                      {row.examDatePrompt.label}
                    </button>
                  ) : null}

                  {expanded ? (
                    <div className="mt-3 pt-3 border-t border-lantern-border/60">
                      {course.topics.length === 0 ? (
                        <p className="text-caption text-lantern-text-tertiary">
                          No outline or study data for this course yet. Add topics below, or just
                          start studying — readiness fills in on its own.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                          {course.topics.map(topic => (
                            <li
                              key={topic.topicId ?? `tag:${topic.title}`}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="min-w-0 truncate text-caption text-lantern-text">
                                {topic.title}
                                {!topic.inOutline ? (
                                  <span className="ml-1 text-label tracking-normal text-lantern-text-tertiary">(outside outline)</span>
                                ) : null}
                              </span>
                              <span
                                className={`shrink-0 px-1.5 py-0.5 rounded-full text-label tracking-normal font-medium ${BAND_CHIP_CLASSES[topic.band]}`}
                              >
                                {topic.masteryScore != null
                                  ? `${topic.masteryScore}%`
                                  : topic.covered
                                    ? MASTERY_BAND_LABELS.unknown
                                    : 'Not started'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* The list above is a report; this is how to change it.
                          Without it a student who sees a missing or misspelt
                          topic here has nowhere to go. */}
                      <button
                        type="button"
                        onClick={() =>
                          run({
                            kind: 'topics',
                            courseId: course.courseId,
                            courseLabel: course.courseCode || undefined,
                          })
                        }
                        className="mt-2 text-caption font-semibold text-lantern-primary hover:underline"
                      >
                        Edit topics
                      </button>

                      <div className="mt-3">
                        {signal === 'loading' ? (
                          <p className="text-label text-lantern-text-tertiary" role="status">
                            Checking what the class finds hard…
                          </p>
                        ) : signal && signal.available && signal.topics && signal.topics.length > 0 ? (
                          <p className="text-label text-lantern-text-secondary">
                            <span className="font-semibold">Your class finds hardest:</span>{' '}
                            {signal.topics.slice(0, 3).map(t => t.topic).join(', ')}
                            <span className="text-lantern-text-tertiary"> · {signal.cohortSize} students</span>
                          </p>
                        ) : signal ? (
                          <p className="text-label text-lantern-text-tertiary">
                            Class insights unlock once 20+ students on this course have study data.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ManageOutlineModal
        isOpen={!!outlineCourse}
        onClose={() => setOutlineCourse(null)}
        courseId={outlineCourse?.id ?? ''}
        courseLabel={outlineCourse?.label ?? null}
        // The outline drives coverage, so every number on this card follows it.
        onChanged={() => void load()}
      />
    </div>
  );
};

export default CourseReadinessCard;
