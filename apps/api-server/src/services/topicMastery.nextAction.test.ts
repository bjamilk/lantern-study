/**
 * The server half of the next action: the join from a weak outline topic to a
 * deck or note the student actually owns, and the unmatched-tag drift list
 * that keeps the shared outline honest.
 */
import { TopicMasteryService } from './topicMastery';

type ChainResult = { data?: unknown; error?: unknown };

function chain(result: ChainResult) {
  const api: any = {};
  const self = () => api;
  for (const method of ['select', 'eq', 'in', 'not', 'gte', 'lt', 'order', 'limit']) {
    api[method] = self;
  }
  api.then = (resolve: (value: ChainResult) => unknown) =>
    Promise.resolve({ data: null, error: null, ...result }).then(resolve);
  return api;
}

function fakeService(tables: Record<string, ChainResult>) {
  const self: any = Object.create(TopicMasteryService.prototype);
  self.supabaseService = {
    getClient: () => ({
      from: (table: string) => chain(tables[table] ?? { data: [], error: null }),
    }),
  };
  return self as TopicMasteryService;
}

const COURSE = [
  {
    course_id: 'course-1',
    exam_date: '2999-01-10',
    courses: { id: 'course-1', code: 'BCH 201', title: 'Biochemistry' },
  },
];

const OUTLINE = [
  { id: 't1', course_id: 'course-1', title: 'Glycolysis', position: 10 },
  { id: 't2', course_id: 'course-1', title: 'Krebs cycle', position: 20 },
];

const MASTERY = [
  { topic: 'Glycolysis', course_id: 'course-1', mastery_score: 80, attempts: 6, cards_total: 10, cards_due: 1 },
  { topic: 'Krebs cycle', course_id: 'course-1', mastery_score: 30, attempts: 6, cards_total: 10, cards_due: 4 },
];

describe('courseReadiness next action', () => {
  it('points at the deck filed under the weakest outline topic', async () => {
    const service = fakeService({
      user_courses: { data: COURSE },
      course_topics: { data: OUTLINE },
      user_topic_mastery: { data: MASTERY },
      decks: { data: [{ id: 'deck-2', name: 'Krebs cards', topic_id: 't2' }] },
    });
    const [course] = await service.courseReadiness('user-1');
    expect(course.nextAction.kind).toBe('review-deck');
    expect(course.nextAction.targetId).toBe('deck-2');
    expect(course.nextAction.topicTitle).toBe('Krebs cycle');
  });

  it('falls back to a note when no deck is filed under the topic', async () => {
    const service = fakeService({
      user_courses: { data: COURSE },
      course_topics: { data: OUTLINE },
      user_topic_mastery: { data: MASTERY },
      notes: { data: [{ id: 'note-2', title: 'Krebs summary', topic_id: 't2' }] },
    });
    const [course] = await service.courseReadiness('user-1');
    expect(course.nextAction.kind).toBe('study-topic-note');
    expect(course.nextAction.targetId).toBe('note-2');
  });

  it('degrades to a course-level action rather than inventing a target', async () => {
    const service = fakeService({
      user_courses: { data: COURSE },
      course_topics: { data: OUTLINE },
      user_topic_mastery: { data: MASTERY },
      decks: { error: { message: 'column decks.topic_id does not exist' } },
      notes: { error: { message: 'column notes.topic_id does not exist' } },
    });
    const [course] = await service.courseReadiness('user-1');
    expect(course.nextAction.kind).toBe('take-test');
    expect(course.nextAction.targetId).toBe('course-1');
  });

  it('keeps readiness null when there is no performance evidence', async () => {
    const service = fakeService({
      user_courses: { data: COURSE },
      course_topics: { data: OUTLINE },
      user_topic_mastery: { data: [] },
    });
    const [course] = await service.courseReadiness('user-1');
    expect(course.readinessScore).toBeNull();
    expect(course.averageMastery).toBeNull();
    expect(course.nextAction.kind).toBe('take-test');
  });
});

describe('unmatchedTags', () => {
  it('lists only tags the shared outline does not already contain', async () => {
    const service = fakeService({
      course_topics: { data: [{ title: 'Glycolysis' }] },
      user_topic_mastery: { data: [{ topic: 'glycolysis', attempts: 4 }, { topic: 'Krebs cycle', attempts: 3 }] },
      decks: { data: [{ id: 'deck-1' }] },
      flashcards: { data: [{ tags: ['Krebs cycle', 'General', 'Electron transport'] }] },
    });
    const result = await service.unmatchedTags('user-1', '11111111-1111-4111-8111-111111111111');
    expect(result.tags.map((t) => t.tag)).toEqual(['Krebs cycle', 'Electron transport']);
    // The tests source counts attempts, so the tag studied most sorts first.
    expect(result.tags[0].sources).toEqual(['cards', 'tests']);
  });

  it('refuses a malformed course id instead of answering for every course', async () => {
    const service = fakeService({});
    expect(await service.unmatchedTags('user-1', 'not-a-uuid')).toEqual({
      courseId: 'not-a-uuid',
      outlineTotal: 0,
      tags: [],
    });
  });
});
