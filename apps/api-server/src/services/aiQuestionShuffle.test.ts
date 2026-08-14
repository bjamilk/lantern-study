import { __testables, normalizeQuizCorrectAnswer } from './aiService';

const { shuffleGeneratedOptions } = __testables;

describe('shuffleGeneratedOptions', () => {
  const OPTIONS = ['correct', 'distractor-1', 'distractor-2', 'distractor-3'];

  it('does not leave the correct answer first every time', () => {
    // The original bug: models copied the prompt example and put the answer
    // first, so a student could score without reading the question. One
    // sample proves nothing here — the failure mode is a distribution.
    const positions = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const shuffled = shuffleGeneratedOptions('multiple_choice', OPTIONS)!;
      positions.add(shuffled.indexOf('correct'));
    }
    expect(positions.size).toBe(OPTIONS.length);
  });

  it('keeps every option exactly once', () => {
    for (let i = 0; i < 50; i++) {
      const shuffled = shuffleGeneratedOptions('multiple_choice', OPTIONS)!;
      expect([...shuffled].sort()).toEqual([...OPTIONS].sort());
    }
  });

  it('leaves True/False in conventional order', () => {
    for (let i = 0; i < 50; i++) {
      expect(shuffleGeneratedOptions('true_false', ['True', 'False'])).toEqual(['True', 'False']);
    }
  });

  it('passes through short answers with no options', () => {
    expect(shuffleGeneratedOptions('short_answer', undefined)).toBeUndefined();
  });

  it('keeps the resolved answer findable after shuffling', () => {
    // Grading compares the stored answer text against the option the student
    // picked, so a letter answer must be resolved BEFORE the shuffle.
    for (let i = 0; i < 100; i++) {
      const resolved = normalizeQuizCorrectAnswer('A', OPTIONS);
      const shuffled = shuffleGeneratedOptions('multiple_choice', OPTIONS)!;
      expect(resolved).toBe('correct');
      expect(shuffled).toContain(resolved);
    }
  });
});
