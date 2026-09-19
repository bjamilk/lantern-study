// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyPlanSyllabusNames,
  buildPlanSyllabusView,
  orderTimelineBySyllabus,
  planTimeline,
  sortPlanTimeline,
  type PlanComingUpWeek,
  type StudySetTopic,
  type StudySetUnit,
} from '@lantern/shared';

/**
 * The study plan page at the dimensions measured off StudyFetch on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Study Plan).
 *
 * STRUCTURE tests, not pixel tests, for the same reason the set home's are: a
 * render test cannot measure a laid-out box, and asserting on a Tailwind class
 * string would only prove the string was typed. What is pinned is what was
 * actually missing:
 *
 *   - a "Customize your Study Plan" bar carrying Mode AND Sort By, where
 *     Lantern had a row of mode chips and an argument against ever drawing a
 *     sort;
 *   - a pre-assessment card INSIDE each open unit rather than one for the whole
 *     page, whose pill says what it is about to do and whether that spends an
 *     AI credit;
 *   - topics struck through only when MASTERED, and the `Sources:` chips.
 */
import { PlanCustomizeBar } from './PlanCustomizeBar';
import { UnitPreAssessmentCard } from './UnitPreAssessmentCard';
import { PlanComingUpList, StudyPlanTimeline } from './StudyPlanTimeline';

const SET = '8f1b0c2e-2222-4a2b-9c3d-000000000002';

function unit(id: string, position: number, title: string): StudySetUnit {
  return { id, studySetId: SET, title, position };
}

function topic(
  id: string,
  unitId: string,
  position: number,
  status: StudySetTopic['status'] = 'unseen'
): StudySetTopic {
  return {
    id,
    studySetId: SET,
    unitId,
    title: `Topic ${id}`,
    position,
    status,
    sourceNoteIds: ['note-1'],
  };
}

const UNITS = [unit('u1', 10, 'Cell biology'), unit('u2', 20, 'Genetics')];
const TOPICS = [
  topic('a', 'u1', 10, 'mastered'),
  topic('b', 'u1', 20),
  // Untouched, so Genetics is genuinely the weaker unit: Cell biology is
  // half-filled (one of two mastered) and this one is at zero.
  topic('c', 'u2', 10),
];

describe('the customize bar', () => {
  const bar = (extra: Partial<React.ComponentProps<typeof PlanCustomizeBar>> = {}) =>
    renderToStaticMarkup(
      <PlanCustomizeBar
        mode="standard"
        onModeChange={() => {}}
        sort="recommended"
        onSortChange={() => {}}
        {...extra}
      />
    );

  it('offers Mode and Sort By, with every option the reference names', () => {
    const html = bar();
    expect(html).toContain('Customize your study plan');
    for (const label of ['Cram', 'Standard', 'Comprehensive']) {
      expect(html).toContain(label);
    }
    for (const label of ['Recommended', 'Unit order', 'Weakest first']) {
      expect(html).toContain(label);
    }
  });

  it('writes the chosen mode promise out rather than hiding it in a tooltip', () => {
    expect(bar({ mode: 'cram' })).toContain('Fewer topics, exam-weighted');
  });

  it('draws the gear only when there are settings to open', () => {
    expect(bar()).not.toContain('Study set settings');
    expect(bar({ onOpenSettings: () => {} })).toContain('Study set settings');
  });

  it('draws NO filter control — nothing on a plan row filters by', () => {
    // The reference has a filter icon beside the gear. Lantern has nothing to
    // filter by that Sort By does not already express; a live-looking dead
    // control is what the declutter pass removed everywhere else.
    expect(bar({ onOpenSettings: () => {} }).toLowerCase()).not.toContain('filter');
  });
});

describe('the per-unit pre-assessment card', () => {
  const card = (extra: Partial<React.ComponentProps<typeof UnitPreAssessmentCard>> = {}) =>
    renderToStaticMarkup(
      <UnitPreAssessmentCard action="start" onStart={() => {}} {...extra} />
    );

  it('carries the reference copy and the three-minute promise', () => {
    const html = card();
    expect(html).toContain('See what you already know');
    expect(html).toContain('3 minutes');
    expect(html).toContain('Continue');
  });

  it('says a first check spends an AI credit', () => {
    expect(card()).toContain('uses 1 AI credit');
  });

  it('a RESUME says it costs nothing, because it does not', () => {
    const html = card({ action: 'resume' });
    expect(html).toContain('Resume');
    expect(html).toContain('no AI use');
    expect(html).not.toContain('uses 1 AI credit');
  });

  it('offers a Retake once the check is finished', () => {
    expect(card({ action: 'retake' })).toContain('Retake');
  });

  it('reports what the last check actually moved', () => {
    expect(card({ action: 'retake', covered: 1 })).toContain('moved 1 topic forward');
    expect(card({ action: 'retake', covered: 3 })).toContain('moved 3 topics forward');
    expect(card({ action: 'retake', covered: 0 })).not.toContain('forward');
  });

  it('cannot be pressed twice while it is building', () => {
    expect(card({ busy: true })).toContain('disabled');
  });
});

describe('the unit accordions', () => {
  const timeline = planTimeline(UNITS, TOPICS, 'b');
  const page = (extra: Partial<React.ComponentProps<typeof StudyPlanTimeline>> = {}) =>
    renderToStaticMarkup(
      <StudyPlanTimeline
        timeline={timeline}
        openUnitIds={{ u1: true }}
        onToggleUnit={() => {}}
        onCycleStatus={() => {}}
        onStartTopic={() => {}}
        materials={[{ id: 'note-1', title: 'Lecture 3' }]}
        onOpenSource={() => {}}
        {...extra}
      />
    );

  it('numbers the units and marks where to start', () => {
    const html = page();
    expect(html).toContain('Start learning here');
    expect(html).toContain('01');
    expect(html).toContain('Cell biology');
  });

  it('draws the check inside the OPEN unit only', () => {
    const html = page({
      renderUnitPreAssessment: (row) =>
        row.id === 'u1' ? <UnitPreAssessmentCard action="start" onStart={() => {}} /> : null,
    });
    // One card: u2 is collapsed, so its card is not rendered at all.
    expect(html.split('See what you already know').length - 1).toBe(1);
  });

  it('renders no card at all when the caller supplies none', () => {
    expect(page()).not.toContain('See what you already know');
  });

  it('strikes a topic through only when it is MASTERED', () => {
    const html = page();
    // Topic a is mastered and struck; b is the recommendation and is not.
    const struck = html.match(/line-through/g) ?? [];
    expect(struck.length).toBe(1);
  });

  it('names the materials the unit was built from', () => {
    expect(page()).toContain('Sources:');
    expect(page()).toContain('Lecture 3');
  });
});

describe('Sort By reorders the page', () => {
  it('weakest first puts the untouched unit above the finished one', () => {
    const built = planTimeline(UNITS, TOPICS, 'b');
    const order = sortPlanTimeline(built, 'weakest').map((row) => row.unit.title);
    expect(order[0]).toBe('Genetics');
  });

  it('recommended lifts the unit holding Continue', () => {
    const built = planTimeline(UNITS, TOPICS, 'c');
    expect(sortPlanTimeline(built, 'recommended')[0]?.unit.title).toBe('Genetics');
  });
});

/**
 * The syllabus half of the page: units NAMED and ORDERED by the class schedule,
 * exam markers between them, and the weeks with nothing behind them kept OUT of
 * the plan and listed instead.
 *
 * The rule under every assertion here is the one #142 refused to break: a week
 * may become a unit only when real material matched it. So the interesting
 * cases are the negative ones — the unmatched week that must not appear as a
 * unit, and the no-syllabus render that must be byte-for-byte what it was.
 */
describe('the plan against the syllabus', () => {
  const summary = {
    weeks: [
      { week: 1, title: 'Genetics', date: '2026-09-07', examLabel: null },
      { week: 2, title: 'Cell biology', date: '2026-09-14', examLabel: null },
      { week: 3, title: 'Photosynthesis', date: '2026-09-21', examLabel: null },
      { week: 4, title: 'Midterm', date: '2026-10-10', examLabel: 'Exam 1' },
    ],
    examDates: ['2026-10-10'],
    extractedAt: '2026-09-18T00:00:00.000Z',
  };
  const view = buildPlanSyllabusView(summary, UNITS);
  const named = applyPlanSyllabusNames(UNITS, view);
  const timeline = orderTimelineBySyllabus(planTimeline(named, TOPICS, 'b'), view);

  const page = (extra: Partial<React.ComponentProps<typeof StudyPlanTimeline>> = {}) =>
    renderToStaticMarkup(
      <StudyPlanTimeline
        timeline={timeline}
        openUnitIds={{}}
        onToggleUnit={() => {}}
        onCycleStatus={() => {}}
        onStartTopic={() => {}}
        syllabus={view}
        sort="unit"
        {...extra}
      />
    );

  it('puts the syllabus week over each unit it named', () => {
    const html = page();
    expect(html).toContain('Week 1 · 7 Sep');
    expect(html).toContain('Week 2 · 14 Sep');
  });

  it('runs the units in syllabus order, not plan order', () => {
    // Plan order is Cell biology then Genetics; the syllabus teaches Genetics
    // in week 1, so it leads.
    expect(timeline.map((row) => row.unit.title)).toEqual(['Genetics', 'Cell biology']);
  });

  it('draws the exam as a marker between units, not as a unit', () => {
    const html = page();
    expect(html).toContain('Exam 1 · 10 Oct');
    expect(html).toContain('role="separator"');
    // A marker is not a stop on the route: the units are still 01 and 02.
    expect(html).toContain('02');
    expect(html).not.toContain('03');
  });

  it('drops the exam marker under the sort that re-ranks everything', () => {
    expect(page({ sort: 'weakest' })).not.toContain('Exam 1 · 10 Oct');
  });

  it('renders exactly what it rendered before when there is no syllabus', () => {
    const plain = renderToStaticMarkup(
      <StudyPlanTimeline
        timeline={planTimeline(UNITS, TOPICS, 'b')}
        openUnitIds={{}}
        onToggleUnit={() => {}}
        onCycleStatus={() => {}}
        onStartTopic={() => {}}
      />
    );
    const withNullSyllabus = renderToStaticMarkup(
      <StudyPlanTimeline
        timeline={planTimeline(UNITS, TOPICS, 'b')}
        openUnitIds={{}}
        onToggleUnit={() => {}}
        onCycleStatus={() => {}}
        onStartTopic={() => {}}
        syllabus={null}
        sort="recommended"
      />
    );
    expect(withNullSyllabus).toBe(plain);
    expect(plain).not.toContain('Week 1');
  });
});

describe('Coming up in your syllabus', () => {
  const list = (weeks: PlanComingUpWeek[], onAdd?: () => void) =>
    renderToStaticMarkup(<PlanComingUpList weeks={weeks} onAddMaterials={onAdd} />);

  it('lists an unmatched week as text with its date, never as a topic', () => {
    const html = list([
      { week: 3, title: 'Photosynthesis', date: '2026-09-21', examLabel: null },
    ]);
    expect(html).toContain('Coming up in your syllabus');
    expect(html).toContain('Week 3');
    expect(html).toContain('Photosynthesis');
    expect(html).toContain('21 Sep');
    // One door for the block, and nothing per week.
    expect(html.split('<button').length - 1).toBe(0);
  });

  it('carries an exam label through', () => {
    expect(
      list([{ week: 4, title: 'Midterm', date: '2026-10-10', examLabel: 'Exam 1' }])
    ).toContain('Exam 1');
  });

  it('offers one Add materials door, at 44px', () => {
    const html = list(
      [{ week: 3, title: 'Photosynthesis', date: null, examLabel: null }],
      () => {}
    );
    expect(html.split('<button').length - 1).toBe(1);
    expect(html).toContain('Add materials');
    expect(html).toContain('min-h-[44px]');
  });

  it('draws nothing at all when every week has material behind it', () => {
    expect(list([])).toBe('');
  });
});
