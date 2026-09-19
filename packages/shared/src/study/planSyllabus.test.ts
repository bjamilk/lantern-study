import {
  PLAN_SYLLABUS_DATE_ASSIST_DAYS,
  PLAN_SYLLABUS_TITLE_ASSIST,
  PLAN_SYLLABUS_TITLE_MATCH,
  buildPlanSyllabusView,
  formatPlanSyllabusDate,
  matchSyllabusWeeks,
  orderUnitIdsBySyllabus,
  planSyllabusMatchesByUnit,
  planSyllabusRows,
  planSyllabusUnitEyebrow,
  planSyllabusUnitTitle,
  planSyllabusViewFor,
  planTitleSimilarity,
  planTitleTokens,
  type PlanSyllabusUnitInput,
} from './planSyllabus';
import type { SyllabusSummary, SyllabusWeek } from './syllabusSummary';

function week(
  n: number,
  title: string,
  extra: Partial<SyllabusWeek> = {}
): SyllabusWeek {
  return { week: n, title, date: null, examLabel: null, ...extra };
}

function unit(id: string, title: string, position: number, date?: string): PlanSyllabusUnitInput {
  return { id, title, position, date: date ?? null };
}

function summaryOf(weeks: SyllabusWeek[], examDates: string[] = []): SyllabusSummary {
  return { weeks, examDates, extractedAt: '2026-09-18T00:00:00.000Z' };
}

describe('planTitleTokens', () => {
  it('drops stopwords, scaffolding words, bare numbers and roman numerals', () => {
    expect(planTitleTokens('Week 4 — Lecture II: The Enzymes of Glycolysis').sort()).toEqual([
      'enzyme',
      'glycolysi',
    ]);
  });

  it('collapses duplicates, plurals, punctuation and case onto one token', () => {
    expect(planTitleTokens('Enzymes, enzyme & ENZYMES!')).toEqual(['enzyme']);
  });

  it('leaves short words alone rather than stemming them into nonsense', () => {
    expect(planTitleTokens('Gas laws').sort()).toEqual(['gas', 'law']);
  });

  it('is empty for a title made only of scaffolding', () => {
    expect(planTitleTokens('Week 7')).toEqual([]);
  });
});

describe('planTitleSimilarity', () => {
  it('scores a reordered, re-pluralised title as identical', () => {
    expect(planTitleSimilarity('Enzyme kinetics', 'Kinetics of the enzymes')).toBe(1);
  });

  it('scores unrelated titles zero rather than NaN', () => {
    expect(planTitleSimilarity('Enzymes', 'Glycolysis')).toBe(0);
    expect(planTitleSimilarity('Week 3', 'Week 4')).toBe(0);
  });

  it('puts a one-word title inside a long one BELOW the match threshold', () => {
    // Overlap-coefficient would score this 1.0 and match every long unit to the
    // first one-word week. Dice keeps it out.
    const score = planTitleSimilarity(
      'Enzymes',
      'Enzymes, kinetics, inhibition, regulation and assay design'
    );
    expect(score).toBeLessThan(PLAN_SYLLABUS_TITLE_MATCH);
    expect(score).toBeGreaterThan(0);
  });
});

describe('matchSyllabusWeeks', () => {
  it('matches on an exact title', () => {
    const matches = matchSyllabusWeeks(
      [week(1, 'Cell structure'), week(2, 'Enzymes')],
      [unit('u-enz', 'Enzymes', 10), unit('u-cell', 'Cell structure', 20)]
    );
    expect(matches.map((m) => [m.week, m.unitId, m.matchedBy])).toEqual([
      [1, 'u-cell', 'title'],
      [2, 'u-enz', 'title'],
    ]);
    expect(matches.every((m) => m.score === 1)).toBe(true);
  });

  it('matches fuzzily through scaffolding words on both sides', () => {
    const matches = matchSyllabusWeeks(
      [week(3, 'Week 3 — Glycolysis and fermentation')],
      [unit('u1', 'Lecture 3: Glycolysis, fermentation.pdf', 10)]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unitId).toBe('u1');
    expect(matches[0]!.matchedBy).toBe('title');
  });

  it('promotes a weak title overlap when the dates are in the same week', () => {
    const matches = matchSyllabusWeeks(
      [week(4, 'Enzymes, inhibition, regulation and assays', { date: '2026-10-05' })],
      [unit('u1', 'Enzymes', 10, '2026-10-08')]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedBy).toBe('date');
    expect(matches[0]!.score).toBeGreaterThanOrEqual(PLAN_SYLLABUS_TITLE_ASSIST);
  });

  it('does NOT promote a weak overlap when the dates are further apart', () => {
    const far = new Date(
      Date.parse('2026-10-05T00:00:00Z') +
        (PLAN_SYLLABUS_DATE_ASSIST_DAYS + 1) * 86_400_000
    )
      .toISOString()
      .slice(0, 10);
    expect(
      matchSyllabusWeeks(
        [week(4, 'Enzymes, inhibition, regulation and assays', { date: '2026-10-05' })],
        [unit('u1', 'Enzymes', 10, far)]
      )
    ).toEqual([]);
  });

  it('never matches on a date alone', () => {
    expect(
      matchSyllabusWeeks(
        [week(4, 'Photosynthesis', { date: '2026-10-05' })],
        [unit('u1', 'Roman law', 10, '2026-10-05')]
      )
    ).toEqual([]);
  });

  it('returns nothing when nothing is close enough', () => {
    expect(
      matchSyllabusWeeks([week(1, 'Thermodynamics')], [unit('u1', 'Baroque opera', 10)])
    ).toEqual([]);
  });

  it('breaks ties towards the earlier syllabus week, stably', () => {
    // Both units score exactly 1 against both weeks, so only the tie rule
    // decides. Week order wins, then unit position.
    const weeks = [week(2, 'Enzymes'), week(1, 'Enzymes')];
    const units = [unit('u-late', 'Enzymes', 20), unit('u-early', 'Enzymes', 10)];
    const first = matchSyllabusWeeks(weeks, units);
    const again = matchSyllabusWeeks([...weeks].reverse(), [...units].reverse());
    expect(first.map((m) => [m.week, m.unitId])).toEqual([
      [1, 'u-early'],
      [2, 'u-late'],
    ]);
    expect(again).toEqual(first);
  });

  it('is one-to-one: two units cannot take the same week', () => {
    const matches = matchSyllabusWeeks(
      [week(1, 'Enzymes')],
      [unit('a', 'Enzymes', 10), unit('b', 'Enzymes', 20)]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unitId).toBe('a');
  });
});

describe('buildPlanSyllabusView', () => {
  const units = [
    unit('u-glyc', 'Glycolysis', 10),
    unit('u-enz', 'Enzymes', 20),
    unit('u-loose', 'My revision notes', 30),
  ];

  it('is null without a summary, and null for a summary with no weeks', () => {
    expect(buildPlanSyllabusView(null, units)).toBeNull();
    expect(buildPlanSyllabusView(undefined, units)).toBeNull();
    expect(buildPlanSyllabusView(summaryOf([]), units)).toBeNull();
  });

  it('orders matched units by week and keeps unmatched ones behind, in plan order', () => {
    const view = buildPlanSyllabusView(
      summaryOf([week(1, 'Enzymes'), week(2, 'Glycolysis')]),
      units
    );
    expect(view!.syllabusOrder).toEqual(['u-enz', 'u-glyc', 'u-loose']);
  });

  it('lists a week nothing matched under comingUp and never as a unit', () => {
    const view = buildPlanSyllabusView(
      summaryOf([
        week(1, 'Enzymes'),
        week(2, 'Photosynthesis', { date: '2026-10-12' }),
        week(3, 'Midterm', { date: '2026-10-19', examLabel: 'Midterm' }),
      ]),
      units
    );
    expect(view!.matches.map((m) => m.unitId)).toEqual(['u-enz']);
    expect(view!.comingUp.map((row) => [row.week, row.title, row.date, row.examLabel])).toEqual([
      [2, 'Photosynthesis', '2026-10-12', null],
      [3, 'Midterm', '2026-10-19', 'Midterm'],
    ]);
    // Nothing about an unmatched week ever reaches the unit order.
    expect(view!.syllabusOrder).toEqual(['u-enz', 'u-glyc', 'u-loose']);
  });

  it('names an exam divider from the week label and anchors it after the prior unit', () => {
    const view = buildPlanSyllabusView(
      summaryOf([
        week(1, 'Enzymes'),
        week(2, 'Glycolysis'),
        week(3, 'Midterm exam', { date: '2026-10-10', examLabel: 'Exam 1' }),
      ]),
      units
    );
    expect(view!.examDividers).toEqual([
      {
        id: 'exam-1',
        name: 'Exam 1',
        date: '2026-10-10',
        label: 'Exam 1 · 10 Oct',
        afterUnitId: 'u-glyc',
      },
    ]);
  });

  it('numbers an unlabelled exam date and places it by the weeks already taught', () => {
    const view = buildPlanSyllabusView(
      summaryOf(
        [week(1, 'Enzymes', { date: '2026-09-07' }), week(2, 'Glycolysis', { date: '2026-09-14' })],
        ['2026-09-10']
      ),
      units
    );
    expect(view!.examDividers).toEqual([
      {
        id: 'exam-1',
        name: 'Exam 1',
        date: '2026-09-10',
        label: 'Exam 1 · 10 Sep',
        afterUnitId: 'u-enz',
      },
    ]);
  });

  it('anchors an exam before everything when no week precedes it', () => {
    const view = buildPlanSyllabusView(
      summaryOf([week(1, 'Diagnostic', { examLabel: 'Entry test' }), week(2, 'Enzymes')]),
      units
    );
    expect(view!.examDividers[0]!.afterUnitId).toBeNull();
    expect(view!.examDividers[0]!.name).toBe('Entry test');
  });
});

describe('orderUnitIdsBySyllabus', () => {
  it('is the identity without a view', () => {
    expect(orderUnitIdsBySyllabus(['b', 'a'], null)).toEqual(['b', 'a']);
  });

  it('keeps every id exactly once and parks unknown ones at the back', () => {
    const view = buildPlanSyllabusView(summaryOf([week(1, 'Enzymes')]), [
      unit('u-enz', 'Enzymes', 20),
      unit('u-x', 'Other', 10),
    ]);
    expect(orderUnitIdsBySyllabus(['u-x', 'u-enz', 'u-new'], view)).toEqual([
      'u-enz',
      'u-x',
      'u-new',
    ]);
  });
});

describe('planSyllabusRows', () => {
  const view = buildPlanSyllabusView(
    summaryOf([
      week(1, 'Enzymes'),
      week(2, 'Glycolysis'),
      week(3, 'Midterm', { date: '2026-10-10', examLabel: 'Exam 1' }),
    ]),
    [unit('u-enz', 'Enzymes', 10), unit('u-glyc', 'Glycolysis', 20)]
  );

  it('drops the divider in after its anchor unit', () => {
    expect(planSyllabusRows(['u-enz', 'u-glyc'], view, 'unit')).toEqual([
      { kind: 'unit', unitId: 'u-enz' },
      { kind: 'unit', unitId: 'u-glyc' },
      { kind: 'exam', divider: view!.examDividers[0] },
    ]);
  });

  it('keeps dividers under the recommended sort, which only lifts one unit', () => {
    const rows = planSyllabusRows(['u-glyc', 'u-enz'], view, 'recommended');
    expect(rows.some((row) => row.kind === 'exam')).toBe(true);
  });

  it('draws NO dividers under the weakest sort, which re-ranks everything', () => {
    expect(planSyllabusRows(['u-enz', 'u-glyc'], view, 'weakest')).toEqual([
      { kind: 'unit', unitId: 'u-enz' },
      { kind: 'unit', unitId: 'u-glyc' },
    ]);
  });

  it('drops a divider whose anchor unit is not on screen', () => {
    expect(planSyllabusRows(['u-enz'], view, 'unit')).toEqual([
      { kind: 'unit', unitId: 'u-enz' },
    ]);
  });

  it('is a plain unit list without a view', () => {
    expect(planSyllabusRows(['a', 'b'], null, 'unit')).toEqual([
      { kind: 'unit', unitId: 'a' },
      { kind: 'unit', unitId: 'b' },
    ]);
  });
});

describe('naming helpers', () => {
  it('formats a divider date without a year and without a timezone', () => {
    expect(formatPlanSyllabusDate('2026-10-10')).toBe('10 Oct');
    expect(formatPlanSyllabusDate('2026-01-01')).toBe('1 Jan');
    expect(formatPlanSyllabusDate('Week 3')).toBe('Week 3');
  });

  it('spells the eyebrow with and without a date', () => {
    const view = buildPlanSyllabusView(
      summaryOf([week(3, 'Enzymes', { date: '2026-10-05' }), week(4, 'Glycolysis')]),
      [unit('a', 'Enzymes', 10), unit('b', 'Glycolysis', 20)]
    );
    const byUnit = planSyllabusMatchesByUnit(view);
    expect(planSyllabusUnitEyebrow(byUnit.get('a')!)).toBe('Week 3 · 5 Oct');
    expect(planSyllabusUnitEyebrow(byUnit.get('b')!)).toBe('Week 4');
  });

  it('replaces the unit title with the week title, and keeps it when unmatched', () => {
    const view = buildPlanSyllabusView(summaryOf([week(1, 'Enzyme kinetics')]), [
      unit('a', 'Kinetics of enzyme', 10),
    ]);
    const byUnit = planSyllabusMatchesByUnit(view);
    expect(planSyllabusUnitTitle('Kinetics of enzyme', byUnit.get('a'))).toBe('Enzyme kinetics');
    expect(planSyllabusUnitTitle('Lecture 9.pdf', byUnit.get('missing'))).toBe('Lecture 9.pdf');
  });
});

describe('planSyllabusViewFor', () => {
  const summary = summaryOf([week(1, 'Enzymes'), week(2, 'Glycolysis')]);
  const serverUnits = [unit('srv-1', 'Enzymes', 10), unit('srv-2', 'Glycolysis', 20)];
  const payload = buildPlanSyllabusView(summary, serverUnits);

  it('uses the server view when it names a unit on screen', () => {
    expect(planSyllabusViewFor({ payload, summary, units: serverUnits })).toBe(payload);
  });

  it('recomputes against local units the server has never seen', () => {
    const localUnits = [unit('local-a', 'Glycolysis', 10), unit('local-b', 'Enzymes', 20)];
    const view = planSyllabusViewFor({ payload, summary, units: localUnits });
    expect(view!.syllabusOrder).toEqual(['local-b', 'local-a']);
  });

  it('is null when there is neither a payload nor a summary', () => {
    expect(planSyllabusViewFor({ payload: null, summary: null, units: serverUnits })).toBeNull();
  });
});
