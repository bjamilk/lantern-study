// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { planTimeline, sortPlanTimeline, type StudySetTopic, type StudySetUnit } from '@lantern/shared';

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
import { StudyPlanTimeline } from './StudyPlanTimeline';

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
