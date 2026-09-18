/**
 * What the companion offers to do, decided from the page the student is on.
 *
 * WHY THIS FILE EXISTS (StudyFetch parity, wave 4). The panel has always drawn
 * the SAME seven generic pills — "What should I study today?", "How am I
 * spending this month?" — over every surface in the app. The reference product
 * changes its three suggestions per page: on a set home they are about the set,
 * on an open note they are about the note, and mid-quiz they are "Help me
 * reason" and "Hint me". A pill that is about what is on screen is the
 * difference between a shortcut and a decoration, and it is a pure function of
 * the room's state — so it lives here, React-free and unit-tested, the way
 * `companionScope.ts` next door holds the rest of the companion's rules.
 *
 * WHY NOT `packages/shared`. Two reasons, both about the entries rather than
 * the mapping:
 *  1. Every entry carries an `AppIconName` (`components/ui/appIconMap`) and a
 *     door expressed as a `CompanionActionType`, which the WEB executes through
 *     `AICompanionPanel`'s `onAction` → `useCompanionContext`. A shared module
 *     would have to invent a parallel icon vocabulary with no second consumer.
 *  2. The phone does not have this room: its companion is a full screen with
 *     its own route-scope table (`apps/mobile/src/components/companion/
 *     companionScope.ts`). Adding a new `@lantern/shared` subpath costs an
 *     `apps/api-server/tsconfig` `paths` entry and a mobile jest
 *     `moduleNameMapper` entry for a module neither of them imports — the trap
 *     the shared-imports note was written about.
 * The one thing that IS shared is the input: `StudySetPathActivity` comes from
 * `@lantern/shared` (`learning/studySetRoutes`), so a new room activity cannot
 * be added without this table being made total for it.
 *
 * THE COPY is the reference's, adapted to Lantern's names: "Lantern", not
 * "Sparky"; "study set", not "set"; "quiz", not "QuizFetch".
 *
 * ASK vs DOOR. Most pills are questions and go through `openWithMessage` /
 * `handleSend` so they produce a real answer. Three of them are not questions
 * at all in the reference — "Generate flashcards for this set" opens the
 * flashcard create door — and a pill that pretends to chat while navigating is
 * a lie about what pressing it does. Those carry `door` and say so in their
 * label ("Make flashcards →"), and they are dispatched through the companion's
 * EXISTING action path rather than a second navigation implementation.
 */
import type { FeatureKey } from '@lantern/shared/design';
import type { CompanionActionType, StudySetPathActivity } from '@lantern/shared';
import type { AppIconName } from '../ui/appIconMap';

/** A pill either asks a question or opens a door. Never both. */
export type CompanionSuggestionKind = 'ask' | 'door';

export interface CompanionSuggestion {
  /** Stable across states, so a render test can name one without its copy. */
  id: string;
  kind: CompanionSuggestionKind;
  /** What the pill says. For an `ask` this is also what it sends. */
  label: string;
  /**
   * What an `ask` sends, when that is longer than the pill can say. Absent
   * means the label IS the question, which is how the reference's pills read.
   */
  prompt?: string;
  /**
   * The action a `door` dispatches — one of the companion's existing action
   * types, so the door a pill opens is the door the model's own tool call
   * opens. Absent on an `ask`.
   */
  door?: CompanionActionType;
  /** The 16px glyph, drawn in `feature`'s ink. */
  icon: AppIconName;
  /** Whose ink the glyph takes: the intent the pill serves, not `ai` for all. */
  feature: FeatureKey;
}

/** What the pill actually sends, for an `ask`. */
export function companionSuggestionPrompt(suggestion: CompanionSuggestion): string {
  return suggestion.prompt ?? suggestion.label;
}

/**
 * Everything the choice depends on. All optional: a host that knows none of it
 * (the global drawer, which follows every screen) gets the generic list, which
 * is exactly what the panel drew before this file existed.
 */
export interface CompanionSuggestionState {
  /** The set-room activity the student is on, when they are in a set room. */
  activity?: StudySetPathActivity | null;
  /** A note or material is attached to the thread, or open beside it. */
  hasOpenNote?: boolean;
  /** A test or study session is running right now. */
  hasTestInProgress?: boolean;
  /** This set already has a study plan, so "create one" is not the offer. */
  hasPlan?: boolean;
}

const ask = (
  id: string,
  label: string,
  icon: AppIconName,
  feature: FeatureKey,
  prompt?: string
): CompanionSuggestion => ({ id, kind: 'ask', label, icon, feature, ...(prompt ? { prompt } : {}) });

const door = (
  id: string,
  label: string,
  icon: AppIconName,
  feature: FeatureKey,
  target: CompanionActionType
): CompanionSuggestion => ({ id, kind: 'door', label, icon, feature, door: target });

/**
 * The generic list — the app outside a set room, unchanged from
 * `QUICK_PROMPTS`. Kept here rather than imported so the seven states below are
 * one table a reviewer can read top to bottom; `companionScope.QUICK_PROMPTS`
 * stays the phone's twin and is asserted equal to this list in the tests.
 */
const GENERIC: readonly CompanionSuggestion[] = [
  ask('generic-today', 'What should I study today?', 'sunny', 'ai'),
  ask('generic-weak-cards', 'Generate flashcards for my weak topics', 'layers', 'flashcards'),
  ask('generic-weak-quiz', 'Quiz me on my weak topics', 'help-circle', 'tests'),
  ask('generic-tip', 'Give me a study tip', 'bulb', 'ai'),
  ask('generic-spaced', 'Explain spaced repetition', 'repeat', 'flashcards'),
  ask('generic-plan-week', 'Build my study plan for this week', 'calendar', 'sets'),
  ask('generic-budget', 'How am I spending this month?', 'wallet', 'budget'),
];

/** Set home. The reference's own three, then the rest behind "View more". */
function setHome(hasPlan: boolean): readonly CompanionSuggestion[] {
  return [
    ask('set-about', 'What is this study set about?', 'information-circle', 'sets'),
    hasPlan
      ? // A set that HAS a plan is not offered one again: the honest second
        // pill there is the one that reads the plan the student already has.
        ask('set-plan-explain', 'Explain my study plan', 'calendar', 'sets')
      : ask('set-plan-create', 'Create a study plan for me', 'calendar', 'sets'),
    door('set-cards', 'Generate flashcards for this set', 'layers', 'flashcards', 'open_create_flashcard'),
    ask('set-quiz', 'Quiz me on this study set', 'help-circle', 'tests'),
    ask('set-hard', 'What should I study first?', 'flash', 'ai'),
    ask('set-tip', 'Give me a study tip', 'bulb', 'ai'),
  ];
}

/** A material note open — read, notes, walkthrough, or an attached note. */
const NOTE: readonly CompanionSuggestion[] = [
  ask('note-difficult', 'Explain the difficult parts', 'bulb', 'notes'),
  door('note-cards', 'Generate flashcards from this', 'layers', 'flashcards', 'open_create_flashcard'),
  ask(
    'note-gaps',
    'Fill in the gaps',
    'git-branch',
    'notes',
    'What is missing from this note? Fill in the gaps you can see.'
  ),
  ask(
    'note-summary',
    'Add a summary at the top',
    'text',
    'notes',
    'Write a short summary of this note that I can put at the top of it.'
  ),
  ask('note-quiz', 'Quiz me on this note', 'help-circle', 'tests'),
];

/** A test or quiz in progress. The reference's three, verbatim in intent. */
const TEST: readonly CompanionSuggestion[] = [
  ask(
    'test-reason',
    'Help me reason',
    'git-network',
    'tests',
    'Help me reason through this question without telling me the answer.'
  ),
  ask('test-hint', 'Hint me', 'flash', 'tests', 'Give me one hint for this question — not the answer.'),
  door('test-cards', 'Make flashcards', 'layers', 'flashcards', 'open_create_flashcard'),
  ask('test-topic', 'What topic is this testing?', 'pricetag', 'sets'),
];

/** The arcade / Play page. */
const PLAY: readonly CompanionSuggestion[] = [
  ask(
    'play-recommend',
    'Recommend a game',
    'game-controller',
    'tests',
    'Which game should I play to revise this study set, and why?'
  ),
  ask(
    'play-match',
    'Match from cards',
    'layers',
    'flashcards',
    'Build a matching game from my flashcards in this study set.'
  ),
  ask('play-quiz', 'Quiz me instead', 'help-circle', 'tests'),
];

/** The calendar. */
const CALENDAR: readonly CompanionSuggestion[] = [
  ask('calendar-today', "Today's plan", 'sunny', 'sets', 'What is my plan for today?'),
  ask('calendar-week', 'What is due this week?', 'calendar', 'sets'),
  ask('calendar-exam', 'How should I prepare for my next exam?', 'school', 'tests'),
];

/** The plan timeline. */
const PLAN: readonly CompanionSuggestion[] = [
  ask('plan-explain', 'Explain my study plan', 'calendar', 'sets'),
  ask('plan-first', 'What should I do first?', 'flash', 'ai'),
  ask('plan-track', 'Am I on track?', 'trending-up', 'sets'),
  door('plan-cards', 'Make flashcards for the next topic', 'layers', 'flashcards', 'open_create_flashcard'),
];

/** Adding materials. */
const UPLOAD: readonly CompanionSuggestion[] = [
  ask('upload-what', 'What should I upload?', 'cloud-upload', 'notes'),
  ask('upload-after', 'What can Lantern make from my materials?', 'sparkles', 'ai'),
  ask('upload-no-file', 'I have no file — help me start anyway', 'bulb', 'ai'),
];

/**
 * The ordered list for a room state.
 *
 * ORDER OF THE CHECKS MATTERS and is the same order the student's attention is
 * in:
 *  1. A running test beats whatever pane it was started from — the question in
 *     front of them is the thing they need help with.
 *  2. The set HOME beats an attached note. This one is deliberate and it is the
 *     case that bites: the companion keeps the last note attached to the thread
 *     after the student presses Back, so without this a set home would silently
 *     keep offering "Fill in the gaps" about a note that is no longer on
 *     screen. The attachment is still visible — the composer's placeholder says
 *     which note it is — so nothing is hidden by preferring the page.
 *  3. An open note beats the room it lives in.
 *  4. Then the activity, and finally the generic list, so the global drawer
 *     that follows every screen is untouched by this file.
 */
export function companionSuggestionsFor(
  state: CompanionSuggestionState = {}
): readonly CompanionSuggestion[] {
  const { activity, hasOpenNote, hasTestInProgress, hasPlan } = state;
  if (hasTestInProgress || activity === 'quiz' || activity === 'test') return TEST;
  if (activity === 'home') return setHome(Boolean(hasPlan));
  if (hasOpenNote || activity === 'notes' || activity === 'read' || activity === 'walkthrough') {
    return NOTE;
  }
  switch (activity) {
    case 'play':
      return PLAY;
    case 'calendar':
      return CALENDAR;
    case 'plan':
      return PLAN;
    case 'add':
      return UPLOAD;
    default:
      return GENERIC;
  }
}

/**
 * How many pills show before "View more".
 *
 * THREE, not the four the generic list used, because the reference shows three
 * and because the docked rail is 400px: a fourth 34px pill wraps the row that
 * holds the greeting and the composer apart.
 */
export const COMPANION_SUGGESTION_PREVIEW_COUNT = 3;

/** The pills to draw, given whether "View more" has been pressed. */
export function visibleCompanionSuggestions(
  suggestions: readonly CompanionSuggestion[],
  expanded: boolean
): readonly CompanionSuggestion[] {
  return expanded ? suggestions : suggestions.slice(0, COMPANION_SUGGESTION_PREVIEW_COUNT);
}

/** Whether "View more" is drawn at all: only when it would reveal something. */
export function canExpandCompanionSuggestions(
  suggestions: readonly CompanionSuggestion[]
): boolean {
  return suggestions.length > COMPANION_SUGGESTION_PREVIEW_COUNT;
}
