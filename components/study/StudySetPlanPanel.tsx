import React, { useEffect, useMemo, useState } from 'react';
import {
  initialOpenUnitId,
  isWalkableAttachment,
  pickRecommendedTopic,
  planTimeline,
  planTopicActivity,
  STUDY_SET_MODES,
  studySetPlanProgress,
  studySetProgressPercent,
  todayDateOnlyLocal,
  topicUnitLabel,
  topicsFromReadingNotes,
  unitsForTopics,
  unitsFromSourceMaterials,
  type PlanTopicActivity,
  type StudySetMode,
  type StudySetTopic,
  type StudySetUnit,
  type UpcomingExam,
} from '@lantern/shared';
import { AppMode, type StudyNote } from '../../types';
import { Button, Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { ExamDateField } from './ExamDateField';
import { StudyPlanTimeline } from './StudyPlanTimeline';
import { isPastExam } from './SetRoomFooter';
import { fetchStudySetPlan, replaceStudySetPlan, updateStudySetTopicStatus } from '../../services/academic';
import { useAppNavigation } from '../../hooks/useAppNavigation';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';

interface StudySetPlanPanelProps {
  studySetId: string;
  notes: StudyNote[];
  mode: StudySetMode;
  /** Exams read off the set's calendar notes. Past ones included. */
  exams?: readonly UpcomingExam[];
  onModeChange: (mode: StudySetMode) => void;
  /**
   * Open the topic's next door. The kind is a workspace activity id, so the
   * caller navigates to that activity's OWN route and the lit chip matches.
   */
  onStart: (kind: PlanTopicActivity, noteId?: string) => void;
  /** Defaults to the set's own calendar route. */
  onViewSchedule?: () => void;
  /** Defaults to the set's own add-material route. */
  onAddSyllabus?: () => void;
}

/**
 * The Study Plan tab, drawn as a page rather than a list.
 *
 * WHAT WAS HERE. A stack of bordered boxes: mode chips, a recommendation card,
 * a diagnostic, then units of checkboxes behind a hairline. Everything the
 * reference puts on this screen existed as data and none of it was legible as a
 * ROUTE — no rail, no per-unit progress, nothing struck through, no standing
 * answer to "how far in am I".
 *
 * So the body is now the spine (`StudyPlanTimeline`) and a sidebar that carries
 * the three standing facts: progress, the exam you are working towards, and the
 * syllabus that would make the plan sharper. Every rule about what is next and
 * what strikes through is in `@lantern/shared`'s `planTimeline`.
 *
 * DELIBERATELY ABSENT. The reference's `Sources:` chips (a topic carries note
 * ids but no verified provenance, and a chip pointing at the wrong material is
 * worse than no chip) and its `Sort By` control (the plan has one order, the
 * one the units were built in — a sort menu with a single option is furniture).
 */
export const StudySetPlanPanel: React.FC<StudySetPlanPanelProps> = ({
  studySetId,
  notes,
  mode,
  exams = [],
  onModeChange,
  onStart,
  onViewSchedule,
  onAddSyllabus,
}) => {
  const showToast = useToastStore((s) => s.showToast);
  const { navigateTo } = useAppNavigation();
  // The exam date the plan is built from lives on the set. This tab is the
  // only place a set-scoped student can reach it — StudyCalendar, which used
  // to own the field, is never rendered for a set.
  const studySets = useStudySetStore((s) => s.sets);
  const loadStudySets = useStudySetStore((s) => s.loadSets);
  const examDate = studySets.find((row) => row.id === studySetId)?.examDate ?? null;
  const fallback = useMemo(() => topicsFromReadingNotes(studySetId, notes), [notes, studySetId]);
  const [storedUnits, setStoredUnits] = useState<StudySetUnit[]>([fallback.unit]);
  const [storedTopics, setStoredTopics] = useState<StudySetTopic[]>(fallback.topics);
  const [generating, setGenerating] = useState(false);
  const [diagnosticIndex, setDiagnosticIndex] = useState<number | null>(null);
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});
  const [seededUnitId, setSeededUnitId] = useState<string | null>(null);

  // A local plan files every topic under one unit called "Your materials",
  // which draws one node on a spine — no structure at all for a student with
  // six lectures. Group by the material each topic came from, exactly as the
  // set room's plan band does, so both surfaces name the same units.
  const grouped = storedUnits.length > 1 ? null : unitsFromSourceMaterials(storedTopics, notes);
  const topics = grouped && grouped.units.length > 1 ? grouped.topics : storedTopics;
  const units = unitsForTopics(
    grouped && grouped.units.length > 1 ? grouped.units : storedUnits,
    topics
  );

  // A set opened straight into the Plan tab may reach here before the sets
  // store has any row, which would show an empty field over a saved date.
  useEffect(() => {
    void loadStudySets().catch(() => undefined);
  }, [loadStudySets]);

  useEffect(() => {
    let cancelled = false;
    void fetchStudySetPlan(studySetId)
      .then((data) => {
        if (cancelled) return;
        const nextUnits = Array.isArray((data as { units?: StudySetUnit[] })?.units)
          ? (data as { units: StudySetUnit[] }).units
          : [];
        const nextTopics = Array.isArray((data as { topics?: StudySetTopic[] })?.topics)
          ? (data as { topics: StudySetTopic[] }).topics
          : [];
        if (nextTopics.length > 0) {
          setStoredUnits(nextUnits);
          setStoredTopics(nextTopics);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studySetId]);

  const progress = studySetPlanProgress(topics);
  const percent = studySetProgressPercent(progress);
  const recommended = pickRecommendedTopic(topics, mode);
  const timeline = planTimeline(units, topics, recommended?.id ?? null);

  // Open the unit holding the recommendation once, when the plan first has one.
  // Seeding by id rather than by a boolean means a student who shut that unit
  // keeps it shut, and a plan that arrives from the server later still opens.
  const seedUnitId = initialOpenUnitId(timeline);
  useEffect(() => {
    if (!seedUnitId || seedUnitId === seededUnitId) return;
    setSeededUnitId(seedUnitId);
    setOpenUnits((current) => ({ ...current, [seedUnitId]: true }));
  }, [seedUnitId, seededUnitId]);

  const setStatus = (topic: StudySetTopic, next: StudySetTopic['status']) => {
    setStoredTopics((rows) =>
      rows.map((row) => (row.id === topic.id ? { ...row, status: next } : row))
    );
    void updateStudySetTopicStatus(studySetId, topic.id, next).catch(() => undefined);
  };

  const startTopic = (topic: StudySetTopic) => {
    // Reading splits on what the source note actually carries: the walkthrough
    // pages a PDF or slides and has nothing to show without one, so a plain
    // note is read in the studio instead. Deciding that HERE — where the notes
    // are — is what keeps `Continue` off a screen that would ask the student
    // to "select a note with a PDF".
    const noteId = topic.sourceNoteIds[0];
    const sourceNote = noteId ? notes.find((row) => row.id === noteId) : undefined;
    const hasWalkableSource = Boolean(sourceNote?.attachments?.some(isWalkableAttachment));
    onStart(planTopicActivity(topic, { hasWalkableSource }), noteId);
  };

  const goToSetActivity = (workspaceActivity: 'calendar' | 'add') => {
    navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId, workspaceActivity });
  };

  const [planDraft, setPlanDraft] = useState(false);

  const generateFromNotes = async () => {
    setGenerating(true);
    try {
      const built = topicsFromReadingNotes(studySetId, notes);
      setStoredUnits([built.unit]);
      setStoredTopics(built.topics);
      setPlanDraft(true);
      showToast('Draft plan ready — accept it onto this set, regenerate, or decline.', 'success');
    } catch {
      setStoredUnits([fallback.unit]);
      setStoredTopics(fallback.topics);
      setPlanDraft(true);
      showToast('Using a local plan from your notes.', 'info');
    } finally {
      setGenerating(false);
    }
  };

  const acceptPlan = async () => {
    setGenerating(true);
    try {
      const saved = await replaceStudySetPlan(studySetId, {
        units: units.map((unit, index) => ({ title: unit.title, position: unit.position ?? index })),
        topics: topics.map((topic) => ({
          unitIndex: Math.max(
            0,
            units.findIndex((unit) => unit.id === topic.unitId)
          ),
          title: topic.title,
          position: topic.position,
          status: topic.status,
          sourceNoteIds: topic.sourceNoteIds,
        })),
      });
      setStoredUnits((saved as { units: StudySetUnit[] }).units || units);
      setStoredTopics((saved as { topics: StudySetTopic[] }).topics || topics);
      setPlanDraft(false);
      showToast('Study plan accepted onto this set.', 'success');
    } catch {
      showToast('Could not save that plan. It is still on this screen.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const declinePlan = async () => {
    setStoredUnits([]);
    setStoredTopics([]);
    setPlanDraft(false);
    try {
      await replaceStudySetPlan(studySetId, { units: [], topics: [] });
      showToast('Plan declined.', 'info');
    } catch {
      showToast('Cleared the draft plan on this screen.', 'info');
    }
  };

  const today = todayDateOnlyLocal();
  // The set's own date is the one `+ Add` writes, so it belongs in the list
  // even when no calendar note mentions it. Deduped by date — a set whose exam
  // is also a calendar note should appear once.
  const examRows = [
    ...(examDate ? [{ title: 'Exam', examDate }] : []),
    ...exams.filter((exam) => exam.examDate !== examDate),
  ].sort((a, b) => a.examDate.localeCompare(b.examDate));
  const [addingExam, setAddingExam] = useState(false);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-heading text-lantern-text">Study plan</h2>
            <p className="text-caption text-lantern-text-secondary mt-1">
              Customise it with the mode, then work down the spine.
            </p>
          </div>

          {/* `Mode:` is kept because the model has real modes that change which
              topic is recommended. `Sort By` is not — see the file comment. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-lantern-text-secondary">Mode</span>
            {STUDY_SET_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onModeChange(item.id)}
                aria-pressed={mode === item.id}
                className={`min-h-[40px] rounded-full border px-3 text-caption ${
                  mode === item.id
                    ? 'border-lantern-text font-semibold text-lantern-text'
                    : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-text-tertiary'
                }`}
                title={item.promise}
              >
                {item.label}
              </button>
            ))}
          </div>

          {topics.length === 0 ? (
            <Card padding="md">
              <p className="text-body text-lantern-text-secondary">
                Add materials, then generate topics. A quick check can mark what you already know.
              </p>
              <Button
                className="mt-3"
                onClick={() => void generateFromNotes()}
                disabled={generating || notes.length === 0}
              >
                {generating ? 'Building…' : 'Generate topics from materials'}
              </Button>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-2">
              {planDraft ? (
                <Button onClick={() => void acceptPlan()} disabled={generating}>
                  Accept plan
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void generateFromNotes()}
                disabled={generating || notes.length === 0}
              >
                {generating ? 'Building…' : 'Regenerate'}
              </Button>
              <Button variant="ghost" onClick={() => void declinePlan()} disabled={generating}>
                Decline
              </Button>
            </div>
          )}

          {/* The reference's highlighted CTA row. Shown only while a real
              pre-test exists to run — the self-rating pass below — and hidden
              once it has been worked through, rather than sitting there for
              ever offering three minutes that do nothing. */}
          {topics.length > 0 && diagnosticIndex === null ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-lantern-border bg-lantern-feature-ai-tint/40 p-3">
              <AppIcon name="sparkles" size={18} className="text-lantern-feature-ai-ink" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-lantern-text">
                  See what you already know
                </span>
                <span className="block text-caption text-lantern-text-secondary">
                  Takes about 3 minutes · marks topics covered so the plan skips them
                </span>
              </span>
              <button
                type="button"
                onClick={() => setDiagnosticIndex(0)}
                className="shrink-0 min-h-[40px] rounded-full bg-lantern-text px-4 text-caption font-semibold text-lantern-surface"
              >
                Continue
              </button>
            </div>
          ) : null}

          {diagnosticIndex !== null && topics[diagnosticIndex] ? (
            <Card padding="md">
              <p className="text-label uppercase text-lantern-text-secondary">Quick check</p>
              <p className="text-caption text-lantern-text-secondary mt-1">
                {topicUnitLabel(topics, units, topics[diagnosticIndex])} ·{' '}
                {diagnosticIndex + 1} of {topics.length}
              </p>
              <h3 className="text-heading text-lantern-text mt-1">{topics[diagnosticIndex].title}</h3>
              <p className="text-body text-lantern-text-secondary mt-2">
                Do you already know this well enough to skip it?
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  onClick={() => {
                    setStatus(topics[diagnosticIndex], 'covered');
                    setDiagnosticIndex(
                      diagnosticIndex + 1 >= topics.length ? null : diagnosticIndex + 1
                    );
                  }}
                >
                  I know this
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setDiagnosticIndex(
                      diagnosticIndex + 1 >= topics.length ? null : diagnosticIndex + 1
                    )
                  }
                >
                  Not yet
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDiagnosticIndex(null)}>
                  Stop the check
                </Button>
              </div>
            </Card>
          ) : null}

          <StudyPlanTimeline
            timeline={timeline}
            openUnitIds={openUnits}
            onToggleUnit={(unitId) =>
              setOpenUnits((current) => ({ ...current, [unitId]: !(current[unitId] ?? false) }))
            }
            onCycleStatus={(topic) =>
              setStatus(
                topic,
                topic.status === 'unseen' ? 'covered' : topic.status === 'covered' ? 'mastered' : 'unseen'
              )
            }
            onStartTopic={startTopic}
          />
        </div>

        <aside className="space-y-3">
          <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-heading text-lantern-text">Your progress</h3>
              <span className="text-heading tabular-nums text-lantern-feature-ai-ink">
                {percent}%
              </span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-lantern-feature-ai-tint"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Study plan progress"
            >
              <span
                className="block h-full rounded-full bg-lantern-feature-ai-ink"
                style={{ width: `${percent}%` }}
              />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Topics', value: progress.topics },
                { label: 'Covered', value: progress.covered },
                { label: 'Mastered', value: progress.mastered },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-caption text-lantern-text-secondary">{stat.label}</dt>
                  <dd className="text-heading tabular-nums text-lantern-text">{stat.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-caption text-lantern-text-secondary">
              Reading a topic covers it. Proving it in a quiz or a card review masters it.
            </p>
          </section>

          <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <h3 className="text-heading text-lantern-text">Add your syllabus</h3>
            <p className="mt-1 text-caption text-lantern-text-secondary">
              Tailor this plan to your class schedule and priorities.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => (onAddSyllabus ? onAddSyllabus() : goToSetActivity('add'))}
            >
              Add syllabus
            </Button>
          </section>

          <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-heading text-lantern-text">Exam dates</h3>
              <button
                type="button"
                onClick={() => setAddingExam((value) => !value)}
                aria-expanded={addingExam}
                className="inline-flex min-h-[40px] items-center gap-1 text-caption font-medium text-lantern-text hover:underline"
              >
                <AppIcon name="add" size={16} />
                Add
              </button>
            </div>

            {examRows.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {examRows.map((exam) => {
                  const past = isPastExam(exam.examDate, today);
                  return (
                    <li
                      key={`${exam.examDate}-${exam.title}`}
                      className={`flex items-center justify-between gap-2 text-caption ${
                        past ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'
                      }`}
                    >
                      <span className="truncate">{exam.title}</span>
                      <span className="shrink-0 tabular-nums">{exam.examDate}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-caption text-lantern-text-secondary">
                Add an exam so the plan knows what it is working towards.
              </p>
            )}

            {addingExam ? (
              <div className="mt-3">
                <ExamDateField
                  studySetId={studySetId}
                  value={examDate}
                  onSaved={(outcome) => {
                    // Left open on `unsupported`: the field prints why the date
                    // did not stick, and closing would hide that sentence.
                    if (outcome === 'saved') setAddingExam(false);
                  }}
                />
              </div>
            ) : null}

            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => (onViewSchedule ? onViewSchedule() : goToSetActivity('calendar'))}
            >
              View schedule
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default StudySetPlanPanel;
