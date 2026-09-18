/**
 * The companion's suggestions, per room state.
 *
 * WHAT THIS FILE IS FOR. The failure it guards is not a crash: it is a pill
 * that says "How am I spending this month?" over a half-finished quiz, which is
 * what the panel drew on every surface before wave 4. So the assertions are on
 * the COPY and the ORDER a student would read, one state at a time, plus the
 * two rules that are easy to regress silently — three before "View more", and
 * a door pill never pretending to be a question.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANION_SUGGESTION_PREVIEW_COUNT,
  canExpandCompanionSuggestions,
  companionSuggestionPrompt,
  companionSuggestionsFor,
  visibleCompanionSuggestions,
  type CompanionSuggestion,
  type CompanionSuggestionState,
} from './companionSuggestions';
import { QUICK_PROMPTS } from './companionScope';

const labels = (state: CompanionSuggestionState) =>
  companionSuggestionsFor(state).map((s) => s.label);

const firstThree = (state: CompanionSuggestionState) =>
  visibleCompanionSuggestions(companionSuggestionsFor(state), false).map((s) => s.label);

describe('the three pills a student actually sees, per page', () => {
  it('is the reference set-home trio on a set home with no plan yet', () => {
    expect(firstThree({ activity: 'home' })).toEqual([
      'What is this study set about?',
      'Create a study plan for me',
      'Generate flashcards for this set',
    ]);
  });

  it('offers to READ the plan rather than make a second one when a set has one', () => {
    expect(firstThree({ activity: 'home', hasPlan: true })).toEqual([
      'What is this study set about?',
      'Explain my study plan',
      'Generate flashcards for this set',
    ]);
  });

  it('is the reference note trio on an open material note', () => {
    expect(firstThree({ activity: 'notes' })).toEqual([
      'Explain the difficult parts',
      'Generate flashcards from this',
      'Fill in the gaps',
    ]);
    // "Add a summary at the top" is the reference's fourth, so it is behind
    // "View more" rather than dropped.
    expect(labels({ activity: 'notes' })).toContain('Add a summary at the top');
  });

  it('is the reference test trio while a test or quiz is being taken', () => {
    expect(firstThree({ activity: 'quiz' })).toEqual(['Help me reason', 'Hint me', 'Make flashcards']);
    expect(firstThree({ activity: 'test' })).toEqual(['Help me reason', 'Hint me', 'Make flashcards']);
  });

  it('is the reference arcade pair on the play page', () => {
    expect(firstThree({ activity: 'play' }).slice(0, 2)).toEqual([
      'Recommend a game',
      'Match from cards',
    ]);
  });

  it("leads the calendar with today's plan", () => {
    expect(firstThree({ activity: 'calendar' })[0]).toBe("Today's plan");
  });

  it('falls back to the generic list off the set room, unchanged', () => {
    // The seven the panel has always drawn, still in the phone's order: this is
    // the assertion that keeps `companionScope.QUICK_PROMPTS` and this table
    // from drifting apart in the app outside a set room.
    expect(labels({})).toEqual([...QUICK_PROMPTS]);
    expect(labels({ activity: null })).toEqual([...QUICK_PROMPTS]);
  });
});

describe('what wins when two things are true at once', () => {
  it('lets a running test beat the pane it was started from', () => {
    expect(firstThree({ activity: 'home', hasTestInProgress: true })[0]).toBe('Help me reason');
    expect(firstThree({ activity: 'play', hasTestInProgress: true })[0]).toBe('Help me reason');
  });

  it('lets an attached note beat the room it lives in', () => {
    // A studio pane with a note attached: the note IS the page.
    expect(firstThree({ activity: 'lesson', hasOpenNote: true })[0]).toBe(
      'Explain the difficult parts'
    );
  });

  it('keeps the set home about the set even with a note still attached', () => {
    // The companion keeps the last note attached after Back, so this is the
    // case that would otherwise leave "Fill in the gaps" on a page with no
    // note on it.
    expect(firstThree({ activity: 'home', hasOpenNote: true })[0]).toBe(
      'What is this study set about?'
    );
  });

  it('still puts the test first when a note is attached to the thread', () => {
    // Mid-question, the note is context; the question is the thing on screen.
    expect(firstThree({ activity: 'notes', hasOpenNote: true, hasTestInProgress: true })[0]).toBe(
      'Help me reason'
    );
    expect(firstThree({ activity: 'home', hasTestInProgress: true })[0]).toBe('Help me reason');
  });
});

describe('three, then more', () => {
  const states: CompanionSuggestionState[] = [
    { activity: 'home' },
    { activity: 'notes' },
    { activity: 'quiz' },
    { activity: 'plan' },
    { activity: 'calendar' },
    { activity: 'add' },
    {},
  ];

  it('shows exactly three until View more is pressed', () => {
    expect(COMPANION_SUGGESTION_PREVIEW_COUNT).toBe(3);
    for (const state of states) {
      const all = companionSuggestionsFor(state);
      expect(visibleCompanionSuggestions(all, false)).toHaveLength(3);
      expect(visibleCompanionSuggestions(all, true)).toEqual(all);
    }
  });

  it('never draws View more where it would reveal nothing', () => {
    // The play page has three: pressing "View more" there would collapse the
    // row onto itself and show the same three back.
    expect(companionSuggestionsFor({ activity: 'play' })).toHaveLength(3);
    expect(canExpandCompanionSuggestions(companionSuggestionsFor({ activity: 'play' }))).toBe(false);
    expect(canExpandCompanionSuggestions(companionSuggestionsFor({ activity: 'home' }))).toBe(true);
  });

  it('shows the full list when there are fewer than three to show', () => {
    expect(visibleCompanionSuggestions([], false)).toEqual([]);
  });
});

describe('every entry is well formed', () => {
  const everySuggestion: CompanionSuggestion[] = ([
    { activity: 'home' },
    { activity: 'home', hasPlan: true },
    { activity: 'notes' },
    { activity: 'quiz' },
    { activity: 'play' },
    { activity: 'calendar' },
    { activity: 'plan' },
    { activity: 'add' },
    {},
  ] as CompanionSuggestionState[]).flatMap((state) => [...companionSuggestionsFor(state)]);

  it('gives an ask something to send and a door somewhere to go — never both', () => {
    for (const suggestion of everySuggestion) {
      if (suggestion.kind === 'door') {
        expect(suggestion.door).toBeTruthy();
        expect(suggestion.prompt).toBeUndefined();
      } else {
        expect(suggestion.door).toBeUndefined();
        expect(companionSuggestionPrompt(suggestion).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('opens only doors the companion already knows how to open', () => {
    // A door type the action executor does not handle falls out of its switch
    // silently and the student sees nothing happen — the gotcha
    // `hooks/useCompanionContext.ts` is headed with.
    const handled = new Set(['open_create_flashcard', 'open_test_config', 'navigate_to_flashcards']);
    for (const suggestion of everySuggestion) {
      if (suggestion.kind === 'door') expect(handled.has(suggestion.door!)).toBe(true);
    }
  });

  it('keeps ids unique inside a state, so React keys and analytics are stable', () => {
    for (const state of [
      { activity: 'home' as const },
      { activity: 'notes' as const },
      { activity: 'quiz' as const },
      {},
    ]) {
      const ids = companionSuggestionsFor(state).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('says "Lantern" and never the reference product or its mascot', () => {
    for (const suggestion of everySuggestion) {
      const text = `${suggestion.label} ${suggestion.prompt ?? ''}`;
      expect(text).not.toMatch(/sparky|studyfetch|quizfetch/i);
    }
  });
});
