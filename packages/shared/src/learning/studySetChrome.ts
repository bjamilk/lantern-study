/**
 * Set-chrome helpers: companion prompts, resume kind, and exam dates on Home.
 */
import { parseCalendarNoteBody } from './studyCalendar';
import { todayDateOnlyLocal } from '../utils/dateOnly';
import type { StudyResumeKind } from './studyResume';
import type { StudySetPathActivity } from './studySetRoutes';
import type { WorkspaceIconName } from './courseWorkspace';
import type { FeatureKey } from '../design';

export interface StudySetCompanionPrompt {
  id: string;
  label: string;
  ask?: string;
  go?: StudySetPathActivity;
  /**
   * The 16 px glyph the chip carries, drawn in `feature`'s ink.
   *
   * A row of five word-only chips is a wall of text you have to read to use;
   * with a mark each, the one you want is findable by shape. Optional because
   * a prompt that genuinely has no object — "Fill gaps" — is better bare than
   * wearing a sparkle that means nothing.
   */
  icon?: WorkspaceIconName;
  /**
   * Whose ink the glyph takes. Defaults, at the call site, to the intent the
   * chip serves: a chip that GOES somewhere takes that destination's hue, and
   * a chip that ASKS the companion takes `ai`.
   */
  feature?: FeatureKey;
}

export function resumeKindFromActivity(activity: StudySetPathActivity): StudyResumeKind {
  if (activity === 'cards') return 'cards';
  if (activity === 'quiz') return 'quiz';
  if (activity === 'test') return 'test';
  if (activity === 'lecture') return 'lecture';
  if (activity === 'recap') return 'recap';
  if (activity === 'lesson') return 'lesson';
  if (activity === 'play') return 'play';
  if (activity === 'essay') return 'essay';
  return 'note';
}

export function studySetCompanionPrompts(
  activity: StudySetPathActivity
): readonly StudySetCompanionPrompt[] {
  // The rule for the glyph and the hue: a chip that GOES somewhere wears that
  // destination's mark and hue, so the chip and the tile it lands on are the
  // same object twice. A chip that ASKS the companion wears `sparkles` in the
  // `ai` violet — one mark for "this spends a turn of the companion", rather
  // than a different drawing of a question per prompt.
  if (activity === 'notes' || activity === 'read' || activity === 'walkthrough') {
    return [
      { id: 'explain', label: 'Explain hard parts', ask: 'Explain the hardest parts of this note.', icon: 'sparkles', feature: 'ai' },
      { id: 'cards', label: 'Generate flashcards', go: 'cards', icon: 'layers', feature: 'flashcards' },
      { id: 'gaps', label: 'Fill gaps', ask: 'What am I missing from this note?', icon: 'sparkles', feature: 'ai' },
      { id: 'summary', label: 'Add a summary', ask: 'Write a short summary of this note.', icon: 'sparkles', feature: 'ai' },
    ];
  }
  if (activity === 'cards') {
    return [
      { id: 'explain', label: 'Explain this card', ask: 'Explain this flashcard in plain language.', icon: 'sparkles', feature: 'ai' },
      { id: 'quiz', label: 'Quiz me', go: 'quiz', icon: 'help-circle', feature: 'tests' },
      { id: 'test', label: 'Make a test', go: 'test', icon: 'clipboard-check', feature: 'tests' },
    ];
  }
  if (activity === 'quiz' || activity === 'test') {
    return [
      { id: 'explain', label: 'Why is this right?', ask: 'Explain the last question I got wrong.', icon: 'sparkles', feature: 'ai' },
      { id: 'read', label: 'Read the source', go: 'read', icon: 'document-text', feature: 'notes' },
      { id: 'cards', label: 'Make cards', go: 'cards', icon: 'layers', feature: 'flashcards' },
    ];
  }
  if (activity === 'home') {
    return [
      { id: 'next', label: 'What next?', ask: 'What should I study next in this set?', icon: 'sparkles', feature: 'ai' },
      { id: 'quiz', label: 'Start a quiz', go: 'quiz', icon: 'help-circle', feature: 'tests' },
      { id: 'tutor', label: 'Tutor me', go: 'lesson', icon: 'school', feature: 'ai' },
    ];
  }
  return [
    { id: 'next', label: 'Guide me', ask: 'Help me study this set. What should I do next?', icon: 'sparkles', feature: 'ai' },
    { id: 'home', label: 'Set home', go: 'home', icon: 'albums', feature: 'sets' },
  ];
}

export interface UpcomingExam {
  examDate: string;
  title: string;
  studySetId?: string;
}

/**
 * What Home's Upcoming card and the set room's exam list should call an exam.
 *
 * A generated plan note is titled `Plan — <set>` (`newCalendarNoteTitle`), and
 * that whole title was being rendered as the exam name, so Home read
 * "Plan — PHARM 212 · 2026-09-30". The exam is not the plan; name the set.
 */
export function examTitleFromNote(title: string | null | undefined): string {
  const trimmed = (title || '').trim();
  const named = trimmed.replace(/^(?:Plan|Lesson|Recap|Essay)\s+[—-]\s+/, '').trim();
  return named || trimmed || 'Exam';
}

export function upcomingExamsFromNotes(
  notes: readonly { title?: string | null; body?: string | null; studySetId?: string | null }[],
  today = todayDateOnlyLocal()
): UpcomingExam[] {
  return notes
    .flatMap((note) => {
      const plan = parseCalendarNoteBody(note.body);
      if (!plan || plan.examDate < today) return [];
      return [
        {
          examDate: plan.examDate,
          title: examTitleFromNote(note.title),
          studySetId: note.studySetId || undefined,
        },
      ];
    })
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
}

export function firstQuestionPreview(questions: unknown): string | null {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (!first || typeof first !== 'object') return null;
  const row = first as Record<string, unknown>;
  const text =
    (typeof row.question === 'string' && row.question) ||
    (typeof row.prompt === 'string' && row.prompt) ||
    (typeof row.stem === 'string' && row.stem) ||
    (typeof row.text === 'string' && row.text) ||
    '';
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}
