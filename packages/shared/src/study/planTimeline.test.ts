import { WORKSPACE_ACTIVITIES } from '../learning/courseWorkspace';
import type { StudySetTopic, StudySetUnit } from '../learning/studySetPlan';
import { workspaceActivityFromPath } from '../learning/studySetRoutes';
import {
  initialOpenUnitId,
  isPlanTopicDone,
  planRing,
  planTimeline,
  planTopicActivity,
  planTopicActivityLabel,
  planTopicState,
  guidedNextTopicFromPlan,
} from './planTimeline';

function unit(id: string, position: number, title = id): StudySetUnit {
  return { id, studySetId: 'set-1', title, position };
}

function topic(
  id: string,
  unitId: string,
  position: number,
  status: StudySetTopic['status'] = 'unseen',
  sourceNoteIds: string[] = ['n1']
): StudySetTopic {
  return { id, studySetId: 'set-1', unitId, title: `Topic ${id}`, position, status, sourceNoteIds };
}

describe('planRing', () => {
  it('is zero for an empty unit rather than NaN', () => {
    expect(planRing([])).toEqual({ total: 0, covered: 0, mastered: 0, percent: 0 });
  });

  it('counts mastered topics as covered too', () => {
    const ring = planRing([
      topic('1', 'u1', 10, 'mastered'),
      topic('2', 'u1', 20, 'covered'),
      topic('3', 'u1', 30),
    ]);
    expect(ring.total).toBe(3);
    expect(ring.covered).toBe(2);
    expect(ring.mastered).toBe(1);
  });

  it('weights mastery double, so reading everything once is half an arc', () => {
    const read = [topic('1', 'u1', 10, 'covered'), topic('2', 'u1', 20, 'covered')];
    expect(planRing(read).percent).toBe(50);
    const proved = read.map((row) => ({ ...row, status: 'mastered' as const }));
    expect(planRing(proved).percent).toBe(100);
  });
});

describe('planTopicState', () => {
  it('strikes through only what was proved, never what was merely read', () => {
    expect(isPlanTopicDone(topic('1', 'u1', 10, 'mastered'))).toBe(true);
    expect(isPlanTopicDone(topic('2', 'u1', 20, 'covered'))).toBe(false);
    expect(planTopicState(topic('2', 'u1', 20, 'covered'), null)).toBe('covered');
    expect(planTopicState(topic('3', 'u1', 30), null)).toBe('todo');
  });

  it('gives the recommendation the pill, even when it is half done', () => {
    expect(planTopicState(topic('2', 'u1', 20, 'covered'), '2')).toBe('next');
  });

  it('never puts the pill on a finished topic', () => {
    expect(planTopicState(topic('1', 'u1', 10, 'mastered'), '1')).toBe('done');
  });
});

describe('planTopicActivity', () => {
  it('reads what is unseen, quizzes what is covered, drills what is mastered', () => {
    expect(planTopicActivity(topic('1', 'u1', 10))).toBe('notes');
    expect(planTopicActivity(topic('2', 'u1', 20, 'covered'))).toBe('quiz');
    expect(planTopicActivity(topic('3', 'u1', 30, 'mastered'))).toBe('cards');
  });

  it('sends a topic with no material to the tutor instead of an empty reader', () => {
    expect(planTopicActivity(topic('4', 'u1', 40, 'unseen', []))).toBe('lesson');
    expect(planTopicActivityLabel(topic('4', 'u1', 40, 'unseen', []))).toBe('Tutor');
    expect(planTopicActivityLabel(topic('1', 'u1', 10))).toBe('Read');
  });

  // The regression: a plain note used to answer `read`, a URL the room maps
  // onto the Walkthrough chip, so Continue lit Walkthrough over "Select a note
  // with a PDF or slides attached." Every answer must now be a chip that the
  // room can actually fill for THIS topic's source.
  it('reads a plain note in the studio and a PDF note in the walkthrough', () => {
    const unseen = topic('1', 'u1', 10);
    expect(planTopicActivity(unseen)).toBe('notes');
    expect(planTopicActivity(unseen, { hasWalkableSource: false })).toBe('notes');
    expect(planTopicActivity(unseen, { hasWalkableSource: true })).toBe('walkthrough');
    // One promise either way — the pill does not flicker when a PDF arrives.
    expect(planTopicActivityLabel(unseen, { hasWalkableSource: true })).toBe('Read');
    expect(planTopicActivityLabel(unseen, { hasWalkableSource: false })).toBe('Read');
  });

  it('never answers with a route the room maps onto another chip', () => {
    const cases = [
      planTopicActivity(topic('1', 'u1', 10)),
      planTopicActivity(topic('1', 'u1', 10), { hasWalkableSource: true }),
      planTopicActivity(topic('2', 'u1', 20, 'covered')),
      planTopicActivity(topic('3', 'u1', 30, 'mastered')),
      planTopicActivity(topic('4', 'u1', 40, 'unseen', [])),
    ];
    expect(cases).not.toContain('read');
    // Each is an id in WORKSPACE_ACTIVITIES, so a chip exists to light.
    const chips = new Set(WORKSPACE_ACTIVITIES.map((row) => row.id));
    for (const kind of cases) expect(chips.has(kind)).toBe(true);
    // …and each is its OWN route, not one the router redirects elsewhere.
    for (const kind of cases) expect(workspaceActivityFromPath(kind)).toBe(kind);
  });
});

describe('planTimeline', () => {
  const units = [unit('u2', 20, 'Methods'), unit('u1', 10, 'Foundations'), unit('u3', 30, 'Empty')];
  const topics = [
    topic('t2', 'u1', 20, 'covered'),
    topic('t1', 'u1', 10, 'mastered'),
    topic('t3', 'u2', 10),
  ];

  it('orders units by position and topics by position inside them', () => {
    const rows = planTimeline(units, topics, null);
    expect(rows.map((entry) => entry.unit.id)).toEqual(['u1', 'u2', 'u3']);
    expect(rows[0].rows.map((row) => row.topic.id)).toEqual(['t1', 't2']);
  });

  it('keeps a unit with no topics rather than renumbering the ones after it', () => {
    const rows = planTimeline(units, topics, null);
    expect(rows[2].rows).toEqual([]);
    expect(rows[2].ring.percent).toBe(0);
  });

  it('marks exactly one row as next', () => {
    const rows = planTimeline(units, topics, 't3');
    const next = rows.flatMap((entry) => entry.rows).filter((row) => row.state === 'next');
    expect(next).toHaveLength(1);
    expect(next[0].topic.id).toBe('t3');
  });

  it('opens the unit holding the recommendation, and the first unit otherwise', () => {
    expect(initialOpenUnitId(planTimeline(units, topics, 't3'))).toBe('u2');
    expect(initialOpenUnitId(planTimeline(units, topics, null))).toBe('u1');
    expect(initialOpenUnitId([])).toBeNull();
  });
});

/**
 * The shape the Guided picker's `Continue learning:` row is built from.
 *
 * The failure this pins is the dishonest one: a finished plan whose recommender
 * hands back a mastered topic (both spines fall back to a row rather than to
 * none) must NOT become a row telling a student to continue something they
 * already proved.
 */
describe('guidedNextTopicFromPlan', () => {
  it('carries the topic and the unit it is filed under', () => {
    expect(
      guidedNextTopicFromPlan({ title: '  Narrow vs. General AI ', status: 'unseen' }, ' Unit 1 ')
    ).toEqual({ title: 'Narrow vs. General AI', unit: 'Unit 1' });
  });

  it('is null when there is nothing to continue', () => {
    expect(guidedNextTopicFromPlan(null, 'Unit 1')).toBeNull();
    expect(guidedNextTopicFromPlan(undefined)).toBeNull();
    expect(guidedNextTopicFromPlan({ title: '   ', status: 'covered' }, 'Unit 1')).toBeNull();
  });

  it('refuses a mastered pick — a finished plan has no next step', () => {
    expect(guidedNextTopicFromPlan({ title: 'Osmosis', status: 'mastered' }, 'Unit 1')).toBeNull();
  });

  it('keeps the unit null rather than blank when the caller has no unit', () => {
    expect(guidedNextTopicFromPlan({ title: 'Osmosis', status: 'covered' })).toEqual({
      title: 'Osmosis',
      unit: null,
    });
  });
});
