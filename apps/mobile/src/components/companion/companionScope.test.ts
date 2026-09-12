/**
 * The companion's scope line, its chip sets, and the history filter.
 *
 * These are the parts the phone got wrong by having no pure layer at all: the
 * panel is mounted once in `RootNavigator` with no `context` prop, so every
 * one of these decisions used to be impossible to check without a renderer.
 */
import {
  COMPANION_SUBTITLE_FALLBACK,
  companionScopeFromRoute,
  EXPLAIN_SIMPLY_PROMPT,
  QUICK_PROMPTS,
  QUICK_PROMPT_PREVIEW_COUNT,
  filterConversations,
  previousUserMessage,
  scopeAccessibilityLabel,
  scopeLabel,
  scopeSubtitle,
  scopedPrompts,
  visibleQuickPrompts,
} from './companionScope';

describe('scopeLabel', () => {
  it('names the attached note ahead of the room and the screen', () => {
    expect(
      scopeLabel({ noteTitle: 'Cell respiration', scopeName: 'Biology 101', screenName: 'Flashcards' })
    ).toBe('On: Cell respiration');
  });

  it('falls back to the room, then the screen', () => {
    expect(scopeLabel({ scopeName: 'Biology 101', screenName: 'Flashcards' })).toBe('On: Biology 101');
    expect(scopeLabel({ screenName: 'Flashcards' })).toBe('On: Flashcards');
  });

  it('treats blank and whitespace-only titles as absent', () => {
    expect(scopeLabel({ noteTitle: '   ', scopeName: 'Biology 101' })).toBe('On: Biology 101');
    expect(scopeLabel({ noteTitle: '', scopeName: null, screenName: undefined })).toBeNull();
  });

  it('says nothing rather than claiming a scope it does not have', () => {
    expect(scopeLabel({})).toBeNull();
    expect(scopeSubtitle({})).toBe(COMPANION_SUBTITLE_FALLBACK);
  });

  it('reads the scope as a sentence for screen readers', () => {
    expect(scopeAccessibilityLabel({ noteTitle: 'Cell respiration' })).toBe(
      'Answering about Cell respiration'
    );
    expect(scopeAccessibilityLabel({})).toBeNull();
  });
});

describe('scopedPrompts', () => {
  it('draws nothing when no activity is in scope', () => {
    expect(scopedPrompts(null)).toEqual([]);
    expect(scopedPrompts(undefined)).toEqual([]);
  });

  it('re-scopes per activity, from the shared table web reads', () => {
    expect(scopedPrompts('notes').map((p) => p.label)).toEqual([
      'Explain hard parts',
      'Fill gaps',
      'Add a summary',
    ]);
    expect(scopedPrompts('cards').map((p) => p.label)).toEqual(['Explain this card']);
    expect(scopedPrompts('quiz').map((p) => p.label)).toEqual(['Why is this right?']);
    expect(scopedPrompts('home').map((p) => p.label)).toEqual(['What next?']);
  });

  it('keeps only chips the phone can actually honour', () => {
    // A `go` chip navigates a study-set path the modal has no id for; drawing
    // one would be a button that lands somewhere else than it says.
    for (const activity of ['notes', 'cards', 'quiz', 'test', 'home', 'plan'] as const) {
      for (const prompt of scopedPrompts(activity)) {
        expect(typeof prompt.ask).toBe('string');
        expect(prompt.ask?.trim()).toBeTruthy();
        expect(prompt.go).toBeUndefined();
      }
    }
  });

  it('gives every surviving chip a glyph in the ai ink', () => {
    for (const prompt of scopedPrompts('notes')) {
      expect(prompt.icon).toBe('sparkles');
      expect(prompt.feature).toBe('ai');
    }
  });

  it('falls back for an activity with no table of its own', () => {
    expect(scopedPrompts('plan').map((p) => p.label)).toEqual(['Guide me']);
  });
});

describe('quick prompts', () => {
  it('matches the web rail, seven of them', () => {
    expect(QUICK_PROMPTS).toHaveLength(7);
    expect(QUICK_PROMPTS).toContain('Build my study plan for this week');
    expect(QUICK_PROMPTS).toContain('How am I spending this month?');
  });

  it('shows a readable few until View more is tapped', () => {
    expect(visibleQuickPrompts(false)).toHaveLength(QUICK_PROMPT_PREVIEW_COUNT);
    expect(visibleQuickPrompts(true)).toHaveLength(QUICK_PROMPTS.length);
    // The preview is a prefix, so "View more" only ever adds.
    expect(visibleQuickPrompts(true).slice(0, QUICK_PROMPT_PREVIEW_COUNT)).toEqual(
      visibleQuickPrompts(false)
    );
  });
});

describe('companionScopeFromRoute', () => {
  it('maps a studio route to its screen phrase and prompt table', () => {
    expect(companionScopeFromRoute('NotesStudio')).toEqual({
      screenName: 'Notes studio',
      scopeName: null,
      activity: 'notes',
      scopeId: null,
    });
    expect(companionScopeFromRoute('AdaptiveQuiz').activity).toBe('quiz');
    expect(companionScopeFromRoute('DeckDetail').activity).toBe('cards');
  });

  it('prefers the name the route already carries', () => {
    expect(companionScopeFromRoute('CourseRoom', { courseLabel: 'Biology 101' })).toEqual({
      screenName: 'Study set',
      scopeName: 'Biology 101',
      activity: 'home',
      scopeId: null,
    });
    expect(companionScopeFromRoute('DeckDetail', { deckName: 'Organelles' }).scopeName).toBe(
      'Organelles'
    );
  });

  it('gives libraries a name but no prompt table', () => {
    expect(companionScopeFromRoute('FlashcardsList')).toEqual({
      screenName: 'Flashcards',
      scopeName: null,
      activity: null,
      scopeId: null,
    });
  });

  it('says nothing for a route it does not know', () => {
    expect(companionScopeFromRoute('SomeChatScreen', { courseLabel: 'Biology 101' })).toEqual({
      screenName: null,
      scopeName: null,
      activity: null,
      scopeId: null,
    });
    expect(companionScopeFromRoute(null)).toEqual({
      screenName: null,
      scopeName: null,
      activity: null,
      scopeId: null,
    });
  });

  it('ignores non-string and blank param names', () => {
    expect(companionScopeFromRoute('CourseRoom', { courseLabel: 42 }).scopeName).toBeNull();
    expect(companionScopeFromRoute('CourseRoom', { courseLabel: '  ' }).scopeName).toBeNull();
  });
});

describe('filterConversations', () => {
  const rows = [
    { id: 'a', title: 'Mitosis revision', noteTitle: 'Cell cycle', preview: 'Explain anaphase' },
    { id: 'b', title: 'Budget chat', noteTitle: null, preview: 'How am I spending' },
    { id: 'c', title: 'Untitled', noteTitle: 'Photosynthesis', preview: null },
  ];

  it('returns everything for a blank query', () => {
    expect(filterConversations(rows, '   ').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches title, attached note and preview, case-insensitively', () => {
    expect(filterConversations(rows, 'MITOSIS').map((r) => r.id)).toEqual(['a']);
    expect(filterConversations(rows, 'photosynth').map((r) => r.id)).toEqual(['c']);
    expect(filterConversations(rows, 'spending').map((r) => r.id)).toEqual(['b']);
  });

  it('survives null fields and returns a copy', () => {
    const all = filterConversations(rows, '');
    expect(all).not.toBe(rows);
    expect(filterConversations(rows, 'zzz')).toEqual([]);
  });
});

describe('previousUserMessage', () => {
  const thread = [
    { id: 'u1', role: 'user', content: 'What is mitosis?' },
    { id: 'a1', role: 'assistant', content: 'It is cell division.' },
    { id: 'u2', role: 'user', content: 'And meiosis?' },
    { id: 'a2', role: 'assistant', content: 'Gamete formation.' },
  ];

  it('finds the question above THIS answer, not the newest one', () => {
    expect(previousUserMessage(thread, 'a1')).toBe('What is mitosis?');
    expect(previousUserMessage(thread, 'a2')).toBe('And meiosis?');
  });

  it('returns null when there is nothing to re-ask', () => {
    expect(previousUserMessage(thread, 'missing')).toBeNull();
    expect(previousUserMessage([{ id: 'a0', role: 'assistant', content: 'Hi' }], 'a0')).toBeNull();
    expect(
      previousUserMessage(
        [
          { id: 'u1', role: 'user', content: '   ' },
          { id: 'a1', role: 'assistant', content: 'x' },
        ],
        'a1'
      )
    ).toBeNull();
  });
});

describe('EXPLAIN_SIMPLY_PROMPT', () => {
  it('is a re-ask, so the thread supplies the context', () => {
    expect(EXPLAIN_SIMPLY_PROMPT).toBe('Explain that more simply.');
  });
});

describe('companionScopeFromRoute — scope id', () => {
  it('reads the room id the route carries, narrowest first', () => {
    expect(
      companionScopeFromRoute('CourseRoom', { studySetId: 'set-b', courseId: 'course-a' }).scopeId
    ).toBe('set-b');
    expect(companionScopeFromRoute('CourseRoom', { courseId: 'course-a' }).scopeId).toBe('course-a');
    expect(companionScopeFromRoute('NoteEditor', { noteId: 'note-9' }).scopeId).toBe('note-9');
  });

  it('reads the id even for a route with no honest "On:" line', () => {
    // The screen earns no scope phrase, but the thread still belongs to a room.
    expect(companionScopeFromRoute('SomeChatScreen', { studySetId: 'set-b' }).scopeId).toBe('set-b');
  });

  it('is null when the route names no room', () => {
    expect(companionScopeFromRoute('StudyHub').scopeId).toBeNull();
    expect(companionScopeFromRoute('CourseRoom', { studySetId: '   ' }).scopeId).toBeNull();
  });
});
