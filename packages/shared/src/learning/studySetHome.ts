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
];
