/**
 * What the companion is currently "on", and which prompt chips that earns.
 *
 * The phone mounts ONE `AICompanionPanel` in `RootNavigator` with no `context`
 * prop, so — unlike the web rail, which is rendered inside the surface it
 * serves and reads its scope from props — the phone's only honest source of
 * scope is the store. Everything here is pure so the label and the chip set
 * can be tested without a renderer.
 */
import {
  studySetCompanionPrompts,
  type StudySetCompanionPrompt,
} from '@lantern/shared/learning/studySetChrome';
import type { StudySetPathActivity } from '@lantern/shared/learning/studySetRoutes';

export type { StudySetCompanionPrompt };

export interface CompanionScopeInput {
  /** The attached note, if one is attached. The narrowest, so it wins. */
  noteTitle?: string | null;
  /** The room the student is in — a study set or course name. */
  scopeName?: string | null;
  /** The screen, as a human phrase ("Flashcards"), never a route key. */
  screenName?: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * What the web rail's subtitle says when nothing is scoped. Kept identical so
 * the two surfaces read as one product (web `AICompanionPanel.tsx`).
 */
export const COMPANION_SUBTITLE_FALLBACK = 'Your AI study companion';

/**
 * The line under the header: `On: Cell respiration`.
 *
 * Narrowest-wins, because that is what the next question is actually grounded
 * in: an attached note beats the set it lives in, and the set beats the screen.
 * Returns null when nothing is scoped — an "On: everything" line would be a
 * promise the grounding does not keep — and the panel falls back to
 * `COMPANION_SUBTITLE_FALLBACK`, which is what web does with the same absence.
 */
export function scopeLabel(scope: CompanionScopeInput): string | null {
  const subject = clean(scope.noteTitle) ?? clean(scope.scopeName) ?? clean(scope.screenName);
  return subject ? `On: ${subject}` : null;
}

/** The subtitle actually drawn: the scope line, or web's fallback sentence. */
export function scopeSubtitle(scope: CompanionScopeInput): string {
  return scopeLabel(scope) ?? COMPANION_SUBTITLE_FALLBACK;
}

/** The accessibility phrasing for the same line — "On:" alone reads as a colon. */
export function scopeAccessibilityLabel(scope: CompanionScopeInput): string | null {
  const subject = clean(scope.noteTitle) ?? clean(scope.scopeName) ?? clean(scope.screenName);
  return subject ? `Answering about ${subject}` : null;
}

/**
 * The screen-scoped chips, from the SAME shared table the web rail reads.
 *
 * Only the prompts that ASK are usable here: a `go` chip navigates the web
 * rail's surrounding router to a study-set path, and the phone's companion is
 * a modal over a different navigator with no set id in scope — wiring one
 * would send the student to a set the panel cannot know. Dropping them keeps
 * every chip drawn honest about what tapping it does.
 */
export function scopedPrompts(
  activity: StudySetPathActivity | null | undefined
): readonly StudySetCompanionPrompt[] {
  if (!activity) return [];
  return studySetCompanionPrompts(activity).filter((p) => typeof p.ask === 'string' && !!p.ask.trim());
}

/**
 * Route name -> what to SAY the companion is on, and which prompt table that
 * screen earns.
 *
 * The web rail gets this from `App.tsx`'s `appMode` switch because the rail is
 * rendered inside the surface it serves. The phone's panel is a modal mounted
 * once at the root, so the equivalent truth is the route that was on screen
 * when it opened. Anything not listed is deliberately absent rather than
 * guessed: a wrong "On:" line is worse than none, because it tells the student
 * the answer is grounded in something it is not.
 */
const ROUTE_SCOPES: Record<string, { screen: string; activity: StudySetPathActivity | null }> = {
  CourseRoom: { screen: 'Study set', activity: 'home' },
  NotesStudio: { screen: 'Notes studio', activity: 'notes' },
  NoteEditor: { screen: 'Note', activity: 'notes' },
  Walkthrough: { screen: 'Walk-through', activity: 'walkthrough' },
  Narration: { screen: 'Narration', activity: 'read' },
  DeckDetail: { screen: 'Flashcard deck', activity: 'cards' },
  FlashcardReview: { screen: 'Flashcards', activity: 'cards' },
  CramSession: { screen: 'Cram session', activity: 'cards' },
  LearnStudy: { screen: 'Learn session', activity: 'cards' },
  MatchStudy: { screen: 'Match game', activity: 'play' },
  PlayStudio: { screen: 'Study game', activity: 'play' },
  AdaptiveQuiz: { screen: 'Quiz', activity: 'quiz' },
  TestTaking: { screen: 'Test', activity: 'test' },
  TestResults: { screen: 'Test results', activity: 'test' },
  TestAnalysis: { screen: 'Test analysis', activity: 'test' },
  LectureStudio: { screen: 'Lecture studio', activity: 'lecture' },
  LessonStudio: { screen: 'Tutor lesson', activity: 'lesson' },
  RecapStudio: { screen: 'Recap', activity: 'recap' },
  EssayStudio: { screen: 'Essay', activity: 'essay' },
  StudyCalendar: { screen: 'Study calendar', activity: 'calendar' },
  // Libraries and builders are places you PICK from, not things to be "on".
  StudyHub: { screen: 'Study hub', activity: null },
  NotesList: { screen: 'Notes library', activity: null },
  Library: { screen: 'Library', activity: null },
  FlashcardsList: { screen: 'Flashcards', activity: null },
  TestsList: { screen: 'Tests', activity: null },
  TestBuilder: { screen: 'Test builder', activity: null },
};

export interface CompanionRouteScope {
  screenName: string | null;
  scopeName: string | null;
  activity: StudySetPathActivity | null;
  /**
   * The id of the room this route belongs to — what the companion's thread is
   * keyed on. Without it the panel had no way to tell "a different set" from
   * "the same set", so the persisted conversation id followed the student into
   * every other set they opened Ask from.
   */
  scopeId: string | null;
}

/** Route params that identify a room, narrowest first. */
const SCOPE_ID_PARAMS = ['studySetId', 'courseId', 'noteId', 'deckId', 'testId'] as const;

/**
 * The scope of one route. `scopeName` prefers the NAME the route already
 * carries in its params — a course label or a deck name — because "On:
 * Biology 101" is a better answer than "On: Study set".
 */
export function companionScopeFromRoute(
  routeName: string | null | undefined,
  params?: Record<string, unknown> | null
): CompanionRouteScope {
  const entry = routeName ? ROUTE_SCOPES[routeName] : undefined;
  const named =
    clean(typeof params?.courseLabel === 'string' ? params.courseLabel : null) ??
    clean(typeof params?.deckName === 'string' ? params.deckName : null);
  let scopeId: string | null = null;
  for (const key of SCOPE_ID_PARAMS) {
    const value = params?.[key];
    if (typeof value === 'string' && value.trim()) {
      scopeId = value.trim();
      break;
    }
  }
  return {
    screenName: entry ? entry.screen : null,
    scopeName: entry ? named : null,
    activity: entry ? entry.activity : null,
    // The id is read whether or not the route is in the scope table: a screen
    // with no honest "On:" line still belongs to a room, and the thread must
    // still be keyed to it.
    scopeId,
  };
}

export interface CompanionConversationLike {
  id: string;
  title?: string | null;
  noteTitle?: string | null;
  preview?: string | null;
}

/** Past-chats search: title, the note it is attached to, and its preview. */
export function filterConversations<T extends CompanionConversationLike>(
  conversations: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...conversations];
  return conversations.filter((c) =>
    [c.title, c.noteTitle, c.preview].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(q)
    )
  );
}

/**
 * What "I don't understand" sends. One fixed re-ask, so the thread's context
 * (the same conversation id, the same attachment) does the narrowing rather
 * than the student having to restate the question.
 */
export const EXPLAIN_SIMPLY_PROMPT = 'Explain that more simply.';

/**
 * The generic pills. Same seven as the web rail, in the same order — mobile
 * was two short (`Build my study plan…` and `How am I spending this month?`),
 * which is why the phone's empty state offered no way into the planner or the
 * budget the way the rail does.
 */
export const QUICK_PROMPTS: readonly string[] = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
  'Build my study plan for this week',
  'How am I spending this month?',
];

/**
 * How many generic pills a phone shows before "View more".
 *
 * The rail can afford all seven side by side; a 360 dp column turns them into
 * a seven-line wall above the composer, which buries the scoped chips that are
 * the better answer. Four is the most that fits without the wall.
 */
export const QUICK_PROMPT_PREVIEW_COUNT = 4;

/** The pills to draw, given whether "View more" has been tapped. */
export function visibleQuickPrompts(expanded: boolean): readonly string[] {
  return expanded ? QUICK_PROMPTS : QUICK_PROMPTS.slice(0, QUICK_PROMPT_PREVIEW_COUNT);
}

export interface CompanionMessageLike {
  id: string;
  role: string;
  content: string;
}

/**
 * The question an assistant answer was answering — what "Regenerate" re-asks.
 *
 * Walks BACK from the assistant message rather than taking the last user turn
 * in the thread, so regenerating an answer from the middle of a long scroll
 * re-asks the question above IT, not whatever was typed most recently.
 */
export function previousUserMessage(
  messages: readonly CompanionMessageLike[],
  assistantMessageId: string
): string | null {
  const index = messages.findIndex((m) => m.id === assistantMessageId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return clean(messages[i].content);
  }
  return null;
}
