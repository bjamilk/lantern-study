/**
 * Adaptive quiz — Wave C of the academic replica.
 *
 * A teacher in the loop, not a scored exam. Confirm an answer, rate
 * confidence 1–3, see the explanation, then go on. Misses requeue. Three
 * misses in a row pause and send the student back to notes. Practice tests
 * stay submit-all elsewhere; this session has no submit-all path.
 */

export type AdaptiveQuizKind =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_in_blank'
  | 'short_answer';

export type AdaptiveConfidence = 1 | 2 | 3;

export type AdaptivePhase = 'answer' | 'confidence' | 'feedback' | 'paused' | 'done';

export type AdaptiveDotState = 'unseen' | 'current' | 'correct' | 'missed' | 'requeued';

export interface AdaptiveQuizItem {
  id: string;
  stem: string;
  kind: AdaptiveQuizKind;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  topic?: string;
}

export interface AdaptiveAttempt {
  itemId: string;
  answer: string;
  correct: boolean;
  confidence: AdaptiveConfidence;
}

export interface AdaptiveQuizSession {
  items: AdaptiveQuizItem[];
  queue: string[];
  cursor: number;
  phase: AdaptivePhase;
  draft: string;
  lockedAnswer: string;
  lastGrade: { correct: boolean; confidence: AdaptiveConfidence } | null;
  attempts: AdaptiveAttempt[];
  consecutiveMisses: number;
}

export const ADAPTIVE_PAUSE_AFTER_MISSES = 3;

export const ADAPTIVE_CONFIDENCE_CHOICES: readonly {
  id: AdaptiveConfidence;
  label: string;
  hint: string;
}[] = [
  { id: 1, label: '1', hint: 'Guessing' },
  { id: 2, label: '2', hint: 'Somewhat sure' },
  { id: 3, label: '3', hint: 'I know this' },
];

const KIND_ALIASES: Record<string, AdaptiveQuizKind> = {
  multiple_choice: 'multiple_choice',
  multiple_choice_single: 'multiple_choice',
  MULTIPLE_CHOICE_SINGLE: 'multiple_choice',
  true_false: 'true_false',
  TRUE_FALSE: 'true_false',
  fill_in_blank: 'fill_in_blank',
  fill_in_the_blank: 'fill_in_blank',
  FILL_IN_THE_BLANK: 'fill_in_blank',
  short_answer: 'short_answer',
  open_ended: 'short_answer',
  OPEN_ENDED: 'short_answer',
};

export function isAdaptiveQuizKind(value: string | null | undefined): value is AdaptiveQuizKind {
  return Boolean(value && KIND_ALIASES[value]);
}

export function normalizeAdaptiveKind(value: string | null | undefined): AdaptiveQuizKind | null {
  if (!value) return null;
  return KIND_ALIASES[value] ?? null;
}

function stripAnswerPrefix(value: string): string {
  return value.trim().replace(/^[A-Da-d][.)]\s*/, '').trim();
}

export function normalizeAdaptiveAnswer(value: string): string {
  return stripAnswerPrefix(value).trim().toLowerCase();
}

export function resolveAdaptiveCorrectAnswer(
  correctAnswer: string,
  options?: string[]
): string {
  const trimmed = String(correctAnswer || '').trim();
  if (!trimmed || !options?.length) return trimmed;

  const letter = trimmed.match(/^([A-Da-d])[.)]?$/)?.[1];
  if (letter) {
    const idx = letter.toUpperCase().charCodeAt(0) - 65;
    const picked = options[idx];
    if (picked) return picked;
  }

  const digits = trimmed.match(/^(\d+)$/)?.[1];
  if (digits) {
    const raw = parseInt(digits, 10);
    const fromOne = options[raw - 1];
    if (raw >= 1 && raw <= options.length && fromOne) return fromOne;
    const fromZero = options[raw];
    if (raw >= 0 && raw < options.length && fromZero) return fromZero;
  }

  const normalizedCorrect = normalizeAdaptiveAnswer(trimmed);
  const exact = options.find((opt) => normalizeAdaptiveAnswer(opt) === normalizedCorrect);
  if (exact) return exact;

  return trimmed;
}

export function gradeAdaptiveAnswer(item: AdaptiveQuizItem, answer: string): boolean {
  const resolved = resolveAdaptiveCorrectAnswer(item.correctAnswer, item.options);
  return normalizeAdaptiveAnswer(answer) === normalizeAdaptiveAnswer(resolved);
}

export function canConfirmAnswer(kind: AdaptiveQuizKind, draft: string): boolean {
  if (kind === 'multiple_choice' || kind === 'true_false') {
    return draft.trim().length > 0;
  }
  return draft.trim().length > 0;
}

/** Misses and guesses come back later. A confident hit is mastered. */
export function shouldRequeue(correct: boolean, confidence: AdaptiveConfidence): boolean {
  if (!correct) return true;
  return confidence === 1;
}

export function shouldPause(
  consecutiveMisses: number,
  threshold: number = ADAPTIVE_PAUSE_AFTER_MISSES
): boolean {
  return consecutiveMisses >= threshold;
}

export function applyRequeue(queue: readonly string[], cursor: number, itemId: string): string[] {
  const next = [...queue];
  const insertAt = Math.min(Math.max(cursor + 2, cursor + 1), next.length);
  next.splice(insertAt, 0, itemId);
  return next;
}

function lastAttempts(attempts: readonly AdaptiveAttempt[]): Map<string, AdaptiveAttempt> {
  const last = new Map<string, AdaptiveAttempt>();
  for (const attempt of attempts) last.set(attempt.itemId, attempt);
  return last;
}

export function isMasteredAttempt(attempt: AdaptiveAttempt | undefined): boolean {
  return Boolean(attempt && attempt.correct && !shouldRequeue(true, attempt.confidence));
}

export function masteryPercent(session: AdaptiveQuizSession): number {
  if (session.items.length === 0) return 0;
  const last = lastAttempts(session.attempts);
  let mastered = 0;
  for (const item of session.items) {
    if (isMasteredAttempt(last.get(item.id))) mastered += 1;
  }
  return Math.round((mastered / session.items.length) * 100);
}

export function currentAdaptiveItem(session: AdaptiveQuizSession): AdaptiveQuizItem | null {
  const id = session.queue[session.cursor];
  if (!id) return null;
  return session.items.find((item) => item.id === id) ?? null;
}

export function adaptiveDots(session: AdaptiveQuizSession): Array<{
  itemId: string;
  state: AdaptiveDotState;
}> {
  const currentId = session.queue[session.cursor];
  const last = lastAttempts(session.attempts);
  const upcoming = new Set(session.queue.slice(session.cursor + 1));
  return session.items.map((item) => {
    if (item.id === currentId && session.phase !== 'done') {
      return { itemId: item.id, state: 'current' as const };
    }
    const attempt = last.get(item.id);
    if (!attempt) return { itemId: item.id, state: 'unseen' as const };
    if (isMasteredAttempt(attempt)) return { itemId: item.id, state: 'correct' as const };
    if (upcoming.has(item.id)) return { itemId: item.id, state: 'requeued' as const };
    return { itemId: item.id, state: 'missed' as const };
  });
}

/** Adaptive quiz never offers a submit-all control. */
export function canSubmitAll(): false {
  return false;
}

export function startAdaptiveQuiz(items: AdaptiveQuizItem[]): AdaptiveQuizSession {
  const pool = items.filter((item) => item.id && item.stem.trim());
  return {
    items: pool,
    queue: pool.map((item) => item.id),
    cursor: 0,
    phase: pool.length === 0 ? 'done' : 'answer',
    draft: '',
    lockedAnswer: '',
    lastGrade: null,
    attempts: [],
    consecutiveMisses: 0,
  };
}

export function setAdaptiveDraft(session: AdaptiveQuizSession, draft: string): AdaptiveQuizSession {
  if (session.phase !== 'answer') return session;
  return { ...session, draft };
}

export function confirmAdaptiveAnswer(session: AdaptiveQuizSession): AdaptiveQuizSession {
  const item = currentAdaptiveItem(session);
  if (!item || session.phase !== 'answer') return session;
  if (!canConfirmAnswer(item.kind, session.draft)) return session;
  return {
    ...session,
    phase: 'confidence',
    lockedAnswer: session.draft,
  };
}

export function rateAdaptiveConfidence(
  session: AdaptiveQuizSession,
  confidence: AdaptiveConfidence
): AdaptiveQuizSession {
  const item = currentAdaptiveItem(session);
  if (!item || session.phase !== 'confidence') return session;
  if (confidence !== 1 && confidence !== 2 && confidence !== 3) return session;

  const correct = gradeAdaptiveAnswer(item, session.lockedAnswer);
  const consecutiveMisses = correct ? 0 : session.consecutiveMisses + 1;
  const attempts: AdaptiveAttempt[] = [
    ...session.attempts,
    { itemId: item.id, answer: session.lockedAnswer, correct, confidence },
  ];
  const queue = shouldRequeue(correct, confidence)
    ? applyRequeue(session.queue, session.cursor, item.id)
    : session.queue;
  const paused = shouldPause(consecutiveMisses);

  return {
    ...session,
    queue,
    attempts,
    consecutiveMisses,
    lastGrade: { correct, confidence },
    phase: paused ? 'paused' : 'feedback',
  };
}

export function advanceAdaptiveQuiz(session: AdaptiveQuizSession): AdaptiveQuizSession {
  if (session.phase !== 'feedback') return session;
  const nextCursor = session.cursor + 1;
  if (nextCursor >= session.queue.length) {
    return { ...session, cursor: nextCursor, phase: 'done', draft: '', lockedAnswer: '' };
  }
  return {
    ...session,
    cursor: nextCursor,
    phase: 'answer',
    draft: '',
    lockedAnswer: '',
    lastGrade: null,
  };
}

export function resumeAdaptiveQuiz(session: AdaptiveQuizSession): AdaptiveQuizSession {
  if (session.phase !== 'paused') return session;
  return { ...session, phase: 'feedback', consecutiveMisses: 0 };
}

export function buildQuestionAsk(input: {
  question?: string;
  stem: string;
  explanation?: string;
  noteTitle?: string;
}): string {
  const question = input.question?.trim() || 'Explain this question';
  const stem = input.stem.trim();
  const where = input.noteTitle?.trim()
    ? `in "${input.noteTitle.trim()}"`
    : 'in this quiz';
  if (!stem) {
    return `${question}\n\n(I wanted to ask about a question ${where}, but it was empty.)`;
  }
  const explanation = input.explanation?.trim();
  const extra = explanation ? `\n\nThe stored explanation is:\n"""\n${explanation}\n"""` : '';
  return `${question}\n\nThis is the question ${where}:\n"""\n${stem}\n"""${extra}`;
}

function optionText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) return record.text;
    if (typeof record.label === 'string' && record.label.trim()) return record.label;
  }
  return null;
}

function optionId(value: unknown, index: number): string {
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return `opt-${index}`;
}

/**
 * Accept daily-quiz rows, generated questions, and canonical TestQuestion
 * objects. Matching / diagram / multi-select are skipped — Wave C is MCQ,
 * T/F, fill-blank, and short answer.
 */
export function normalizeAdaptiveItem(raw: unknown, index: number = 0): AdaptiveQuizItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kind = normalizeAdaptiveKind(
    typeof row.kind === 'string'
      ? row.kind
      : typeof row.type === 'string'
        ? row.type
        : typeof row.questionType === 'string'
          ? row.questionType
          : null
  );
  if (!kind) return null;

  const stem = String(row.stem || row.text || row.question || row.questionStem || '').trim();
  if (!stem) return null;

  const rawOptions = Array.isArray(row.options) ? row.options : [];
  const options = rawOptions.map(optionText).filter((text): text is string => Boolean(text));

  let correctAnswer = '';
  if (typeof row.correctAnswer === 'string' && row.correctAnswer.trim()) {
    correctAnswer = row.correctAnswer;
  } else if (Array.isArray(row.acceptableAnswers) && typeof row.acceptableAnswers[0] === 'string') {
    correctAnswer = row.acceptableAnswers[0];
  } else if (Array.isArray(row.correctAnswerIds) && rawOptions.length) {
    const ids = row.correctAnswerIds.map(String);
    const hit = rawOptions.find((opt, optIndex) => ids.includes(optionId(opt, optIndex)));
    correctAnswer = optionText(hit) || '';
  }

  if (!correctAnswer && kind === 'true_false' && options.length === 0) {
    // Still usable once the UI supplies True / False; require an answer string.
  }
  if (!correctAnswer) return null;

  const id = String(row.id || `adaptive-${index + 1}`);
  return {
    id,
    stem,
    kind,
    options: options.length > 0 ? options : kind === 'true_false' ? ['True', 'False'] : undefined,
    correctAnswer,
    explanation: typeof row.explanation === 'string' ? row.explanation : undefined,
    topic: typeof row.topic === 'string' ? row.topic : undefined,
  };
}

export function itemsFromUnknownQuestions(rows: unknown[] | null | undefined): AdaptiveQuizItem[] {
  if (!Array.isArray(rows)) return [];
  const items: AdaptiveQuizItem[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const item = normalizeAdaptiveItem(row, index);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  });
  return items;
}
