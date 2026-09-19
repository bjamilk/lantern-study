/**
 * The phone's Study Plan, read against the class syllabus.
 *
 * The rule under every case here is the one #142 refused to break and this lane
 * keeps: a syllabus week may NAME and ORDER a unit, and may never become one.
 * So the load-bearing assertions are the negative ones — the unmatched week
 * that stays out of `units`, and the no-syllabus model that is identical to the
 * one this module built before the argument existed.
 *
 * The matching rules themselves are pure and tested in `@lantern/shared`'s
 * `planSyllabus`; what this pins is that the phone's model runs them over the
 * units it is actually about to draw, which is NOT always the server's set.
 */
import { buildStudyPlanModel } from './studyPlanPresentation';
import type { StudySetTopic, StudySetTopicStatus, StudySetUnit } from '@lantern/shared/learning';
import type { StudySetPlanSyllabus } from '@lantern/shared/study/planSyllabus';
import { buildPlanSyllabusView } from '@lantern/shared/study/planSyllabus';

function topic(
  id: string,
  unitId: string,
  position: number,
  status: StudySetTopicStatus = 'unseen'
): StudySetTopic {
  return { id, studySetId: 'set-a', unitId, title: `Topic ${id}`, position, status, sourceNoteIds: [] };
}

function unit(id: string, title: string, position: number): StudySetUnit {
  return { id, studySetId: 'set-a', title, position };
}

const UNITS = [unit('u-cell', 'Cell biology', 10), unit('u-gen', 'Genetics', 20)];
const TOPICS = [topic('a', 'u-cell', 10), topic('b', 'u-gen', 10)];

const SUMMARY = {
  weeks: [
    { week: 1, title: 'Genetics', date: '2026-09-07', examLabel: null },
    { week: 2, title: 'Cell biology', date: '2026-09-14', examLabel: null },
    { week: 3, title: 'Photosynthesis', date: '2026-09-21', examLabel: null },
    { week: 4, title: 'Midterm', date: '2026-10-10', examLabel: 'Exam 1' },
  ],
  examDates: ['2026-10-10'],
  extractedAt: '2026-09-18T00:00:00.000Z',
};

/** What `GET …/plan` answers for these very units. */
const PAYLOAD: StudySetPlanSyllabus = {
  ...buildPlanSyllabusView(SUMMARY, UNITS)!,
  summary: SUMMARY,
};

const model = (syllabus: StudySetPlanSyllabus | null) =>
  buildStudyPlanModel({ units: UNITS, topics: TOPICS, materials: [], syllabus });

describe('buildStudyPlanModel with a syllabus', () => {
  it('runs the units in syllabus order and labels each with its week', () => {
    const built = model(PAYLOAD);
    expect(built.units.map((row) => row.title)).toEqual(['Genetics', 'Cell biology']);
    expect(built.units.map((row) => row.weekLabel)).toEqual([
      'Week 1 · 7 Sep',
      'Week 2 · 14 Sep',
    ]);
    // The `01`/`02` head follows the new order rather than the old one.
    expect(built.units[0]!.label).toBe('01 Genetics');
  });

  it('puts the exam on the spine as a marker, never as a unit', () => {
    const built = model(PAYLOAD);
    expect(built.rows).toEqual([
      { kind: 'unit', unitId: 'u-gen' },
      { kind: 'unit', unitId: 'u-cell' },
      { kind: 'exam', divider: expect.objectContaining({ label: 'Exam 1 · 10 Oct' }) },
    ]);
    expect(built.units).toHaveLength(2);
  });

  it('lists the week nothing matched under comingUp, with no topics behind it', () => {
    const built = model(PAYLOAD);
    expect(built.comingUp.map((row) => [row.week, row.title])).toEqual([
      [3, 'Photosynthesis'],
      [4, 'Midterm'],
    ]);
    // Every topic in the model still belongs to a real unit built from material.
    expect(built.units.flatMap((row) => row.topics)).toHaveLength(2);
    expect(built.progress.topics).toBe(2);
  });

  it('recomputes against locally derived units the server has never seen', () => {
    // A plan that was never saved is regrouped from its materials, so its unit
    // ids are `${setId}-material-${noteId}` and the payload names none of them.
    const local = buildStudyPlanModel({
      units: [],
      topics: [
        { ...topic('a', 'u-x', 10), sourceNoteIds: ['n-cell'] },
        { ...topic('b', 'u-x', 20), sourceNoteIds: ['n-gen'] },
      ],
      materials: [
        { id: 'n-cell', title: 'Cell biology' },
        { id: 'n-gen', title: 'Genetics' },
      ],
      syllabus: PAYLOAD,
    });
    expect(local.units.map((row) => row.title)).toEqual(['Genetics', 'Cell biology']);
    expect(local.units[0]!.weekLabel).toBe('Week 1 · 7 Sep');
  });
});

describe('buildStudyPlanModel without a syllabus', () => {
  it('is exactly the model it was before, with no rows or weeks invented', () => {
    const plain = buildStudyPlanModel({ units: UNITS, topics: TOPICS, materials: [] });
    expect(model(null)).toEqual(plain);
    expect(plain.units.map((row) => row.title)).toEqual(['Cell biology', 'Genetics']);
    expect(plain.units.every((row) => row.weekLabel === null)).toBe(true);
    expect(plain.comingUp).toEqual([]);
    expect(plain.rows).toEqual([
      { kind: 'unit', unitId: 'u-cell' },
      { kind: 'unit', unitId: 'u-gen' },
    ]);
  });

  it('lists every week as coming up for a set with a syllabus and no materials', () => {
    const built = buildStudyPlanModel({
      units: [],
      topics: [],
      materials: [],
      syllabus: PAYLOAD,
    });
    expect(built.empty).toBe(true);
    expect(built.units).toEqual([]);
    expect(built.comingUp).toHaveLength(4);
  });
});
