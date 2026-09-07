import {
  SMART_NOTES_CREDIT_COST,
  AI_CREDIT_COSTS,
  MAX_AI_CREDIT_COST,
  MAX_LECTURE_TRANSCRIPTION_MS,
  MAX_NARRATION_PAGES,
  REFERRAL_BONUS_AI_USES,
  REFERRAL_BONUS_AI_USES_CAP,
  REFERRAL_REWARD_AI_USES,
  LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT,
  LECTURE_TRANSCRIPTION_PRICE_RULE,
  getLectureTranscriptionCost,
  getNarrationCreditCost,
  formatNarrationPrice,
  getSmartNotesCreditCost,
  formatBonusAIUses,
  formatCreditCost,
  formatLectureTranscriptionEstimate,
} from './aiCredits';

describe('aiCredits', () => {
  it('holds the decided depth costs: concise 1, standard 1, deep 3', () => {
    expect(SMART_NOTES_CREDIT_COST.concise).toBe(1);
    expect(SMART_NOTES_CREDIT_COST.standard).toBe(1);
    expect(SMART_NOTES_CREDIT_COST.deep).toBe(3);
  });

  it('getSmartNotesCreditCost falls back to standard for unknown input', () => {
    expect(getSmartNotesCreditCost('deep')).toBe(3);
    expect(getSmartNotesCreditCost(undefined)).toBe(1);
    expect(getSmartNotesCreditCost(null)).toBe(1);
    expect(getSmartNotesCreditCost('bananas')).toBe(1);
  });

  it('flashcards and questions cost 1; OCR costs 2', () => {
    expect(AI_CREDIT_COSTS.generate_flashcards).toBe(1);
    expect(AI_CREDIT_COSTS.generate_questions).toBe(1);
    expect(AI_CREDIT_COSTS.note_ocr).toBe(2);
  });

  it('formatCreditCost pluralizes', () => {
    expect(formatCreditCost(1)).toBe('1 AI use');
    expect(formatCreditCost(3)).toBe('3 AI uses');
  });
});

describe('getLectureTranscriptionCost', () => {
  const min = (m: number) => m * 60_000;

  it('prices the first block, and every part of a block after it, as a whole use', () => {
    // "1 AI use per 15 minutes, or part" read strictly. The boundary is the
    // whole rule: 15:00 is one part; 15:01 has started a second.
    const table: Array<[number, number]> = [
      [0, 1],
      [1_000, 1],
      [min(14) + 59_000, 1],
      [min(15), 1],
      [min(15) + 1_000, 2],
      [min(30), 2],
      [min(30) + 1, 3],
      [min(45), 3],
      [min(90), 6],
    ];
    for (const [durationMs, expected] of table) {
      expect(getLectureTranscriptionCost(durationMs)).toBe(expected);
    }
  });

  it('charges the one-use minimum for a duration it cannot believe', () => {
    // The figure comes from the request body. A missing, negative or NaN
    // duration must price at the floor, never at a guess that overcharges.
    for (const bad of [undefined, null, NaN, -1, -min(30), Infinity as number]) {
      expect(getLectureTranscriptionCost(bad as unknown as number)).toBe(1);
    }
  });

  it('never lets one request exceed the global per-action ceiling', () => {
    // 3h is the longest duration the server will believe; even that, and
    // anything a client claims beyond it, is bounded by MAX_AI_CREDIT_COST.
    expect(getLectureTranscriptionCost(MAX_LECTURE_TRANSCRIPTION_MS)).toBe(MAX_AI_CREDIT_COST);
    expect(getLectureTranscriptionCost(min(60 * 24))).toBe(MAX_AI_CREDIT_COST);
  });
});

describe('referral bonus AI uses', () => {
  it('pays both sides the same, and never more than the banked cap', () => {
    expect(REFERRAL_BONUS_AI_USES).toBeGreaterThan(0);
    expect(REFERRAL_BONUS_AI_USES).toBeLessThanOrEqual(REFERRAL_BONUS_AI_USES_CAP);
  });

  it('promises on screen exactly what the server grants', () => {
    // These were once two separate literals that disagreed. An alias cannot
    // drift; this test exists so nobody splits them again.
    expect(REFERRAL_REWARD_AI_USES).toBe(REFERRAL_BONUS_AI_USES);
  });
});

describe('lecture transcription copy', () => {
  it('says the price in the one currency word, and calls it an estimate', () => {
    expect(formatLectureTranscriptionEstimate(20 * 60_000)).toBe('About 2 AI uses for this lecture');
    expect(formatLectureTranscriptionEstimate(60_000)).toBe('About 1 AI use for this lecture');
  });

  it('states the rule with the constant, not a typed number', () => {
    expect(LECTURE_TRANSCRIPTION_PRICE_RULE).toContain(
      `${LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT} minutes`
    );
    expect(LECTURE_TRANSCRIPTION_PRICE_RULE).toContain(formatCreditCost(1));
  });
});

describe('formatBonusAIUses', () => {
  it('says nothing when the server said nothing — an absent field is not a zero', () => {
    expect(formatBonusAIUses(undefined)).toBeNull();
    expect(formatBonusAIUses(null)).toBeNull();
    expect(formatBonusAIUses(Number.NaN)).toBeNull();
  });

  it('says nothing when the balance is empty', () => {
    expect(formatBonusAIUses(0)).toBeNull();
    expect(formatBonusAIUses(-3)).toBeNull();
  });

  it('prints a balance it actually has', () => {
    expect(formatBonusAIUses(1)).toBe('+1 bonus use');
    expect(formatBonusAIUses(REFERRAL_REWARD_AI_USES)).toBe(
      `+${REFERRAL_REWARD_AI_USES} bonus uses`
    );
  });
});

describe('getNarrationCreditCost', () => {
  it('charges the first tier for anything up to twenty pages', () => {
    expect(getNarrationCreditCost(1)).toBe(2);
    expect(getNarrationCreditCost(20)).toBe(2);
  });

  it('charges the second tier from twenty-one pages', () => {
    expect(getNarrationCreditCost(21)).toBe(3);
    expect(getNarrationCreditCost(MAX_NARRATION_PAGES)).toBe(3);
  });

  it('never quotes zero for a request that will be charged', () => {
    expect(getNarrationCreditCost(0)).toBe(2);
    expect(getNarrationCreditCost(-4)).toBe(2);
    expect(getNarrationCreditCost(Number.NaN)).toBe(2);
  });

  it('clamps past the page ceiling instead of climbing forever', () => {
    expect(getNarrationCreditCost(MAX_NARRATION_PAGES + 500)).toBe(3);
    expect(getNarrationCreditCost(Number.POSITIVE_INFINITY)).toBe(2);
  });

  it('stays inside the per-request bound', () => {
    expect(getNarrationCreditCost(999)).toBeLessThanOrEqual(MAX_AI_CREDIT_COST);
  });
});

describe('formatNarrationPrice', () => {
  it('prints the price and the page ceiling it buys', () => {
    expect(formatNarrationPrice(12)).toBe('2 AI uses — covers up to 12 pages');
    expect(formatNarrationPrice(30)).toBe('3 AI uses — covers up to 30 pages');
  });

  it('tells a long document where the reading stops', () => {
    expect(formatNarrationPrice(120)).toBe(
      `3 AI uses — covers up to ${MAX_NARRATION_PAGES} pages`
    );
  });

  it('uses the singular for a one-page handout', () => {
    expect(formatNarrationPrice(1)).toBe('2 AI uses — covers up to 1 page');
  });
});
