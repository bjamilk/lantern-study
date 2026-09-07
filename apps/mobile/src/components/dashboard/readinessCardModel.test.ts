import type { NextBestAction } from '@lantern/shared/network';
import {
  buildReadinessRow,
  buildReadinessRows,
  navTargetForAction,
  planExamDatePrompt,
  planNextAction,
  planUnmatchedTags,
  readinessStatusLine,
  unmatchedTagSubtitle,
  type ReadinessCourseInput,
} from './readinessCardModel';

const action = (over: Partial<NextBestAction> = {}): NextBestAction => ({
  kind: 'take-test',
  targetId: 'c1',
  label: 'Take a test on PHARM 212',
  reason: 'A short test is the quickest way to find out where you stand.',
  topicId: null,
  topicTitle: null,
  suggestion: null,
  ...over,
});

const course = (over: Partial<ReadinessCourseInput> = {}): ReadinessCourseInput => ({
  courseId: 'c1',
  courseCode: 'PHARM 212',
  examDate: '2026-10-01',
  daysUntil: 16,
  outlineTotal: 12,
  coveredCount: 4,
  coveragePct: 33,
  averageMastery: 52,
  readinessScore: 44,
  nextTopic: { topicId: 't1', title: 'Enzymes' },
  weakestTopics: ['Glycolysis', 'Enzymes', 'Kinetics', 'Extra'],
  nextAction: action(),
  ...over,
});

describe('readinessStatusLine', () => {
  it('leads with the score when there is one', () => {
    expect(readinessStatusLine(course())).toBe('Readiness 44%');
  });

  it('falls back to syllabus coverage rather than fabricating a score', () => {
    expect(readinessStatusLine(course({ readinessScore: null, averageMastery: null }))).toBe(
      '4 of 12 topics started'
    );
  });

  it('says "not enough evidence yet" instead of 0% when nothing is known', () => {
    const line = readinessStatusLine(
      course({ readinessScore: null, coveragePct: null, averageMastery: null })
    );
    expect(line).toBe('Not enough evidence yet');
    expect(line).not.toContain('0%');
  });
});

describe('navTargetForAction', () => {
  const ids = { courseId: 'c1', courseCode: 'PHARM 212' };

  it('sends a deck action to the deck and a note action to the note', () => {
    expect(navTargetForAction(action({ kind: 'review-deck', targetId: 'd1' }), ids)).toEqual({
      kind: 'deck',
      deckId: 'd1',
    });
    expect(navTargetForAction(action({ kind: 'study-topic-note', targetId: 'n1' }), ids)).toEqual({
      kind: 'note',
      noteId: 'n1',
    });
  });

  it('refuses an artefact action with no id rather than navigating at nothing', () => {
    expect(navTargetForAction(action({ kind: 'review-deck', targetId: undefined }), ids)).toBeNull();
    expect(navTargetForAction(action({ kind: 'study-topic-note', targetId: '  ' }), ids)).toBeNull();
  });

  it('maps the three course-level kinds onto their screens', () => {
    expect(navTargetForAction(action({ kind: 'take-test' }), ids)).toEqual({
      kind: 'test',
      courseId: 'c1',
    });
    expect(navTargetForAction(action({ kind: 'add-topics' }), ids)).toEqual({
      kind: 'topics',
      courseId: 'c1',
      courseLabel: 'PHARM 212',
    });
    expect(navTargetForAction(action({ kind: 'set-exam-date' }), ids)).toEqual({
      kind: 'examDate',
      courseId: 'c1',
    });
  });

  it('falls back to the course id when a course-level action names no target', () => {
    expect(navTargetForAction(action({ kind: 'take-test', targetId: undefined }), ids)).toEqual({
      kind: 'test',
      courseId: 'c1',
    });
  });
});

describe('planNextAction', () => {
  it('renders the shared planner’s label and reason verbatim', () => {
    const plan = planNextAction(
      course({
        nextAction: action({
          kind: 'review-deck',
          targetId: 'd1',
          label: 'Review Glycolysis',
          reason: 'Glycolysis is your weakest topic so far (31%).',
        }),
      })
    );
    expect(plan.label).toBe('Review Glycolysis');
    expect(plan.reason).toBe('Glycolysis is your weakest topic so far (31%).');
    expect(plan.accessibilityLabel).toBe(
      'Review Glycolysis. Glycolysis is your weakest topic so far (31%).'
    );
    expect(plan.target).toEqual({ kind: 'deck', deckId: 'd1' });
  });

  it('degrades when the server names a deck it cannot point at', () => {
    const plan = planNextAction(
      course({ nextAction: action({ kind: 'review-deck', targetId: undefined, label: 'Review X' }) })
    );
    expect(plan.label).toBe('Take a test on PHARM 212');
    expect(plan.target).toEqual({ kind: 'test', courseId: 'c1' });
  });

  it('degrades on a payload that predates nextAction', () => {
    const { nextAction, ...legacy } = course();
    expect(nextAction).toBeDefined();
    expect(planNextAction(legacy).label).toBe('Take a test on PHARM 212');
  });

  it('asks for topics first when an older payload has no outline', () => {
    const { nextAction, ...legacy } = course({ outlineTotal: 0, coveragePct: null });
    const plan = planNextAction(legacy);
    expect(plan.label).toBe('Add your course topics');
    expect(plan.target).toEqual({ kind: 'topics', courseId: 'c1', courseLabel: 'PHARM 212' });
  });

  it('never prints an empty course code', () => {
    const { nextAction, ...legacy } = course({ courseCode: '   ' });
    expect(planNextAction(legacy).label).toBe('Take a test on this course');
  });

  it('is one action, not a menu', () => {
    expect(Object.keys(planNextAction(course())).sort()).toEqual([
      'accessibilityLabel',
      'label',
      'reason',
      'target',
    ]);
  });
});

describe('planExamDatePrompt', () => {
  it('is silent once an exam date is set', () => {
    expect(planExamDatePrompt(course())).toBeNull();
  });

  it('carries the shared planner’s suggestion when there is no date', () => {
    const prompt = planExamDatePrompt(
      course({
        examDate: null,
        daysUntil: null,
        nextAction: action({
          suggestion: {
            kind: 'set-exam-date',
            targetId: 'c1',
            label: 'Add your exam date',
            reason: 'Set it and we will remind you a week before, the day before, and on the morning.',
          },
        }),
      })
    );
    expect(prompt).toEqual({
      label: 'Add your exam date',
      reason: 'Set it and we will remind you a week before, the day before, and on the morning.',
      target: { kind: 'examDate', courseId: 'c1' },
    });
  });

  it('still prompts when the payload carries no suggestion at all', () => {
    const { nextAction, ...legacy } = course({ examDate: null, daysUntil: null });
    expect(planExamDatePrompt(legacy)?.label).toBe('Add your exam date');
  });
});

describe('buildReadinessRow', () => {
  it('builds the days-left line, chips and bar from one course', () => {
    const row = buildReadinessRow(course());
    expect(row.daysLeftLabel).toBe('16 days to your exam');
    expect(row.examDatePrompt).toBeNull();
    expect(row.weakestChips).toEqual(['Glycolysis', 'Enzymes', 'Kinetics']);
    expect(row.barPct).toBe(44);
    expect(row.band).toBe('weak');
    expect(row.courseLabel).toBe('PHARM 212');
  });

  it('swaps the countdown for the prompt when no exam date is set', () => {
    const row = buildReadinessRow(course({ daysUntil: null, examDate: null }));
    expect(row.daysLeftLabel).toBeNull();
    expect(row.examDatePrompt?.target).toEqual({ kind: 'examDate', courseId: 'c1' });
  });

  it('speaks the exam-day case rather than counting down past it', () => {
    expect(buildReadinessRow(course({ daysUntil: 0 })).daysLeftLabel).toBe('Exam today');
  });

  it('draws the coverage bar when there is no score, and none at all with no data', () => {
    expect(buildReadinessRow(course({ readinessScore: null })).barPct).toBe(33);
    expect(buildReadinessRow(course({ readinessScore: null, coveragePct: null })).barPct).toBeNull();
  });

  it('leaves the chips empty rather than inventing weak topics', () => {
    expect(buildReadinessRow(course({ weakestTopics: [] })).weakestChips).toEqual([]);
  });

  it('limits the rows it hands the card', () => {
    const rows = buildReadinessRows(
      [course({ courseId: 'a' }), course({ courseId: 'b' }), course({ courseId: 'c' })],
      2
    );
    expect(rows.map((r) => r.courseId)).toEqual(['a', 'b']);
  });
});

describe('planUnmatchedTags', () => {
  const tag = (t: string, count = 1, sources: string[] = ['decks']) => ({
    tag: t,
    count,
    sources,
  });

  it('stays hidden until the server answers', () => {
    expect(planUnmatchedTags(null)).toEqual({ visible: false, tags: [] });
    expect(planUnmatchedTags(undefined).visible).toBe(false);
  });

  it('stays hidden on an empty answer rather than promising a list', () => {
    expect(planUnmatchedTags([]).visible).toBe(false);
    expect(planUnmatchedTags([tag('  '), tag('')]).visible).toBe(false);
  });

  it('trims and de-duplicates case-insensitively, keeping first spelling', () => {
    const plan = planUnmatchedTags([tag(' Glycolysis ', 9), tag('glycolysis', 1), tag('Enzymes', 4)]);
    expect(plan.visible).toBe(true);
    expect(plan.tags.map((t) => t.tag)).toEqual(['Glycolysis', 'Enzymes']);
  });

  it('puts the heaviest tag first — that is the topic worth adding', () => {
    const plan = planUnmatchedTags([tag('Kinetics', 1), tag('Glycolysis', 9), tag('Enzymes', 4)]);
    expect(plan.tags.map((t) => t.tag)).toEqual(['Glycolysis', 'Enzymes', 'Kinetics']);
  });

  it('accepts a bare string list, for a server that sends only names', () => {
    expect(planUnmatchedTags(['Glycolysis']).tags[0]).toEqual({
      tag: 'Glycolysis',
      count: 0,
      sources: [],
    });
  });
});

describe('unmatchedTagSubtitle', () => {
  it('says how much work carries the tag and where', () => {
    expect(unmatchedTagSubtitle({ tag: 'Glycolysis', count: 3, sources: ['decks', 'notes'] })).toBe(
      '3 on decks, notes'
    );
  });

  it('claims no count it was not given', () => {
    expect(unmatchedTagSubtitle({ tag: 'Glycolysis', count: 0, sources: [] })).toBe('On your work');
  });
});
