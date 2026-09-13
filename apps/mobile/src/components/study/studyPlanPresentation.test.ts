import {
  buildStudyPlanModel,
  defaultOpenUnitId,
  formatPlanExamDate,
  nextTopicStatus,
  planExamRows,
  planUnitsAndTopics,
  topicRingFraction,
} from './studyPlanPresentation';
import type { StudySetTopic, StudySetTopicStatus, StudySetUnit } from '@lantern/shared/learning';

function topic(
  id: string,
  unitId: string,
  position: number,
  status: StudySetTopicStatus,
  sourceNoteIds: string[] = []
): StudySetTopic {
  return { id, studySetId: 'set-a', unitId, title: `Topic ${id}`, position, status, sourceNoteIds };
}

function unit(id: string, title: string, position: number): StudySetUnit {
  return { id, studySetId: 'set-a', title, position };
}

describe('topicRingFraction', () => {
  it('scores a topic out of two ticks, not one', () => {
    expect(topicRingFraction('unseen')).toBe(0);
    expect(topicRingFraction('covered')).toBe(0.5);
    expect(topicRingFraction('mastered')).toBe(1);
  });
});

describe('nextTopicStatus', () => {
  it('cycles unseen, covered, mastered and back', () => {
    expect(nextTopicStatus('unseen')).toBe('covered');
    expect(nextTopicStatus('covered')).toBe('mastered');
    expect(nextTopicStatus('mastered')).toBe('unseen');
  });
});

describe('planUnitsAndTopics', () => {
  const topics = [
    topic('1', 'u1', 10, 'unseen', ['n1']),
    topic('2', 'u1', 20, 'unseen', ['n1']),
    topic('3', 'u1', 30, 'unseen', ['n2']),
  ];

  it('derives a unit per material when the stored plan is flat', () => {
    const out = planUnitsAndTopics({
      units: [unit('u1', 'Your materials', 10)],
      topics,
      materials: [
        { id: 'n1', title: 'AI Foundations' },
        { id: 'n2', title: 'Methods' },
      ],
    });
    expect(out.units.map((row) => row.title)).toEqual(['AI Foundations', 'Methods']);
    expect(out.topics.map((row) => row.unitId)).toEqual([
      'set-a-material-n1',
      'set-a-material-n1',
      'set-a-material-n2',
    ]);
  });

  it('keeps a real stored structure and never re-derives over it', () => {
    const stored = [unit('u1', 'Week 1', 10), unit('u2', 'Week 2', 20)];
    const out = planUnitsAndTopics({
      units: stored,
      topics: [topic('1', 'u1', 10, 'unseen', ['n1']), topic('2', 'u2', 20, 'unseen', ['n2'])],
      materials: [
        { id: 'n1', title: 'AI Foundations' },
        { id: 'n2', title: 'Methods' },
      ],
    });
    expect(out.units.map((row) => row.title)).toEqual(['Week 1', 'Week 2']);
  });

  it('leaves a flat plan flat when the materials cannot split it', () => {
    const out = planUnitsAndTopics({
      units: [unit('u1', 'Your materials', 10)],
      topics,
      materials: [{ id: 'n1', title: 'AI Foundations' }, { id: 'n2', title: '   ' }],
    });
    expect(out.units).toHaveLength(1);
    expect(out.topics.map((row) => row.unitId)).toEqual(['u1', 'u1', 'u1']);
  });
});

describe('buildStudyPlanModel', () => {
  const units = [unit('u1', 'Week 1', 10), unit('u2', 'Week 2', 20)];
  const topics = [
    topic('1', 'u1', 10, 'mastered'),
    topic('2', 'u1', 20, 'covered'),
    topic('3', 'u2', 30, 'unseen'),
    topic('4', 'u2', 40, 'unseen'),
  ];

  it('numbers the unit heads and fills each ring by halves', () => {
    const model = buildStudyPlanModel({ units, topics, materials: [] });
    expect(model.units.map((row) => row.label)).toEqual(['01 Week 1', '02 Week 2']);
    // Week 1: one mastered (1) + one covered (0.5) over two topics.
    expect(model.units[0].ring).toBe(0.75);
    expect(model.units[1].ring).toBe(0);
    expect(model.units[0].progressLabel).toBe('2 of 2 covered');
  });

  it('strikes through covered and mastered topics only', () => {
    const model = buildStudyPlanModel({ units, topics, materials: [] });
    expect(model.units[0].topics.map((row) => row.done)).toEqual([true, true]);
    expect(model.units[1].topics.map((row) => row.done)).toEqual([false, false]);
  });

  it('puts Continue on the first topic that is not yet mastered', () => {
    const model = buildStudyPlanModel({ units, topics, materials: [] });
    expect(model.nextTopicId).toBe('2');
    expect(model.nextTopic?.title).toBe('Topic 2');
    expect(model.units.map((row) => row.holdsNext)).toEqual([true, false]);
  });

  it('does not let a cram mode move the Continue pill off a half-done topic', () => {
    const cram = buildStudyPlanModel({ units, topics, materials: [], mode: 'cram' });
    const standard = buildStudyPlanModel({ units, topics, materials: [] });
    expect(cram.nextTopicId).toBe(standard.nextTopicId);
    expect(cram.modeLabel).toBe('Cram');
  });

  it('agrees with the header bar on how full the plan is', () => {
    const model = buildStudyPlanModel({ units, topics, materials: [] });
    // 3 of 8 possible ticks.
    expect(model.percent).toBe(38);
    expect(model.detailLabel).toBe('4 Topics · 2 Covered · 1 Mastered');
  });

  it('reports a plan with no topics as empty and offers no next topic', () => {
    const model = buildStudyPlanModel({ units: [], topics: [], materials: [] });
    expect(model.empty).toBe(true);
    expect(model.nextTopicId).toBeNull();
    expect(model.nextTopic).toBeNull();
    expect(model.percent).toBe(0);
  });
});

describe('defaultOpenUnitId', () => {
  it('opens the unit holding the next topic, not always the first', () => {
    const model = buildStudyPlanModel({
      units: [unit('u1', 'Week 1', 10), unit('u2', 'Week 2', 20)],
      topics: [topic('1', 'u1', 10, 'mastered'), topic('2', 'u2', 20, 'unseen')],
      materials: [],
    });
    expect(defaultOpenUnitId(model)).toBe('u2');
  });

  it('falls back to the first unit when everything is mastered', () => {
    const model = buildStudyPlanModel({
      units: [unit('u1', 'Week 1', 10)],
      topics: [topic('1', 'u1', 10, 'mastered')],
      materials: [],
    });
    expect(defaultOpenUnitId(model)).toBe('u1');
  });

  it('has nothing to open on an empty plan', () => {
    expect(defaultOpenUnitId(buildStudyPlanModel({ units: [], topics: [], materials: [] }))).toBeNull();
  });
});

describe('planExamRows', () => {
  it('formats a date-only exam without crossing a timezone', () => {
    expect(formatPlanExamDate('2026-09-20')).toBe('20 Sep 2026');
    expect(formatPlanExamDate('2026-01-05')).toBe('5 Jan 2026');
  });

  it('marks a passed exam and leaves a future one alone', () => {
    expect(planExamRows('2026-09-20', '2026-09-13')).toEqual([
      { date: '2026-09-20', label: '20 Sep 2026', past: false },
    ]);
    expect(planExamRows('2026-09-01', '2026-09-13')[0].past).toBe(true);
  });

  it('draws nothing for a missing or malformed date', () => {
    expect(planExamRows(null, '2026-09-13')).toEqual([]);
    expect(planExamRows('  ', '2026-09-13')).toEqual([]);
    expect(planExamRows('next friday', '2026-09-13')).toEqual([]);
  });
});
