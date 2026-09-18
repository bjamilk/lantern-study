/**
 * The one create loop every Study door shares: pick a source, customize,
 * then generate. The web wizard renders this; the API job consumes the
 * topic brief. A button that says "from a topic" must never open materials.
 */
import type { QuizTypeCounts } from '../learning/studySetHome';
import { DEFAULT_QUIZ_TYPE_COUNTS } from '../learning/studySetHome';
import type { LessonMode } from '../learning/lessonStudio';
import type { RecapLength, RecapStyle } from '../learning/recapStudio';
import type { SmartNotesDepth } from '../utils/smartNotes';

export type CreateFromSourceKind =
  | 'quiz'
  | 'cards'
  | 'recap'
  | 'lesson'
  | 'play'
  | 'essay'
  | 'test'
  | 'materials'
  | 'notes';

/** One Upload modal from the rail, set home, and `/add`. */
export type StudyUploadSource =
  | 'pdf'
  | 'ppt'
  | 'docx'
  | 'audio'
  | 'video'
  | 'youtube'
  | 'paste'
  | 'anki'
  | 'blank'
  | 'photo'
  | 'lecture';

export type CreateFromSourceId = 'materials' | 'topic' | 'scratch' | 'flashcards' | 'import';

export type TopicSkillLevel = 'intro' | 'intermediate' | 'exam';

export interface TopicBrief {
  title: string;
  subject?: string;
  level: TopicSkillLevel;
}

export const TOPIC_SKILL_LEVELS: readonly {
  id: TopicSkillLevel;
  label: string;
  promise: string;
}[] = [
  { id: 'intro', label: 'Introductory', promise: 'First principles and vocabulary' },
  { id: 'intermediate', label: 'Intermediate', promise: 'Worked examples and connections' },
  { id: 'exam', label: 'Exam-ready', promise: 'What a paper is likely to ask' },
];

const TOPIC_TITLE_MIN = 2;
const TOPIC_TITLE_MAX = 80;
export const STARTER_NOTE_MIN = 3;
export const STARTER_NOTE_MAX = 8;
export const QUIZ_FROM_CARDS_COUNT = 20;

export const CREATE_FROM_SOURCE_NOUN: Record<CreateFromSourceKind, string> = {
  quiz: 'quiz',
  cards: 'deck',
  recap: 'recap',
  lesson: 'lesson',
  play: 'game',
  essay: 'essay',
  test: 'test',
  materials: 'notes',
  notes: 'note',
};

export function sourcesForKind(kind: CreateFromSourceKind): readonly CreateFromSourceId[] {
  switch (kind) {
    case 'quiz':
      return ['materials', 'flashcards', 'topic', 'scratch'];
    case 'cards':
      return ['materials', 'topic', 'scratch', 'import'];
    case 'materials':
      return ['topic'];
    case 'notes':
      return ['materials', 'topic', 'scratch'];
    case 'test':
      return ['materials', 'scratch'];
    default:
      return ['materials', 'topic', 'scratch'];
  }
}

export function sourceCardCopy(
  id: CreateFromSourceId,
  kind: CreateFromSourceKind
): { title: string; promise: string } {
  if (id === 'materials') {
    return { title: 'From materials', promise: 'Use notes already in this set' };
  }
  if (id === 'topic') {
    return {
      title: 'From a topic',
      promise:
        kind === 'materials'
          ? 'Write 3–8 starter notes from a topic, subject and level'
          : 'Generate from a topic — not from a note you already have',
    };
  }
  if (id === 'flashcards') {
    return { title: 'From flashcards', promise: `Write ${QUIZ_FROM_CARDS_COUNT} multiple-choice questions from this set’s decks` };
  }
  if (id === 'import') {
    return { title: 'Anki / Quizlet', promise: 'Paste a tab-separated export' };
  }
  return {
    title: 'From scratch',
    promise:
      kind === 'quiz'
        ? 'Open the quiz writer'
        : kind === 'cards'
          ? 'Start an empty deck'
          : kind === 'test'
            ? 'Open the test builder'
            : kind === 'play'
              ? 'Open Play with the decks you already have'
              : 'Open the studio empty',
  };
}

export function normalizeTopicBrief(input: {
  title?: string | null;
  subject?: string | null;
  level?: string | null;
}): TopicBrief | null {
  const title = (input.title ?? '').trim().replace(/\s+/g, ' ');
  if (title.length < TOPIC_TITLE_MIN || title.length > TOPIC_TITLE_MAX) return null;
  const level: TopicSkillLevel =
    input.level === 'intro' || input.level === 'intermediate' || input.level === 'exam'
      ? input.level
      : 'intermediate';
  const subject = (input.subject ?? '').trim().replace(/\s+/g, ' ');
  return {
    title,
    level,
    ...(subject ? { subject } : {}),
  };
}

export function topicBriefError(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length < TOPIC_TITLE_MIN) return 'Name the topic in at least two characters.';
  if (trimmed.length > TOPIC_TITLE_MAX) return `Keep the topic under ${TOPIC_TITLE_MAX} characters.`;
  return null;
}

export function starterNoteCountForLevel(level: TopicSkillLevel): number {
  if (level === 'intro') return 3;
  if (level === 'exam') return 8;
  return 5;
}

export interface TopicNoteDraft {
  title: string;
  body: string;
}

/**
 * Keep 3–8 usable notes. Drop empty bodies. Title falls back to the topic
 * plus an index so a thin model reply still files something the student can open.
 */
export function normalizeTopicNoteDrafts(
  raw: unknown,
  topic: string,
  wanted = 5
): TopicNoteDraft[] {
  const cap = Math.min(STARTER_NOTE_MAX, Math.max(STARTER_NOTE_MIN, wanted));
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { notes?: unknown }).notes)
      ? (raw as { notes: unknown[] }).notes
      : [];
  const topicTitle = topic.trim() || 'Topic';
  const drafts: TopicNoteDraft[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const body = typeof record.body === 'string' ? record.body.trim() : '';
    if (body.length < 40) continue;
    const title =
      (typeof record.title === 'string' && record.title.trim()) ||
      `${topicTitle} · ${drafts.length + 1}`;
    drafts.push({ title: title.slice(0, 120), body });
    if (drafts.length >= cap) break;
  }
  return drafts;
}

export interface CreateFromSourceOptions {
  questionCount?: number;
  title?: string;
  focus?: string;
  quizTypes?: QuizTypeCounts;
  lessonMode?: LessonMode;
  recapStyle?: RecapStyle;
  recapLength?: RecapLength;
  notesDepth?: SmartNotesDepth;
  rubricText?: string;
}

export function defaultCreateOptions(): CreateFromSourceOptions {
  return { quizTypes: { ...DEFAULT_QUIZ_TYPE_COUNTS }, questionCount: 20 };
}

/**
 * Split pasted or imported text on chapter / heading boundaries.
 * One part is not a split — return the original so we never invent empty notes.
 */
export function splitNoteBodyByChapters(
  title: string,
  body: string
): Array<{ title: string; body: string }> {
  const text = body.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const heading = /^(?:#{1,3}\s+|(?:chapter|section)\s+\d+[.:)\s-]+)/im;
  const parts = text.split(/(?=^(?:#{1,3}\s+|(?:chapter|section)\s+\d+[.:)\s-]+))/im);
  const usable = parts
    .map((part) => part.trim())
    .filter((part) => part.length >= 40)
    .map((part, index) => {
      const first = part.split('\n').find((line) => line.trim()) || '';
      const headingTitle = first
        .replace(/^#{1,3}\s+/, '')
        .replace(/^(?:chapter|section)\s+\d+[.:)\s-]*/i, '')
        .trim();
      return {
        title: (headingTitle || `${title} · ${index + 1}`).slice(0, 120),
        body: part,
      };
    });
  return usable.length >= 2 ? usable : [{ title, body: text }];
}

export type StudyTestDoor = 'quiz' | 'test';

/**
 * Which Study door a saved personal test belongs on.
 *
 * New writes stamp `studyDoor` on the config. Older rows fall back to
 * attempt kind, session mode, then a "Quiz:" title prefix. Untagged
 * historical practice tests stay on Test so the Test door does not empty.
 */
export function studyTestDoor(row: {
  title?: string | null;
  studyDoor?: string | null;
  attemptKind?: string | null;
  mode?: string | null;
}): StudyTestDoor {
  if (row.studyDoor === 'quiz' || row.studyDoor === 'test') return row.studyDoor;
  if (row.attemptKind === 'exam' || row.mode === 'test') return 'test';
  if (row.attemptKind === 'practice' || row.mode === 'study') return 'quiz';
  if (/^quiz\b/i.test((row.title || '').trim())) return 'quiz';
  return 'test';
}

export type TestSittingPresetId = 'timed' | 'calculator_off' | 'passage';

export const TEST_SITTING_PRESETS: readonly {
  id: TestSittingPresetId;
  label: string;
  promise: string;
}[] = [
  { id: 'timed', label: 'Timed', promise: 'A clock runs; answers stay hidden until the end' },
  { id: 'calculator_off', label: 'No calculator', promise: 'Work the numbers by hand' },
  { id: 'passage', label: 'Passage', promise: 'A stem that quotes the material, then the ask' },
];
