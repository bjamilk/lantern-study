/**
 * The next-best-action planner. The rules under test are the ones a student
 * would notice being broken: never more than one action, never an action that
 * points at an artefact they do not own, and never a missing exam date used as
 * a gate in front of work they could do right now.
 */
import { computeCourseReadiness, planNextBestAction } from './index';

const readiness = (over: Parameters<typeof computeCourseReadiness>[0]) =>
  computeCourseReadiness({ courseCode: 'BCH 201', ...over });

const OUTLINE = [
  { id: 't1', title: 'Glycolysis', position: 10 },
  { id: 't2', title: 'Krebs cycle', position: 20 },
];

const signal = (topic: string, masteryScore: number | null, attempts = 5) => ({
  topic,
  masteryScore,
  attempts,
  cardsTotal: 10,
  cardsDue: 2,
});

describe('planNextBestAction', () => {
  it('asks for topics first when the course has no outline', () => {
    const action = readiness({ courseId: 'course-1', outline: [], mastery: [] }).nextAction;
    expect(action.kind).toBe('add-topics');
    expect(action.targetId).toBe('course-1');
  });

  it('treats a missing exam date as a suggestion, never as the action', () => {
    const action = readiness({
      courseId: 'course-1',
      examDate: null,
      outline: OUTLINE,
      mastery: [signal('Glycolysis', 40)],
    }).nextAction;
    expect(action.kind).not.toBe('set-exam-date');
    expect(action.suggestion).toEqual(
      expect.objectContaining({ kind: 'set-exam-date', targetId: 'course-1' })
    );
  });

  it('drops the suggestion once an exam date is set', () => {
    const action = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Glycolysis', 40)],
    }).nextAction;
    expect(action.suggestion).toBeNull();
  });

  it('points at the weakest scored topic that has a deck behind it', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Glycolysis', 70), signal('Krebs cycle', 30)],
    });
    const action = planNextBestAction(base, {
      decksByTopicId: {
        t1: { id: 'deck-1', title: 'Glycolysis cards' },
        t2: { id: 'deck-2', title: 'Krebs cards' },
      },
    });
    expect(action.kind).toBe('review-deck');
    expect(action.targetId).toBe('deck-2');
    expect(action.topicId).toBe('t2');
    expect(action.label).toBe('Review Krebs cards');
  });

  it('prefers an untested topic over a scored weak one — thinnest evidence first', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Glycolysis', 5)],
    });
    const action = planNextBestAction(base, {
      decksByTopicId: {
        t1: { id: 'deck-1', title: 'Glycolysis cards' },
        t2: { id: 'deck-2', title: 'Krebs cards' },
      },
    });
    expect(action.targetId).toBe('deck-2');
    expect(action.reason).toContain('not been tested');
  });

  it('falls back to a note when the weakest topic has no deck', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Glycolysis', 70), signal('Krebs cycle', 30)],
    });
    const action = planNextBestAction(base, {
      notesByTopicId: { t2: { id: 'note-9', title: 'Krebs summary' } },
    });
    expect(action.kind).toBe('study-topic-note');
    expect(action.targetId).toBe('note-9');
  });

  it('prefers a deck over a note on the same topic', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Krebs cycle', 30)],
    });
    const action = planNextBestAction(base, {
      decksByTopicId: { t2: { id: 'deck-2', title: 'Krebs cards' } },
      notesByTopicId: { t2: { id: 'note-9', title: 'Krebs summary' } },
    });
    expect(action.kind).toBe('review-deck');
    expect(action.targetId).toBe('deck-2');
  });

  it('never points at a deck filed under a topic outside this outline', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Ad-hoc tag', 10)],
    });
    const action = planNextBestAction(base, {
      decksByTopicId: { 'other-course-topic': { id: 'deck-x', title: 'Somewhere else' } },
    });
    expect(action.kind).toBe('take-test');
    expect(action.targetId).toBe('course-1');
  });

  it('asks for a test when the outline exists but nothing is filed under it', () => {
    const action = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [],
    }).nextAction;
    expect(action.kind).toBe('take-test');
    expect(action.label).toBe('Take a test on BCH 201');
  });

  it('names the course honestly when it has no code', () => {
    const action = computeCourseReadiness({
      courseId: 'course-1',
      courseCode: null,
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [],
    }).nextAction;
    expect(action.label).toBe('Take a test on this course');
  });

  it('uses the topic title when a deck has no usable name', () => {
    const base = readiness({
      courseId: 'course-1',
      examDate: '2999-01-01',
      outline: OUTLINE,
      mastery: [signal('Krebs cycle', 30)],
    });
    const action = planNextBestAction(base, {
      decksByTopicId: { t2: { id: 'deck-2', title: '  ' } },
    });
    expect(action.label).toBe('Review Krebs cycle');
  });
});
