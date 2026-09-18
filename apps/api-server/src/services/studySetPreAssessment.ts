/**
 * The per-unit pre-assessment — "See what you already know".
 *
 * Purpose: a short diagnostic test scoped to ONE unit of a study set's plan.
 * The student takes it once; the result is allowed to move that unit's topics
 * forward so the plan stops sending them to material they already hold.
 *
 * Exports: `buildPreAssessmentSource` (pure, tested — the labelled source text
 * the generator reads), `attributeQuestionsToTopics` (pure, tested — how a
 * generated question is mapped back to a plan topic), `gradePreAssessment`
 * (pure, tested — a stored session's questions + answers into per-topic
 * tallies) and `getStudySetPreAssessmentService`, the process singleton the
 * route calls.
 *
 * What it touches: `study_set_units` / `study_set_topics` through
 * `StudySetsService` (never directly), `notes` through `dataLayer.notes`, and
 * `test_sessions` through `dataLayer.tests.createPersonalTest` /
 * `findUnitPreAssessment`. It writes NO table of its own — the whole feature is
 * additive on top of surfaces that already exist, which is why it needs no
 * migration.
 *
 * Ownership: every entry point takes the caller's id from the route (which took
 * it from the verified token) and opens by calling `StudySetsService.getPlan`,
 * which proves the parent set is the caller's before a single child row is
 * read. The service-role client bypasses RLS, so this is the access control,
 * not a convenience.
 *
 * Gotcha: a pre-assessment costs exactly ONE `generate_questions` AI credit,
 * charged by `aiRateLimitForFeature` BEFORE the handler runs. A resume — the
 * common case, because `Continue` on a half-finished diagnostic must not build
 * a second one — does no AI work, so it REFUNDS that credit before answering.
 * Any new early return added to the create path must refund too, or it silently
 * charges a student for nothing.
 */
import {
  PRE_ASSESSMENT_QUESTION_TARGET,
  preAssessmentCardAction,
  preAssessmentStatusUpdates,
  tallyPreAssessment,
  type PreAssessmentStatusUpdate,
  type PreAssessmentTopicScore,
} from '@lantern/shared/learning';
import { getNoteStudyContent } from '@lantern/shared/utils/noteStudyContent';
import { PublicError } from '../utils/safeError';
import { generateQuestionsFromNotes } from './aiService';
import { getStudySetsService, type StudySetTopicRow, type StudySetUnitRow } from './studySets';
import type { DataLayer } from './data';

/** How much material one topic may contribute. The generator caps at 6000. */
const PER_TOPIC_SOURCE_CHARS = 1200;
/** The whole source. Above this the generator truncates anyway. */
const MAX_SOURCE_CHARS = 6000;

function fail(message: string): never {
  throw new PublicError(message);
}

/** Case, punctuation and spacing folded away, so titles compare as meanings. */
function foldTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PreAssessmentTopicSource {
  topicId: string;
  title: string;
  /** Whatever material the topic's notes carry. May be empty. */
  content: string;
}

/**
 * The labelled source text the question generator reads.
 *
 * Each topic gets its own headed block carrying its exact title, because the
 * generator returns a free-text `topic` per question and that heading is the
 * only string it has to copy. Matching is done afterwards
 * (`attributeQuestionsToTopics`) and is allowed to fail — a question the model
 * did not attribute is counted towards no topic rather than guessed at.
 *
 * Topics with no material still get a heading: the model can write a definition
 * question from a topic NAME, and a unit whose notes are thin should still
 * produce a diagnostic rather than an error.
 */
export function buildPreAssessmentSource(
  topics: readonly PreAssessmentTopicSource[]
): string {
  const blocks: string[] = [];
  for (const topic of topics) {
    const title = topic.title.trim();
    if (!title) continue;
    const body = topic.content.trim().slice(0, PER_TOPIC_SOURCE_CHARS);
    blocks.push(body ? `## ${title}\n${body}` : `## ${title}`);
  }
  return blocks.join('\n\n').slice(0, MAX_SOURCE_CHARS);
}

/**
 * Map each generated question onto the plan topic it belongs to.
 *
 * Three passes, narrowest first: the model's own `topic` string folded and
 * matched exactly; then that string CONTAINED in a topic title (or the reverse,
 * which catches "Enzymes" against "Enzymes and catalysis"); then the question
 * text mentioning a topic title outright.
 *
 * `null` is a real answer and the right one when nothing matches. The tally
 * drops unattributed questions, so the worst case of a model that ignores the
 * headings is a diagnostic that changes no statuses — not one that marks the
 * wrong topic mastered.
 */
export function attributeQuestionsToTopics<T extends { topic?: unknown; text?: unknown }>(
  questions: readonly T[],
  topics: readonly { topicId: string; title: string }[]
): (T & { topicId: string | null })[] {
  const folded = topics.map((topic) => ({ ...topic, key: foldTitle(topic.title) }));
  return questions.map((question) => {
    const raw = typeof question.topic === 'string' ? foldTitle(question.topic) : '';
    const text = typeof question.text === 'string' ? foldTitle(question.text) : '';
    let match = raw ? folded.find((topic) => topic.key && topic.key === raw) : undefined;
    if (!match && raw) {
      match = folded.find(
        (topic) => topic.key && (topic.key.includes(raw) || raw.includes(topic.key))
      );
    }
    if (!match && text) {
      match = folded.find((topic) => topic.key && text.includes(topic.key));
    }
    return { ...question, topicId: match?.topicId ?? null };
  });
}

/**
 * Was this stored answer right?
 *
 * Deliberately string equality after trimming and case folding, matching what
 * `calculateTestScore` does on the same rows: a pre-assessment must not grade a
 * question more generously than the test screen already told the student it was
 * graded. An unanswered question counts as UNANSWERED, not as wrong — the
 * thresholds are ratios of what was actually attempted, so a student who ran
 * out of time on the last four is judged on the six they did.
 */
function answerIsCorrect(question: unknown, answer: unknown): boolean | null {
  const correct = (question as { correctAnswer?: unknown } | null)?.correctAnswer;
  const given =
    answer && typeof answer === 'object'
      ? (answer as { answer?: unknown; selectedAnswer?: unknown }).answer ??
        (answer as { selectedAnswer?: unknown }).selectedAnswer
      : answer;
  if (given === undefined || given === null || given === '') return null;
  if (typeof correct !== 'string') return null;
  return String(given).trim().toLowerCase() === correct.trim().toLowerCase();
}

/**
 * A stored session's questions and answers into per-topic tallies.
 *
 * The topic id rides on the QUESTION, written at generation time, so grading
 * never has to re-run the attribution (and cannot reach a different answer than
 * the one the student was tested under).
 */
export function gradePreAssessment(session: {
  questions?: unknown;
  user_answers?: unknown;
}): PreAssessmentTopicScore[] {
  const questions = Array.isArray(session.questions) ? session.questions : [];
  const raw = session.user_answers;
  const answers: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw) ? (raw as unknown[]) : null;
  const graded = questions.map((question, index) => {
    const id = (question as { id?: unknown })?.id;
    const answer = list ? list[index] : answers[String(id ?? `q${index + 1}`)];
    const correct = answerIsCorrect(question, answer);
    return {
      topicId:
        typeof (question as { topicId?: unknown })?.topicId === 'string'
          ? ((question as { topicId: string }).topicId)
          : null,
      correct,
    };
  });
  // An unanswered question is dropped before the tally so it cannot count as
  // an attempt the student got wrong.
  return tallyPreAssessment(graded.filter((row) => row.correct !== null));
}

export interface PreAssessmentStartResult {
  testId: string;
  /** `created` spent an AI credit; `resumed` refunded it. */
  action: 'created' | 'resumed';
  questionCount: number;
  unitTitle: string;
}

export interface PreAssessmentResultsOutcome {
  updates: PreAssessmentStatusUpdate[];
  scores: PreAssessmentTopicScore[];
}

export class StudySetPreAssessmentService {
  constructor(private readonly data: DataLayer) {}

  /** The unit and its topics, with the parent set's ownership already proven. */
  private async unitContext(
    userId: string,
    setId: string,
    unitId: string
  ): Promise<{ unit: StudySetUnitRow; topics: StudySetTopicRow[] }> {
    const plan = await getStudySetsService(this.data).getPlan(userId, setId);
    const unit = plan.units.find((row) => row.id === unitId);
    if (!unit) fail('Unit not found');
    const topics = plan.topics
      .filter((topic) => topic.unitId === unitId)
      .sort((a, b) => a.position - b.position);
    if (topics.length === 0) fail('This unit has no topics to check yet');
    return { unit, topics };
  }

  /**
   * Start — or resume — this unit's pre-assessment.
   *
   * IDEMPOTENT BY DESIGN. An unfinished session for the unit is returned as it
   * stands, so a second `Continue` reopens the same ten questions rather than
   * generating and charging for a fresh set. Only `retake: true` (the card's
   * own verb once a diagnostic is finished) builds a new one over a completed
   * session, and a completed session without `retake` is likewise returned
   * rather than re-generated.
   */
  async start(
    userId: string,
    setId: string,
    unitId: string,
    options: { retake?: boolean } = {}
  ): Promise<PreAssessmentStartResult> {
    const { unit, topics } = await this.unitContext(userId, setId, unitId);

    const existing = await this.data.tests.findUnitPreAssessment(userId, setId, unitId);
    const action = preAssessmentCardAction(
      existing ? { id: String(existing.id), completedAt: existing.end_time ?? null } : null
    );
    if (existing && (action === 'resume' || !options.retake)) {
      return {
        testId: String(existing.id),
        action: 'resumed',
        questionCount: Array.isArray(existing.questions) ? existing.questions.length : 0,
        unitTitle: unit.title,
      };
    }

    const sources = await this.topicSources(userId, topics);
    const source = buildPreAssessmentSource(sources);
    if (!source) fail('This unit has nothing to build a check from yet');

    const generated = await generateQuestionsFromNotes(source, {
      count: PRE_ASSESSMENT_QUESTION_TARGET,
      difficulty: 'mixed',
      // Mixed types, as the reference's diagnostic is — but no free-text:
      // a three-minute check the student has to type into is not three
      // minutes, and short answers cannot be graded without another model
      // call, which would double what this costs.
      questionTypes: ['multiple_choice', 'true_false'],
      // `subject` is interpolated into the system prompt. The unit title is
      // the student's own text, so it is length-capped and stripped of the
      // characters a prompt injection would need, the way every other caller
      // of this generator fences its inputs.
      subject: unit.title.replace(/[^\w\s-]/g, ' ').slice(0, 80),
    });

    const attributed = attributeQuestionsToTopics(
      generated.questions,
      sources.map((row) => ({ topicId: row.topicId, title: row.title }))
    );
    const questions = attributed.map((question, index) => ({
      id: `pa-${index + 1}`,
      text: question.text,
      type: question.type,
      options: question.options,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      topic: question.topic,
      // The plan link, written once at generation so grading can never reach
      // a different attribution than the student was tested under.
      topicId: question.topicId,
    }));
    if (questions.length === 0) fail('Could not build a check from this unit yet');

    const created = await this.data.tests.createPersonalTest(
      {
        title: `Pre-assessment · ${unit.title}`.slice(0, 120),
        questions,
        studySetId: setId,
        config: {
          source: 'pre_assessment',
          // The link the resume query reads. Written unconditionally, unlike
          // the `study_set_id` COLUMN, which a hand-applied migration gates.
          preAssessment: {
            studySetId: setId,
            unitId,
            unitTitle: unit.title,
            topicIds: sources.map((row) => row.topicId),
          },
        },
      },
      userId
    );

    return {
      testId: String(created?.id ?? ''),
      action: 'created',
      questionCount: questions.length,
      unitTitle: unit.title,
    };
  }

  /**
   * Grade a finished pre-assessment onto the plan.
   *
   * Runs through `updateTopicStatus`, one call per topic that actually moves,
   * so every write carries the same ownership predicate the plan's own PATCH
   * does. Re-running it is harmless: the mapping never moves a topic backwards,
   * so a second call against the same session computes the same statuses, finds
   * them already stored, and writes nothing.
   */
  async applyResults(
    userId: string,
    setId: string,
    unitId: string,
    testId: string
  ): Promise<PreAssessmentResultsOutcome> {
    const { topics } = await this.unitContext(userId, setId, unitId);
    const { data: session, error } = await this.data.tests.getOwnedTestSession(testId, userId);
    if (error) throw error;
    if (!session) fail('That check could not be found');
    const link = (session.config as { preAssessment?: { unitId?: unknown } } | null)
      ?.preAssessment;
    if (!link || String(link.unitId ?? '') !== unitId) {
      fail('That test is not this unit’s check');
    }

    const scores = gradePreAssessment(session);
    const updates = preAssessmentStatusUpdates(scores, topics);
    const sets = getStudySetsService(this.data);
    for (const update of updates) {
      await sets.updateTopicStatus(userId, setId, update.topicId, update.status);
    }
    return { updates, scores };
  }

  /** Each topic's title plus whatever its source notes carry. */
  private async topicSources(
    userId: string,
    topics: readonly StudySetTopicRow[]
  ): Promise<PreAssessmentTopicSource[]> {
    const contentByNote = new Map<string, string>();
    const wanted = new Set<string>();
    for (const topic of topics) {
      const noteId = topic.sourceNoteIds[0];
      if (noteId) wanted.add(noteId);
    }
    for (const noteId of wanted) {
      try {
        const note = await this.data.notes.getNote(noteId, userId);
        const attachments = await this.data.notes.getNoteAttachments(noteId);
        contentByNote.set(
          noteId,
          getNoteStudyContent({
            sourceType: note?.sourceType,
            body: note?.body,
            summary: note?.summary,
            attachments,
          })
        );
      } catch {
        // A material that has been deleted out from under a topic is not a
        // reason to refuse the whole diagnostic — that topic simply
        // contributes its title, which is still something to ask about.
        contentByNote.set(noteId, '');
      }
    }
    return topics.map((topic) => ({
      topicId: topic.id,
      title: topic.title,
      content: contentByNote.get(topic.sourceNoteIds[0] ?? '') ?? '',
    }));
  }
}

let singleton: StudySetPreAssessmentService | null = null;

export function getStudySetPreAssessmentService(data: DataLayer): StudySetPreAssessmentService {
  if (!singleton) singleton = new StudySetPreAssessmentService(data);
  return singleton;
}

/** Test hook: drop the singleton so a fresh DataLayer is picked up. */
export function __resetStudySetPreAssessmentServiceForTests(): void {
  singleton = null;
}
