import React, { useCallback, useEffect, useState } from 'react';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  MASTERY_BAND_LABELS,
  examCountdownLabel,
  masteryBand,
  type CourseClassSignal,
  type CourseReadiness,
} from '@lantern/shared/network';
import { fetchCourseReadiness, refreshMasteryGraph } from '../services/supabase';

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

export const CourseReadinessCard: React.FC = () => {
  const [courses, setCourses] = useState<CourseReadiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [classSignals, setClassSignals] = useState<Record<string, CourseClassSignal | 'loading'>>({});

  const load = useCallback(async () => {
    try {
      const data = await fetchCourseReadiness();
      setCourses(data.courses);
      setError(null);
    } catch (e) {
      console.error('Error loading course readiness:', e);
      setError('Could not load readiness right now.');
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

  if (courses !== null && courses.length === 0 && !error) {
    // No enrolled courses: the academic-profile nudge above this card already
    // sells that setup — an extra empty card here would just be noise.
    return null;
  }

  return (
    <div className="bg-lantern-surface rounded-2xl p-4 sm:p-5 ring-1 ring-lantern-border/60">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <AcademicCapIcon className="w-5 h-5 text-lantern-primary shrink-0" aria-hidden />
          <h2 className="text-base font-bold text-lantern-text truncate">Exam readiness</h2>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors disabled:opacity-60"
          aria-label="Recompute readiness from your latest tests and reviews"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      {error ? (
        <p className="text-sm text-lantern-text-secondary py-2">{error}</p>
      ) : courses === null ? (
        <p className="text-sm text-lantern-text-tertiary py-2" role="status">
          Working out where you stand…
        </p>
      ) : (
        <div className="space-y-3">
          {courses.map(course => {
            const pct = course.readinessScore ?? course.coveragePct;
            const band = masteryBand(course.readinessScore);
            const expanded = expandedCourseId === course.courseId;
            const signal = classSignals[course.courseId];
            const barClass =
              course.readinessScore != null
                ? BAND_BAR_CLASSES[band]
                : 'bg-lantern-primary/50';
            const statusLine =
              course.readinessScore != null
                ? `Readiness ${course.readinessScore}%`
                : course.coveragePct != null
                  ? `${course.coveredCount} of ${course.outlineTotal} topics started`
                  : course.averageMastery != null
                    ? `Average mastery ${course.averageMastery}%`
                    : 'No study data yet';

            return (
              <div key={course.courseId} className="rounded-xl border border-lantern-border/70 p-3">
                <button
                  type="button"
                  onClick={() => toggleCourse(course.courseId)}
                  aria-expanded={expanded}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-lantern-text truncate">
                      {course.courseCode || 'Course'}
                      {course.courseTitle ? (
                        <span className="font-normal text-lantern-text-secondary"> — {course.courseTitle}</span>
                      ) : null}
                    </p>
                    <span className="flex items-center gap-1.5 shrink-0 text-xs text-lantern-text-tertiary">
                      {course.daysUntil != null ? examCountdownLabel(course.daysUntil) : null}
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
                    <span className="text-xs text-lantern-text-secondary">{statusLine}</span>
                    {course.coveragePct != null && course.readinessScore != null ? (
                      <span className="text-[11px] text-lantern-text-tertiary">
                        {course.coveredCount}/{course.outlineTotal} topics · syllabus {course.coveragePct}%
                      </span>
                    ) : null}
                  </div>

                  {course.nextTopic ? (
                    <p className="mt-1.5 text-xs text-lantern-primary font-medium">
                      Start here: {course.nextTopic.title}
                    </p>
                  ) : null}
                </button>

                {expanded ? (
                  <div className="mt-3 pt-3 border-t border-lantern-border/60">
                    {course.topics.length === 0 ? (
                      <p className="text-xs text-lantern-text-tertiary">
                        No outline or study data for this course yet. Add topics from the course
                        outline in your Library, or just start studying — readiness fills in on its
                        own.
                      </p>
                    ) : (
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {course.topics.map(topic => (
                          <li
                            key={topic.topicId ?? `tag:${topic.title}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate text-xs text-lantern-text">
                              {topic.title}
                              {!topic.inOutline ? (
                                <span className="ml-1 text-[10px] text-lantern-text-tertiary">(outside outline)</span>
                              ) : null}
                            </span>
                            <span
                              className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${BAND_CHIP_CLASSES[topic.band]}`}
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

                    <div className="mt-3">
                      {signal === 'loading' ? (
                        <p className="text-[11px] text-lantern-text-tertiary" role="status">
                          Checking what the class finds hard…
                        </p>
                      ) : signal && signal.available && signal.topics && signal.topics.length > 0 ? (
                        <p className="text-[11px] text-lantern-text-secondary">
                          <span className="font-semibold">Your class finds hardest:</span>{' '}
                          {signal.topics.slice(0, 3).map(t => t.topic).join(', ')}
                          <span className="text-lantern-text-tertiary"> · {signal.cohortSize} students</span>
                        </p>
                      ) : signal ? (
                        <p className="text-[11px] text-lantern-text-tertiary">
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
  );
};

export default CourseReadinessCard;
