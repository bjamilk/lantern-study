import {
  AI_COST_SPECS,
  ZERO_CREDIT_DOORS,
  buildAIUsageView,
  planZeroCreditSteps,
} from './aiUsageView';
import {
  AI_CREDIT_COSTS,
  AI_FEATURE_CREDIT_COST,
  REFERRAL_BONUS_AI_USES,
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
} from '../utils/aiCredits';
import { STUDY_PACK_DRAFT_CREDITS } from '../marketplace/studyPacks';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const RESETS = '2026-09-08T00:00:00.000Z';

describe('buildAIUsageView', () => {
  it('reports the counter the server sent', () => {
    const view = buildAIUsageView({ used: 8, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.used).toBe(8);
    expect(view.remaining).toBe(12);
    expect(view.ratio).toBeCloseTo(0.6);
    expect(view.countLabel).toBe('12 of 20 AI uses left today');
    expect(view.exhausted).toBe(false);
    expect(view.low).toBe(false);
  });

  it('clamps a used count above the limit to zero left, never negative', () => {
    const view = buildAIUsageView({ used: 25, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.used).toBe(20);
    expect(view.remaining).toBe(0);
    expect(view.ratio).toBe(0);
    expect(view.exhausted).toBe(true);
  });

  it('marks two or fewer left as low, and zero as exhausted rather than low', () => {
    expect(buildAIUsageView({ used: 18, limit: 20, resetsAt: RESETS }, { nowMs: NOW }).low).toBe(
      true
    );
    const zero = buildAIUsageView({ used: 20, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(zero.low).toBe(false);
    expect(zero.exhausted).toBe(true);
  });

  it('says so honestly when the account has no allowance at all', () => {
    const view = buildAIUsageView({ used: 0, limit: 0, resetsAt: '' }, { nowMs: NOW });
    expect(view.countLabel).toBe('AI uses are not available on this account');
    // No limit is not the same as being out of credit: nothing was spent.
    expect(view.exhausted).toBe(false);
  });

  it('prints both an absolute and a relative reset', () => {
    const view = buildAIUsageView({ used: 1, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.resetRelative).toBe('Resets in 12h 0m');
    expect(view.resetAbsolute).not.toBe('');
  });

  it('falls back to a truthful reset line when the server sent no timestamp', () => {
    const view = buildAIUsageView({ used: 0, limit: 20, resetsAt: '' }, { nowMs: NOW });
    expect(view.resetRelative).toBe('Resets at midnight GMT');
    expect(view.resetAbsolute).toBe('');
  });
});

describe('the cost table', () => {
  it('takes every price from the constants the server charges against', () => {
    const view = buildAIUsageView({ used: 0, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    const cost = (id: string) => view.costRows.find((row) => row.id === id)?.cost;
    expect(cost('flashcards')).toBe(AI_CREDIT_COSTS.generate_flashcards);
    expect(cost('questions')).toBe(AI_CREDIT_COSTS.generate_questions);
    expect(cost('note_ocr')).toBe(AI_CREDIT_COSTS.note_ocr);
    expect(cost('smart_notes_standard')).toBe(SMART_NOTES_CREDIT_COST.standard);
    expect(cost('smart_notes_deep')).toBe(SMART_NOTES_CREDIT_COST.deep);
    expect(cost('tutor')).toBe(AI_FEATURE_CREDIT_COST);
    expect(cost('transcribe')).toBe(AI_FEATURE_CREDIT_COST);
    expect(cost('study_pack_draft')).toBe(STUDY_PACK_DRAFT_CREDITS);
  });

  it('labels every cost through formatCreditCost, so pluralisation is never local', () => {
    const view = buildAIUsageView({ used: 0, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    for (const row of view.costRows) {
      expect(row.costLabel).toBe(formatCreditCost(row.cost));
    }
  });

  it('never prices anything at zero — a free thing belongs in the free list', () => {
    for (const spec of AI_COST_SPECS) {
      expect(spec.cost).toBeGreaterThan(0);
    }
  });

  it('marks rows the remaining allowance cannot pay for', () => {
    const view = buildAIUsageView({ used: 18, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.costRows.find((r) => r.id === 'flashcards')?.affordable).toBe(true);
    expect(view.costRows.find((r) => r.id === 'note_ocr')?.affordable).toBe(true);
    expect(view.costRows.find((r) => r.id === 'smart_notes_deep')?.affordable).toBe(false);
    expect(view.costRows.find((r) => r.id === 'study_pack_draft')?.affordable).toBe(false);
  });

  it('surfaces a per-feature cap when the server sent one', () => {
    const view = buildAIUsageView(
      {
        used: 3,
        limit: 20,
        resetsAt: RESETS,
        features: [{ feature: 'generate_flashcards', used: 15, limit: 15 }],
      },
      { nowMs: NOW }
    );
    const row = view.costRows.find((r) => r.id === 'flashcards')!;
    expect(row.featureCapLabel).toBe('15 of 15 used today');
    // The global counter still shows 17 left; this action is refused anyway.
    expect(row.featureCapReached).toBe(true);
    expect(row.affordable).toBe(true);
  });

  it('claims no per-feature cap when the server did not send one', () => {
    const view = buildAIUsageView({ used: 3, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    for (const row of view.costRows) {
      expect(row.featureCapLabel).toBeUndefined();
      expect(row.featureCapReached).toBe(false);
    }
  });

  it('ignores a feature limit of zero rather than reporting a cap that is spent', () => {
    const view = buildAIUsageView(
      {
        used: 0,
        limit: 20,
        resetsAt: RESETS,
        features: [{ feature: 'companion', used: 0, limit: 0 }],
      },
      { nowMs: NOW }
    );
    const row = view.costRows.find((r) => r.id === 'tutor')!;
    expect(row.featureCapLabel).toBeUndefined();
    expect(row.featureCapReached).toBe(false);
  });
});

describe('the zero-credit doors', () => {
  it('is the same list on the screen and in the planner', () => {
    const view = buildAIUsageView({ used: 20, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.freeRows.map((r) => r.id)).toEqual(ZERO_CREDIT_DOORS.map((r) => r.id));
  });

  it('does not list anything that also appears in the cost table', () => {
    const costIds = new Set(AI_COST_SPECS.map((s) => s.id));
    for (const door of ZERO_CREDIT_DOORS) {
      expect(costIds.has(door.id)).toBe(false);
    }
  });

  it('keeps recording free and transcription paid — they are different actions', () => {
    expect(ZERO_CREDIT_DOORS.some((d) => d.id === 'record')).toBe(true);
    expect(AI_COST_SPECS.some((s) => s.id === 'transcribe')).toBe(true);
  });
});

describe('planZeroCreditSteps', () => {
  // The founder's decision put the referral first: it is the only step that
  // can CHANGE the number, and the reset and the free doors are both things
  // that were already true. The reset still leads everything that is not the
  // referral, and every free door still follows it, in order.
  it('leads with the referral, then the reset, then every free door', () => {
    const steps = planZeroCreditSteps({ used: 20, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(steps[0].kind).toBe('referral');
    expect(steps[1].kind).toBe('wait');
    expect(steps[1].label).toBe('Resets in 12h 0m');
    expect(steps.slice(2).map((s) => s.id)).toEqual(ZERO_CREDIT_DOORS.map((d) => d.id));
    expect(steps.slice(2).every((s) => s.kind === 'free-door')).toBe(true);
  });

  it('drops the referral where there is no invite route to send the student to', () => {
    const steps = planZeroCreditSteps(
      { used: 20, limit: 20, resetsAt: RESETS },
      { nowMs: NOW, includeReferral: false }
    );
    expect(steps.some((s) => s.kind === 'referral')).toBe(false);
    expect(steps[0].kind).toBe('wait');
  });

  it('promises exactly the number the server grants, never a local literal', () => {
    const [referral] = planZeroCreditSteps(
      { used: 20, limit: 20, resetsAt: RESETS },
      { nowMs: NOW }
    );
    expect(referral.label).toContain(formatCreditCost(REFERRAL_BONUS_AI_USES));
  });

  it('says how many are left when the student is not actually at zero', () => {
    const steps = planZeroCreditSteps({ used: 5, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(steps.find((s) => s.kind === 'wait')!.detail).toBe('You still have 15 today.');
  });

  it('appends the founder extension point last, and forces its kind', () => {
    const steps = planZeroCreditSteps(
      { used: 20, limit: 20, resetsAt: RESETS },
      {
        nowMs: NOW,
        extraSteps: [
          { id: 'topup', label: 'Top up', detail: 'Pending decision', kind: 'free-door' },
        ],
      }
    );
    const last = steps[steps.length - 1];
    expect(last.id).toBe('topup');
    expect(last.kind).toBe('extension');
  });

  it('never lets an extension shadow a free door with the same id', () => {
    const steps = planZeroCreditSteps(
      { used: 20, limit: 20, resetsAt: RESETS },
      {
        nowMs: NOW,
        extraSteps: [{ id: 'study', label: 'Buy more', detail: '', kind: 'extension' }],
      }
    );
    expect(steps.filter((s) => s.id === 'study')).toHaveLength(1);
    expect(steps.find((s) => s.id === 'study')!.kind).toBe('free-door');
  });

  it('offers a reset line even when the server sent no timestamp', () => {
    const steps = planZeroCreditSteps({ used: 20, limit: 20, resetsAt: '' }, { nowMs: NOW });
    expect(steps.find((s) => s.kind === 'wait')!.label).toBe('Resets soon');
  });
});

describe('the bonus line', () => {
  it('says nothing when the server did not report a bonus balance', () => {
    // An older API sends no `bonusRemaining` at all. Absent is not zero, and
    // the screen must print neither a balance nor a "+0" it never measured.
    const view = buildAIUsageView({ used: 4, limit: 20, resetsAt: RESETS }, { nowMs: NOW });
    expect(view.bonusLabel).toBeNull();
  });

  it('says nothing when the balance is spent', () => {
    const view = buildAIUsageView(
      { used: 4, limit: 20, resetsAt: RESETS, bonusRemaining: 0 },
      { nowMs: NOW }
    );
    expect(view.bonusLabel).toBeNull();
  });

  it('prints a balance the server actually reported', () => {
    const view = buildAIUsageView(
      { used: 4, limit: 20, resetsAt: RESETS, bonusRemaining: REFERRAL_BONUS_AI_USES },
      { nowMs: NOW }
    );
    expect(view.bonusLabel).toBe(`+${REFERRAL_BONUS_AI_USES} bonus uses`);
  });

  it('does not fold the bonus into the daily counter', () => {
    // The counter is the server's daily arithmetic. Bonus uses are a separate
    // pot with their own line; adding them here would make the meter disagree
    // with the badge and with the server.
    const view = buildAIUsageView(
      { used: 20, limit: 20, resetsAt: RESETS, bonusRemaining: 5 },
      { nowMs: NOW }
    );
    expect(view.countLabel).toBe('0 of 20 AI uses left today');
    expect(view.exhausted).toBe(true);
  });
});
