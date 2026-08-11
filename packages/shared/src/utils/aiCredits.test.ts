import {
  SMART_NOTES_CREDIT_COST,
  AI_CREDIT_COSTS,
  getSmartNotesCreditCost,
  formatCreditCost,
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
    expect(formatCreditCost(1)).toBe('1 credit');
    expect(formatCreditCost(3)).toBe('3 credits');
  });
});
