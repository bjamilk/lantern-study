import type { FeatureKey } from '../design';
import type { WorkspaceActivityId, WorkspaceIconName } from './courseWorkspace';

/**
 * StudyFetch's study-set home: a named set with a tool grid. Every activity
 * the student starts from here stays filed in that set.
 */
export type StudySetHomeToolId =
  | 'import'
  | 'quiz'
  | 'cards'
  | 'ask'
  | 'lesson'
  | 'recap'
  | 'lecture'
  | 'play'
  | 'notes'
  | 'walkthrough'
  | 'test'
  | 'plan'
  | 'essay';

export interface StudySetHomeTool {
  id: StudySetHomeToolId;
  label: string;
  promise: string;
  icon: WorkspaceIconName;
  feature: FeatureKey;
  /** Studio to open. `null` is import or the companion. */
  activity: WorkspaceActivityId | null;
}

export const STUDY_SET_HOME_TOOLS: readonly StudySetHomeTool[] = [
  {
    id: 'import',
    label: 'Add materials',
    promise: 'PDF, slides or pasted notes stay in this set',
    icon: 'cloud-upload',
    feature: 'notes',
    activity: null,
  },
  {
    id: 'quiz',
    label: 'Take a quiz',
    promise: 'Adaptive quiz from this set',
    icon: 'help-circle',
    feature: 'tests',
    activity: 'quiz',
  },
  {
    id: 'cards',
    label: 'Create flashcards',
    promise: 'Decks filed in this set',
    icon: 'layers',
    feature: 'flashcards',
    activity: 'cards',
  },
  {
    id: 'ask',
    label: 'Ask Lantern',
    promise: 'Chat about this set',
    icon: 'sparkles',
    feature: 'ai',
    activity: null,
  },
  {
    id: 'lesson',
    label: 'Start a tutoring session',
    promise: 'A structured lesson from your notes',
    icon: 'school',
    feature: 'ai',
    activity: 'lesson',
  },
  {
    id: 'recap',
    label: 'Start listening',
    promise: 'A generated listen-through',
    icon: 'headphones',
    feature: 'ai',
    activity: 'recap',
  },
  {
    id: 'lecture',
    label: 'Start recording',
    promise: 'Live transcript and notes',
    icon: 'mic',
    feature: 'recording',
    activity: 'lecture',
  },
  {
    id: 'play',
    label: 'Launch arcade',
    promise: 'Match and speed games from this set',
    icon: 'game-controller',
    feature: 'flashcards',
    activity: 'play',
  },
  {
    id: 'notes',
    label: 'Notes',
    promise: 'Read and edit notes in this set',
    icon: 'document-text',
    feature: 'notes',
    activity: 'notes',
  },
  {
    id: 'walkthrough',
    label: 'Walkthrough',
    promise: 'One page at a time',
    icon: 'book',
    feature: 'notes',
    activity: 'walkthrough',
  },
  {
    id: 'test',
    label: 'Practice test',
    promise: 'Exam conditions from this set',
    icon: 'clipboard',
    feature: 'tests',
    activity: 'test',
  },
  {
    id: 'plan',
    label: 'Study plan',
    promise: 'Calendar and exam dates',
    icon: 'calendar',
    feature: 'tests',
    activity: 'plan',
  },
  {
    id: 'essay',
    label: 'Essay',
    promise: 'Rubric feedback on a draft',
    icon: 'document',
    feature: 'tests',
    activity: 'essay',
  },
];

export const STUDY_SET_HOME_PRIMARY_TOOL_IDS: readonly StudySetHomeToolId[] = [
  'import',
  'quiz',
  'cards',
  'ask',
  'lesson',
  'recap',
  'lecture',
  'play',
  'plan',
  'essay',
];

export type StudySetRecommendedKind =
  | 'ask'
  | 'read'
  | 'quiz'
  | 'cards'
  | 'lesson'
  | 'recap'
  | 'play'
  | 'test';

export interface StudySetRecommendedCard {
  id: StudySetRecommendedKind;
  label: string;
  eyebrow: string;
  icon: WorkspaceIconName;
  feature: FeatureKey;
  primary: boolean;
}

export const STUDY_SET_RECOMMENDED_CARDS: readonly StudySetRecommendedCard[] = [
  { id: 'ask', label: 'Ask Lantern', eyebrow: 'Recommended', icon: 'sparkles', feature: 'ai', primary: true },
  { id: 'read', label: 'Read', eyebrow: 'Catch up quickly', icon: 'book', feature: 'notes', primary: true },
  { id: 'quiz', label: 'Quiz', eyebrow: 'Most used', icon: 'help-circle', feature: 'tests', primary: true },
  { id: 'cards', label: 'Flashcards', eyebrow: 'Practice', icon: 'layers', feature: 'flashcards', primary: false },
  { id: 'lesson', label: 'Tutor', eyebrow: 'Guided', icon: 'school', feature: 'ai', primary: false },
  { id: 'recap', label: 'Listen', eyebrow: 'On the go', icon: 'headphones', feature: 'ai', primary: false },
  { id: 'play', label: 'Arcade', eyebrow: 'Play', icon: 'game-controller', feature: 'flashcards', primary: false },
  { id: 'test', label: 'Practice test', eyebrow: 'Exam conditions', icon: 'clipboard', feature: 'tests', primary: false },
];

export function notePreviewText(body: string | null | undefined, max = 160): string {
  const plain = (body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > max ? `${plain.slice(0, max).trim()}…` : plain;
}

export type QuizTypeCounts = Record<
  'multiple_choice' | 'true_false' | 'fill_in_blank' | 'short_answer',
  number
>;

export const DEFAULT_QUIZ_TYPE_COUNTS: QuizTypeCounts = {
  multiple_choice: 20,
  true_false: 0,
  fill_in_blank: 0,
  short_answer: 0,
};

export function quizTypeCountTotal(counts: QuizTypeCounts): number {
  return (
    Math.max(0, counts.multiple_choice) +
    Math.max(0, counts.true_false) +
    Math.max(0, counts.fill_in_blank) +
    Math.max(0, counts.short_answer)
  );
}
