import {
  continueDueReviewLabel,
  dueReviewPlan,
  dueReviewProgress,
  nextDueReviewLeg,
} from './dueReview';

interface Card {
  id: string;
  deckId: string;
}

const decks = [
  { id: 'anatomy', name: 'Anatomy' },
  { id: 'pharm', name: 'Pharmacology' },
  { id: 'empty', name: 'Biochem' },
];

function cards(deckId: string, count: number): Card[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${deckId}-${i}`, deckId }));
}

const due: Record<string, Card[]> = {
  anatomy: cards('anatomy', 17),
  pharm: cards('pharm', 51),
  empty: [],
};

const getDueCards = (deckId: string) => due[deckId] ?? [];

describe('dueReviewPlan', () => {
  it('queues every due card across decks, not just the biggest deck', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(plan.totalDue).toBe(68);
    expect(plan.queue).toHaveLength(68);
    // The defect this exists to stop: the button said 68, the session dealt 17.
    expect(plan.queue.length).toBeGreaterThan(plan.first!.dueCount);
  });

  it('orders legs biggest pile first and drops decks with nothing due', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(plan.legs.map((leg) => leg.deckId)).toEqual(['pharm', 'anatomy']);
    expect(plan.first?.deckId).toBe('pharm');
  });

  it('keeps each leg contiguous in the queue', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(plan.queue.slice(0, 51).every((card) => card.deckId === 'pharm')).toBe(true);
    expect(plan.queue.slice(51).every((card) => card.deckId === 'anatomy')).toBe(true);
  });

  it('breaks ties by deck id so the named deck is the deck that opens', () => {
    const tied = [
      { id: 'zebra', name: 'Zebra' },
      { id: 'alpha', name: 'Alpha' },
    ];
    const tiedDue = (deckId: string) => cards(deckId, 4);
    const a = dueReviewPlan(tied, tiedDue);
    const b = dueReviewPlan([...tied].reverse(), tiedDue);
    expect(a.first?.deckId).toBe('alpha');
    expect(b.first?.deckId).toBe(a.first?.deckId);
  });

  it('labels the queue with the total and the chain with the first leg only', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(plan.queueLabel).toBe('Study all 68 due');
    expect(plan.chainLabel).toBe('Review Pharmacology · 51 due');
  });

  it('never promises more than it deals', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(plan.queueLabel).toContain(String(plan.queue.length));
    expect(plan.chainLabel).toContain(String(plan.first!.cards.length));
  });

  it('is empty and unlabelled when nothing is due', () => {
    const plan = dueReviewPlan(decks, () => []);
    expect(plan.totalDue).toBe(0);
    expect(plan.first).toBeNull();
    expect(plan.chainLabel).toBeNull();
    expect(plan.legs).toEqual([]);
  });

  it('survives missing decks, blank names and null card lists', () => {
    const plan = dueReviewPlan(
      [{ id: 'a', name: '  ' }, { id: '', name: 'no id' }, null as never],
      (deckId) => (deckId === 'a' ? cards('a', 2) : null)
    );
    expect(plan.totalDue).toBe(2);
    expect(plan.first?.deckName).toBe('Untitled deck');
  });

  it('copies the caller\'s card list so the plan cannot mutate the store', () => {
    const source = cards('anatomy', 3);
    const plan = dueReviewPlan([{ id: 'anatomy', name: 'Anatomy' }], () => source);
    plan.first!.cards.push({ id: 'x', deckId: 'anatomy' });
    expect(source).toHaveLength(3);
  });
});

describe('nextDueReviewLeg', () => {
  it('hands back the next-largest deck, then nothing', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    const next = nextDueReviewLeg(plan, 'pharm');
    expect(next?.deckId).toBe('anatomy');
    expect(nextDueReviewLeg(plan, 'anatomy')).toBeNull();
  });

  it('returns null for a deck that is not in the plan', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(nextDueReviewLeg(plan, 'empty')).toBeNull();
  });
});

describe('continueDueReviewLabel', () => {
  it('names the deck and its own count', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    expect(continueDueReviewLabel(plan.legs[1])).toBe('Continue with Anatomy (17 due)');
  });
});

describe('dueReviewProgress', () => {
  // Four legs, 68 due in total — the device case: Home said 68, the phone
  // opened the 17-card leg and counted "1 / 17".
  const chain = {
    legs: [
      { deckName: 'Pharmacology', dueCount: 30 },
      { deckName: 'Anatomy', dueCount: 20 },
      { deckName: 'Biochem', dueCount: 17 },
      { deckName: 'Physiology', dueCount: 1 },
    ],
  };

  it('counts the first card of the first deck as 1 of the whole plan', () => {
    expect(dueReviewProgress(chain, 0, 0)).toEqual({
      overall: 1,
      total: 68,
      deckLabel: 'Deck 1 of 4 · Pharmacology',
    });
  });

  it('carries the earlier decks into the position of a later leg', () => {
    expect(dueReviewProgress(chain, 2, 0)).toEqual({
      overall: 51,
      total: 68,
      deckLabel: 'Deck 3 of 4 · Biochem',
    });
    expect(dueReviewProgress(chain, 3, 0)?.overall).toBe(68);
  });

  it('clamps an end-of-deck index to the last card rather than overrunning', () => {
    expect(dueReviewProgress(chain, 0, 30)?.overall).toBe(30);
    expect(dueReviewProgress(chain, 0, -4)?.overall).toBe(1);
  });

  it('stays silent for a single-deck session, so its counter reads n / deckDue', () => {
    expect(dueReviewProgress({ legs: [{ deckName: 'Anatomy', dueCount: 17 }] }, 0, 0)).toBeNull();
    expect(dueReviewProgress({ legs: [] }, 0, 0)).toBeNull();
    expect(dueReviewProgress(null, 0, 0)).toBeNull();
  });

  it('stays silent for a deck outside the plan or with nothing due', () => {
    expect(dueReviewProgress(chain, 4, 0)).toBeNull();
    expect(dueReviewProgress(chain, -1, 0)).toBeNull();
    expect(dueReviewProgress({ legs: [{ deckName: 'A', dueCount: 0 }, { deckName: 'B', dueCount: 0 }] }, 0, 0)).toBeNull();
    expect(dueReviewProgress({ legs: [{ deckName: 'A', dueCount: 0 }, { deckName: 'B', dueCount: 3 }] }, 0, 0)).toBeNull();
  });

  it('names an untitled deck rather than showing an empty half-label', () => {
    const plan = { legs: [{ deckName: '  ', dueCount: 2 }, { deckName: 'Anatomy', dueCount: 3 }] };
    expect(dueReviewProgress(plan, 0, 1)?.deckLabel).toBe('Deck 1 of 2 · Untitled deck');
  });

  it('agrees with a real plan built by dueReviewPlan', () => {
    const plan = dueReviewPlan(decks, getDueCards);
    const at = dueReviewProgress(plan, 1, 0);
    expect(at?.total).toBe(plan.totalDue);
    expect(at?.overall).toBe(plan.legs[0].dueCount + 1);
    expect(at?.deckLabel).toBe('Deck 2 of 2 · Anatomy');
  });
});
