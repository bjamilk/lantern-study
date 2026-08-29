/**
 * Course readiness: the syllabus-aware rollup must include exam-date-less
 * courses (day-one visibility), bridge outline titles to mastery tags, and
 * sort soonest-exam first. The arithmetic itself is pinned by the shared
 * computeCourseReadiness tests; these cover the service's fetching/mapping.
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

const COURSES = [
  {
    course_id: 'course-b',
    exam_date: null,
    courses: { id: 'course-b', code: 'BIO 201', title: 'Genetics' },
  },
  {
    course_id: 'course-a',
    exam_date: '2999-01-10',
    courses: { id: 'course-a', code: 'PHARM 212', title: 'Pharmaceutical Technology' },
  },
];

describe('TopicMasteryService.courseReadiness', () => {
  it('includes courses without an exam date and sorts soonest exam first', async () => {
    const service = fakeService({
      user_courses: { data: COURSES },
      course_topics: {
        data: [
          { id: 't1', course_id: 'course-a', title: 'Tablets', position: 10 },
          { id: 't2', course_id: 'course-a', title: 'Capsules', position: 20 },
        ],
      },
      user_topic_mastery: {
        data: [
          {
            topic: 'tablets',
            course_id: 'course-a',
            mastery_score: 80,
            attempts: 5,
            cards_total: 4,
            cards_due: 1,
          },
        ],
      },
    });

    const result = await service.courseReadiness('user-1');
    expect(result.map((c) => c.courseId)).toEqual(['course-a', 'course-b']);

    const [pharm, bio] = result;
    expect(pharm).toMatchObject({
      courseCode: 'PHARM 212',
      courseTitle: 'Pharmaceutical Technology',
      outlineTotal: 2,
      coveredCount: 1,
      coveragePct: 50,
      averageMastery: 80,
    });
    expect(pharm.daysUntil).toBeGreaterThan(0);
    expect(pharm.nextTopic).toEqual({ topicId: 't2', title: 'Capsules' });

    // Day-one course: enrolled, no exam date, no outline, no evidence — still
    // present, with every number honestly null/zero.
    expect(bio).toMatchObject({
      courseCode: 'BIO 201',
      examDate: null,
      daysUntil: null,
      outlineTotal: 0,
      coveragePct: null,
      readinessScore: null,
      nextTopic: null,
    });
  });

  it('returns [] for a user with no active courses', async () => {
    const service = fakeService({ user_courses: { data: [] } });
    await expect(service.courseReadiness('user-1')).resolves.toEqual([]);
  });
});
