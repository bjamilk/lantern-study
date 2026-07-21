import {
  assessCompanionMessageClarity,
  buildCompanionClarifyReply,
} from './companionMessageClarity';

describe('assessCompanionMessageClarity', () => {
  it('rejects a single accidental letter', () => {
    expect(assessCompanionMessageClarity('t')).toEqual({ ok: false, reason: 'too_short' });
    expect(assessCompanionMessageClarity('T')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('rejects short gibberish', () => {
    expect(assessCompanionMessageClarity('asd').ok).toBe(false);
    expect(assessCompanionMessageClarity('xxxxx').ok).toBe(false);
    expect(assessCompanionMessageClarity('!!!').ok).toBe(false);
  });

  it('allows real questions and greetings', () => {
    expect(assessCompanionMessageClarity('What should I study today?').ok).toBe(true);
    expect(assessCompanionMessageClarity('hi').ok).toBe(true);
    expect(assessCompanionMessageClarity('help').ok).toBe(true);
    expect(assessCompanionMessageClarity('quiz').ok).toBe(true);
  });

  it('allows short continuations when history exists', () => {
    const history = [{ role: 'assistant', content: 'Want flashcards or a quiz?' }];
    expect(assessCompanionMessageClarity('yes', history).ok).toBe(true);
    expect(assessCompanionMessageClarity('2', history).ok).toBe(true);
    expect(assessCompanionMessageClarity('ok', history).ok).toBe(true);
  });

  it('rejects bare yes/no with no conversation', () => {
    expect(assessCompanionMessageClarity('yes').ok).toBe(false);
    expect(assessCompanionMessageClarity('2').ok).toBe(false);
  });
});

describe('buildCompanionClarifyReply', () => {
  it('offers grounded options from context without inventing topics', () => {
    const reply = buildCompanionClarifyReply({
      userName: 'Ada',
      dueCardsCount: 4,
      weakTopics: ['Photosynthesis'],
    });
    expect(reply).toContain('Ada');
    expect(reply).toContain('4 due flashcards');
    expect(reply).toContain('Photosynthesis');
    expect(reply.toLowerCase()).not.toContain('quantum');
  });

  it('falls back to a generic ask when context is empty', () => {
    const reply = buildCompanionClarifyReply({});
    expect(reply.toLowerCase()).toContain("didn't catch");
    expect(reply.toLowerCase()).toMatch(/flashcards|quiz|notes|plan/);
  });
});
