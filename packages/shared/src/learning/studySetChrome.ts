/**
 * Set-chrome helpers: companion prompts, resume kind, and exam dates on Home.
 */
import { parseCalendarNoteBody } from './studyCalendar';
import { todayDateOnlyLocal } from '../utils/dateOnly';
import type { StudyResumeKind } from './studyResume';
import type { StudySetPathActivity } from './studySetRoutes';

export interface StudySetCompanionPrompt {
  id: string;
  label: string;
  ask?: string;
  go?: StudySetPathActivity;
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
  if (activity === 'notes' || activity === 'read' || activity === 'walkthrough') {
    return [
      { id: 'explain', label: 'Explain hard parts', ask: 'Explain the hardest parts of this note.' },
      { id: 'cards', label: 'Generate flashcards', go: 'cards' },
      { id: 'gaps', label: 'Fill gaps', ask: 'What am I missing from this note?' },
      { id: 'summary', label: 'Add a summary', ask: 'Write a short summary of this note.' },
    ];
  }
  if (activity === 'cards') {
    return [
      { id: 'explain', label: 'Explain this card', ask: 'Explain this flashcard in plain language.' },
      { id: 'quiz', label: 'Quiz me', go: 'quiz' },
      { id: 'test', label: 'Make a test', go: 'test' },
    ];
  }
  if (activity === 'quiz' || activity === 'test') {
    return [
      { id: 'explain', label: 'Why is this right?', ask: 'Explain the last question I got wrong.' },
      { id: 'read', label: 'Read the source', go: 'read' },
      { id: 'cards', label: 'Make cards', go: 'cards' },
    ];
  }
  if (activity === 'home') {
    return [
      { id: 'next', label: 'What next?', ask: 'What should I study next in this set?' },
      { id: 'quiz', label: 'Start a quiz', go: 'quiz' },
      { id: 'tutor', label: 'Tutor me', go: 'lesson' },
    ];
  }
  return [
    { id: 'next', label: 'Guide me', ask: 'Help me study this set. What should I do next?' },
    { id: 'home', label: 'Set home', go: 'home' },
  ];
}

export interface UpcomingExam {
  examDate: string;
  title: string;
  studySetId?: string;
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
          title: (note.title || '').trim() || 'Exam',
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
