/**
 * The gate model (studioGate.ts).
 *
 * The regression this file guards is not a crash — it is a studio that renders
 * a blocker with nothing to tap, which is exactly what shipped on build 203
 * (SF2 evidence §4.2). So the load-bearing assertion is the boring one: EVERY
 * studio, for every reason it can hit, returns at least one action, and
 * exactly one of them is the primary.
 */
import {
  studioGate,
  studioGateCostLine,
  type StudioGateReason,
  type StudioGateStudio,
} from './studioGateModel';

const STUDIOS: StudioGateStudio[] = ['quiz', 'notes', 'lesson', 'recap', 'play'];
const REASONS: StudioGateReason[] = ['no_material', 'no_open_note', 'no_deck'];

describe('studioGate', () => {
  it('never returns a gate with nothing to tap', () => {
    for (const studio of STUDIOS) {
      for (const reason of REASONS) {
        const gate = studioGate({ studio, reason });
        expect(gate.actions.length).toBeGreaterThan(0);
        expect(gate.actions.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives every gate exactly one primary action', () => {
    for (const studio of STUDIOS) {
      for (const reason of REASONS) {
        const primaries = studioGate({ studio, reason }).actions.filter(
          (a) => a.variant === 'primary'
        );
        expect(primaries).toHaveLength(1);
      }
    }
  });

  it('names a title and a one-sentence body for every studio', () => {
    for (const studio of STUDIOS) {
      const gate = studioGate({ studio, reason: 'no_material' });
      expect(gate.title.length).toBeGreaterThan(0);
      // Not an empty state's absence ("No decks"), and not a paragraph.
      expect(gate.title.startsWith('No ')).toBe(false);
      expect(gate.body.length).toBeGreaterThan(0);
      expect(gate.body.length).toBeLessThanOrEqual(120);
    }
  });

  it('keeps the quiz blocker the student was already shown', () => {
    const gate = studioGate({ studio: 'quiz', reason: 'no_material' });
    expect(gate.body).toContain('Import or create a note first.');
    expect(gate.actions.map((a) => a.id)).toEqual(['import_materials', 'create_note']);
  });

  it('resolves the blocker the copy names, rather than leaving the studio', () => {
    // A gate that says "import or create a note" must offer importing and
    // creating — not "Go to Library", which is where the student just was.
    const quiz = studioGate({ studio: 'quiz', reason: 'no_material' });
    expect(quiz.actions.map((a) => a.id)).toContain('import_materials');
    expect(quiz.actions.map((a) => a.id)).toContain('create_note');

    // Play's primary is NOT "create a deck": mobile has no deck-maker, so a
    // button saying so would be the same dead end in a nicer card.
    const play = studioGate({ studio: 'play', reason: 'no_deck' });
    expect(play.actions[0]?.id).toBe('open_materials');
    expect(play.actions.map((a) => a.id)).not.toContain('create_deck');

    const notes = studioGate({ studio: 'notes', reason: 'no_open_note' });
    expect(notes.actions[0]?.id).toBe('open_materials');
  });

  it('prices the next step only when it costs something', () => {
    expect(studioGate({ studio: 'quiz', reason: 'no_material' }).costLine).toBeUndefined();
    expect(studioGate({ studio: 'quiz', reason: 'no_material', cost: '1 AI use' }).costLine).toBe(
      'Writing new questions uses 1 AI use.'
    );
  });

  it('lets a studio name what its own credits buy', () => {
    expect(
      studioGate({
        studio: 'recap',
        reason: 'no_material',
        cost: '1 AI use',
        costVerb: 'Writing a recap',
      }).costLine
    ).toBe('Writing a recap uses 1 AI use.');
  });

  it('prefers the caller’s scope-aware sentence over the generic one', () => {
    const gate = studioGate({
      studio: 'play',
      reason: 'no_deck',
      body: 'File a deck in this set first.',
    });
    expect(gate.body).toBe('File a deck in this set first.');
    // …and a blank override does not blank the gate.
    expect(studioGate({ studio: 'play', reason: 'no_deck', body: '   ' }).body).toBe(
      studioGate({ studio: 'play', reason: 'no_deck' }).body
    );
  });

  it('is pure', () => {
    const a = studioGate({ studio: 'lesson', reason: 'no_material' });
    const b = studioGate({ studio: 'lesson', reason: 'no_material' });
    expect(a).toEqual(b);
  });
});

describe('studioGateCostLine', () => {
  it('states the price in one shape', () => {
    expect(studioGateCostLine('Writing new questions', '1 AI use')).toBe(
      'Writing new questions uses 1 AI use.'
    );
  });
});
