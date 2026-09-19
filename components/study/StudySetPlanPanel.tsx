import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyPlanSyllabusNames,
  asPlanSortKey,
  initialOpenUnitId,
  orderTimelineBySyllabus,
  planSyllabusViewFor,
  isWalkableAttachment,
  pickRecommendedTopic,
  planTimeline,
  planTopicActivity,
  preAssessmentCardAction,
  sortPlanTimeline,
  studySetPlanProgress,
  studySetProgressPercent,
  todayDateOnlyLocal,
  topicsFromReadingNotes,
  unitsForTopics,
  unitsFromSourceMaterials,
  type PlanTopicActivity,
  type PreAssessmentCardAction,
  type StudySetPlanSyllabus,
  type StudySetMode,
  type StudySetTopic,
  type StudySetUnit,
  type UpcomingExam,
} from '@lantern/shared';
import { AppMode, type StudyNote } from '../../types';
import { Button, Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { ExamDateField } from './ExamDateField';
import { PlanCustomizeBar } from './PlanCustomizeBar';
import { PlanComingUpList, StudyPlanTimeline } from './StudyPlanTimeline';
import { UnitPreAssessmentCard } from './UnitPreAssessmentCard';
import { isPastExam } from './SetRoomFooter';
import {
  applyUnitPreAssessmentResults,
  fetchStudySetPlan,
  replaceStudySetPlan,
  startUnitPreAssessment,
  updateStudySetTopicStatus,
} from '../../services/academic';
import { useAppNavigation } from '../../hooks/useAppNavigation';
import { useStudySetStore } from '../../stores/studySetStore';
import { useUIStore } from '../../stores/uiStore';
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
  /** Opens the set's settings from the customize bar. Omitted hides the gear. */
  onOpenSettings?: () => void;
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
 * WAVE 2 (the StudyFetch parity pass) added the three things the reference has
 * on this page that Lantern did not: the `Customize your Study Plan` bar, a
 * `Sort By` that has three real orders to offer rather than one (see
 * `sortPlanTimeline`), and the per-unit pre-assessment — a REAL short
 * diagnostic built by the question generator, not the local self-rating walk
 * that used to stand in for it.
 *
 * STILL DELIBERATELY ABSENT: the reference's filter icon. There is nothing on a
 * plan row to filter by that the sort does not already express, and a control
 * that looks live and does nothing is what the declutter pass removed
 * everywhere else.
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
  onOpenSettings,
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
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});
  // The pre-assessment's per-unit state. Keyed by unit id because a student can
  // have finished one unit's check, be resuming another's, and have never
  // opened a third's — one flag for the page would collapse all three.
  const [preAction, setPreAction] = useState<Record<string, PreAssessmentCardAction>>({});
  const [preBusyUnitId, setPreBusyUnitId] = useState<string | null>(null);
  const [preMoved, setPreMoved] = useState<Record<string, number>>({});
  // Which check the student went off to take, so the panel knows what to grade
  // when they come back. A ref, not state: writing it must not re-render the
  // page the student is in the middle of leaving.
  const pendingCheck = useRef<{ unitId: string; testId: string } | null>(null);
  const sort = useUIStore((state) => asPlanSortKey(state.planSortBySet[studySetId]));
  const setPlanSort = useUIStore((state) => state.setPlanSort);
  const [seededUnitId, setSeededUnitId] = useState<string | null>(null);
  // The set's syllabus, as `GET …/plan` computed it against the SERVER's units.
  // Held raw: which view is actually drawn is `planSyllabusViewFor`'s decision,
  // below, because this panel does not always draw the server's units.
  const [planSyllabus, setPlanSyllabus] = useState<StudySetPlanSyllabus | null>(null);

  // A local plan files every topic under one unit called "Your materials",
  // which draws one node on a spine — no structure at all for a student with
  // six lectures. Group by the material each topic came from, exactly as the
  // set room's plan band does, so both surfaces name the same units.
  const grouped = storedUnits.length > 1 ? null : unitsFromSourceMaterials(storedTopics, notes);
  const topics = grouped && grouped.units.length > 1 ? grouped.topics : storedTopics;
  const drawnUnits = unitsForTopics(
    grouped && grouped.units.length > 1 ? grouped.units : storedUnits,
    topics
  );

  // The syllabus, read against the units THIS page is about to draw. When those
  // are the server's own the payload's view is used as-is; when they were
  // regrouped locally from the materials (ids the server has never seen) the
  // same pure function runs again over the local ids. Null when the set has no
  // syllabus, which is every set that has never had one uploaded — and then
  // every line below behaves exactly as it did before this existed.
  const syllabusView = useMemo(
    () =>
      planSyllabusViewFor({
        payload: planSyllabus,
        summary: planSyllabus?.summary ?? null,
        units: drawnUnits,
      }),
    [planSyllabus, drawnUnits]
  );
  // Renamed BEFORE the timeline is built: `unitSources` reads a unit's title to
  // decide whether its single material's chip would merely repeat the heading,
  // so renaming first is what makes that material's own name appear underneath
  // its new, course-given one.
  const units = useMemo(
    () => applyPlanSyllabusNames(drawnUnits, syllabusView),
    [drawnUnits, syllabusView]
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
        // Absent unless the set has a stored schedule, so `?? null` is the
        // normal answer and not a failure.
        setPlanSyllabus(
          (data as { syllabus?: StudySetPlanSyllabus })?.syllabus ?? null
        );
        // Which units already carry a check, so the first paint draws the right
        // verb. Without this a student who finished one is offered
        // "Continue · uses 1 AI credit" for work they have already done.
        const checks = Array.isArray(
          (data as { preAssessments?: { unitId: string; completedAt: string | null }[] })
            ?.preAssessments
        )
          ? (data as { preAssessments: { unitId: string; completedAt: string | null }[] })
              .preAssessments
          : [];
        setPreAction((current) => {
          const next = { ...current };
          for (const check of checks) {
            next[check.unitId] = preAssessmentCardAction({
              id: check.unitId,
              completedAt: check.completedAt,
            });
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studySetId]);

  const progress = studySetPlanProgress(topics);
  const percent = studySetProgressPercent(progress);
  const recommended = pickRecommendedTopic(topics, mode);
  // Syllabus order is applied to the BASE order, before the sort menu runs, so
  // `Unit order` — "the order the course teaches them" — is for the first time
  // literally the order the course teaches them, and the other two sorts go on
  // meaning what they say relative to it.
  const planOrder = orderTimelineBySyllabus(
    planTimeline(units, topics, recommended?.id ?? null),
    syllabusView
  );
  // Sorting happens AFTER the timeline is built, never before: the ring
  // percentages and the `next` row are facts about the plan, and a sort that
  // ran first would be ranking units by an arc it had not computed yet.
  const timeline = sortPlanTimeline(planOrder, sort);

  // Open the unit holding the recommendation once, when the plan first has one.
  // Seeding by id rather than by a boolean means a student who shut that unit
  // keeps it shut, and a plan that arrives from the server later still opens.
  const seedUnitId = initialOpenUnitId(planOrder);
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

  /**
   * A `Sources:` chip opens its material — the same two doors `Continue` uses
   * for reading, chosen the same way: a note carrying a PDF or slides opens in
   * the walkthrough, a plain note in the studio. The chip only ever exists for
   * a material this list resolved (`unitSources` drops the rest), so the note
   * lookup here cannot miss.
   */
  const openSource = (source: { id: string }) => {
    const note = notes.find((row) => row.id === source.id);
    const walkable = Boolean(note?.attachments?.some(isWalkableAttachment));
    onStart(walkable ? 'walkthrough' : 'notes', source.id);
  };

  /**
   * `Continue` on a unit's check.
   *
   * The server decides whether this generates or resumes — and refunds the
   * reserved AI credit when it resumes — so this does not have to guess, and a
   * student who presses it twice cannot be charged twice. What comes back is a
   * test id, which is opened on the room's OWN test screen through
   * `/study/sets/:id/test/:testId`: the app already seeds a set-scoped session
   * from that route, so the diagnostic is taken on the same screen as every
   * other test rather than on a second one built for it.
   */
  const startPreAssessment = async (unitId: string) => {
    if (preBusyUnitId) return;
    setPreBusyUnitId(unitId);
    try {
      const started = await startUnitPreAssessment(studySetId, unitId, {
        retake: (preAction[unitId] ?? 'start') === 'retake',
      });
      setPreAction((current) => ({ ...current, [unitId]: 'resume' }));
      // Remembered so the results can be graded onto the plan when the student
      // comes back from the test screen — the test itself knows nothing about
      // study plans, deliberately.
      pendingCheck.current = { unitId, testId: started.testId };
      navigateTo(AppMode.STUDY_SET_WORKSPACE, {
        studySetId,
        workspaceActivity: 'test',
        testId: started.testId,
      });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not start that check.',
        'error'
      );
    } finally {
      setPreBusyUnitId(null);
    }
  };

  /**
   * Grade a finished check onto the plan, on the way back to this page.
   *
   * Runs on MOUNT rather than on the test's submit, because the test screen is
   * a different route: leaving it unmounts this panel, and a callback threaded
   * through the workspace would have to survive that. The server is idempotent
   * here — it never moves a topic backwards, so a second call over the same
   * session finds every status already stored and writes nothing — which is
   * what makes running it on every return safe.
   */
  useEffect(() => {
    const pending = pendingCheck.current;
    if (!pending) return;
    pendingCheck.current = null;
    let cancelled = false;
    void applyUnitPreAssessmentResults(studySetId, pending.unitId, pending.testId)
      .then((outcome) => {
        if (cancelled) return;
        const updates = Array.isArray(outcome?.updates) ? outcome.updates : [];
        setPreAction((current) => ({ ...current, [pending.unitId]: 'retake' }));
        setPreMoved((current) => ({ ...current, [pending.unitId]: updates.length }));
        if (updates.length === 0) return;
        setStoredTopics((rows) =>
          rows.map((row) => {
            const update = updates.find((entry) => entry.topicId === row.id);
            return update ? { ...row, status: update.status } : row;
          })
        );
        showToast(
          `Your check moved ${updates.length} ${updates.length === 1 ? 'topic' : 'topics'} forward.`,
          'success'
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showToast, studySetId]);

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

          <PlanCustomizeBar
            mode={mode}
            onModeChange={onModeChange}
            sort={sort}
            onSortChange={(next) => setPlanSort(studySetId, next)}
            onOpenSettings={onOpenSettings}
          />

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

          <StudyPlanTimeline
            timeline={timeline}
            renderUnitPreAssessment={(unit) => (
              <UnitPreAssessmentCard
                action={preAction[unit.id] ?? 'start'}
                busy={preBusyUnitId === unit.id}
                covered={preMoved[unit.id] ?? null}
                onStart={() => void startPreAssessment(unit.id)}
              />
            )}
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
            materials={notes}
            onOpenSource={openSource}
            syllabus={syllabusView}
            sort={sort}
          />

          {/* Weeks with no material behind them. A list, under the plan, with
              one door — never units, never topics. See `PlanComingUpList`. */}
          <PlanComingUpList
            weeks={syllabusView?.comingUp ?? []}
            onAddMaterials={() => goToSetActivity('add')}
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
