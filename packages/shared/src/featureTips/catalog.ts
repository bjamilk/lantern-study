/**
 * Shared first-time / returning-user feature tip catalog.
 * Tip IDs are stable — bump FEATURE_TIPS_VERSION to re-prompt after major UX changes.
 */

/** Bumped when persistence policy changes (v2: Got it is session-only). */
export const FEATURE_TIPS_VERSION = 2;
export const FEATURE_TIPS_LOCAL_KEY = 'lantern_feature_tips_v2';
/** Session-scoped Got it dismissals (cleared when the browser/app session ends). */
export const FEATURE_TIPS_SESSION_KEY = 'lantern_feature_tips_session_v2';
export const LEGACY_GETTING_STARTED_KEY = 'lantern_getting_started_v1';

export type FeatureTipId =
  | 'nav.library'
  | 'library.tabs'
  | 'flashcards.deckModes'
  | 'flashcards.grading'
  | 'nav.companion'
  | 'nav.chat'
  | 'chat.question'
  | 'chat.test'
  | 'chat.study'
  | 'chat.summarize'
  | 'chat.aiGenerate'
  | 'nav.marketplace'
  | 'nav.budget'
  | 'nav.offline';

/** Display order — at most one coach tip shown at a time. */
export const FEATURE_TIP_SEQUENCE: FeatureTipId[] = [
  'nav.library',
  'library.tabs',
  'flashcards.deckModes',
  'flashcards.grading',
  'nav.companion',
  'nav.chat',
  'chat.question',
  'chat.test',
  'chat.study',
  'chat.summarize',
  'chat.aiGenerate',
  'nav.budget',
  'nav.marketplace',
  'nav.offline',
];

export interface FeatureTipCopy {
  id: FeatureTipId;
  title: string;
  body: string;
  /** Primary button label */
  gotItLabel?: string;
  /** Secondary: dismiss permanently until Replay */
  dontShowAgainLabel?: string;
}

export const FEATURE_TIP_CATALOG: Record<FeatureTipId, FeatureTipCopy> = {
  'nav.library': {
    id: 'nav.library',
    title: 'Your Library',
    body: 'Notes and flashcards live here. Open Library anytime to capture class material or review decks.',
  },
  'library.tabs': {
    id: 'library.tabs',
    title: 'Notes & Flashcards',
    body: 'Switch between Notes and Flashcards with these tabs. Due cards show a badge when it is time to review.',
  },
  'flashcards.deckModes': {
    id: 'flashcards.deckModes',
    title: 'How to study this deck',
    body: 'Tap Study for a smart review of cards you need most. Quiz yourself and Match are for practice — other modes live under More ways to study.',
  },
  'flashcards.grading': {
    id: 'flashcards.grading',
    title: 'Rate how you did',
    body: 'After you reveal the answer, pick Again if you missed it, Hard if you barely got it, Good if you knew it, or Easy if it felt too simple. That choice schedules the next review.',
  },
  'nav.companion': {
    id: 'nav.companion',
    title: 'Lantern AI',
    body: 'Tap the sparkles control anytime for study help, summaries, and tips without leaving your screen.',
  },
  'nav.chat': {
    id: 'nav.chat',
    title: 'Study groups',
    body: 'Open Chats to join a group, post questions, and study or test together with classmates.',
  },
  'chat.question': {
    id: 'chat.question',
    title: 'Submit a question',
    body: 'Use Question or + to post a multiple-choice, true/false, or other question for your group.',
  },
  'chat.test': {
    id: 'chat.test',
    title: 'Take a test',
    body: 'Start a practice test from questions already in this group chat — scored and timed if you want.',
  },
  'chat.study': {
    id: 'chat.study',
    title: 'Study mode',
    body: 'Practice the same group questions without a full timed-test feel. Great for review before exams.',
  },
  'chat.summarize': {
    id: 'chat.summarize',
    title: 'Summarize chat',
    body: 'Catch up on recent group discussion in one tap. Lantern will open with a short recap.',
  },
  'chat.aiGenerate': {
    id: 'chat.aiGenerate',
    title: 'AI generate questions',
    body: 'As a group admin, you can generate study questions from notes or a topic and post them to the chat.',
  },
  'nav.marketplace': {
    id: 'nav.marketplace',
    title: 'Campus marketplace',
    body: 'Explore listings from students nearby — textbooks, housing, and more. Sell from My Listings when you are ready.',
  },
  'nav.budget': {
    id: 'nav.budget',
    title: 'Budget tracker',
    body: 'Set a monthly budget and log spending so you can see where campus money goes.',
  },
  'nav.offline': {
    id: 'nav.offline',
    title: 'Offline study',
    body: 'Download decks and question bundles here so you can review without a connection. Changes sync when you are back online.',
  },
};

export type ChecklistItemKey =
  | 'createDeck'
  | 'openLibrary'
  | 'takeTest'
  | 'joinGroup'
  | 'tryCompanion'
  | 'submitQuestion'
  | 'setBudget'
  | 'exploreMarketplace'
  | 'tryOffline';

export interface ChecklistItemDef {
  key: ChecklistItemKey;
  label: string;
}

export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  { key: 'createDeck', label: 'Create a flashcard deck' },
  { key: 'openLibrary', label: 'Open Library (notes or flashcards)' },
  { key: 'joinGroup', label: 'Join or create a study group' },
  { key: 'submitQuestion', label: 'Submit a question in a group' },
  { key: 'takeTest', label: 'Take a practice test or study session' },
  { key: 'tryCompanion', label: 'Try Lantern AI companion' },
  { key: 'setBudget', label: 'Set your monthly budget' },
  { key: 'exploreMarketplace', label: 'Browse the campus marketplace' },
  { key: 'tryOffline', label: 'Visit Offline Mode' },
];
