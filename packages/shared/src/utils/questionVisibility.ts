import { MessageType, QuestionStatus } from '../types';

/** Global preference for which question bubbles/pool items are shown. */
export type QuestionVisibilityMode = 'all' | 'verified' | 'unverified' | 'none';

export const QUESTION_VISIBILITY_STORAGE_KEY = 'lantern.questionVisibilityMode';

export const QUESTION_VISIBILITY_MODE_OPTIONS: ReadonlyArray<{
  value: QuestionVisibilityMode;
  label: string;
  helper: string;
}> = [
  {
    value: 'all',
    label: 'All questions',
    helper: 'Show every question in chat / pool',
  },
  {
    value: 'verified',
    label: 'Verified only',
    helper: 'Group-approved questions',
  },
  {
    value: 'unverified',
    label: 'Unverified only',
    helper: 'Pending/rejected — hides automatically when verified',
  },
  {
    value: 'none',
    label: 'Hide all questions',
    helper: 'Hide question bubbles / empty pool',
  },
];

export function parseQuestionVisibilityMode(
  raw: string | null | undefined
): QuestionVisibilityMode {
  if (raw === 'all' || raw === 'verified' || raw === 'unverified' || raw === 'none') {
    return raw;
  }
  return 'all';
}

export function loadQuestionVisibilityMode(
  getItem: (key: string) => string | null | undefined
): QuestionVisibilityMode {
  try {
    return parseQuestionVisibilityMode(getItem(QUESTION_VISIBILITY_STORAGE_KEY));
  } catch {
    return 'all';
  }
}

export function saveQuestionVisibilityMode(
  setItem: (key: string, value: string) => void,
  mode: QuestionVisibilityMode
): void {
  try {
    setItem(QUESTION_VISIBILITY_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}

export function isQuestionMessage(msg: { type?: string | null }): boolean {
  return String(msg.type || '').toUpperCase() === MessageType.QUESTION;
}

/** PENDING, REJECTED, missing, or unknown → unverified. */
export function isUnverifiedQuestion(
  status?: QuestionStatus | string | null
): boolean {
  if (status == null || status === '') return true;
  return String(status).toUpperCase() !== QuestionStatus.VERIFIED;
}

export function isVerifiedQuestion(
  status?: QuestionStatus | string | null
): boolean {
  return String(status || '').toUpperCase() === QuestionStatus.VERIFIED;
}

/**
 * Chat filter: non-questions always pass. Questions filtered by mode.
 * When a question flips to VERIFIED under `unverified`, it fails the filter (auto-hide).
 */
export function messagePassesQuestionVisibility(
  msg: { type?: string | null; questionStatus?: QuestionStatus | string | null },
  mode: QuestionVisibilityMode
): boolean {
  if (!isQuestionMessage(msg)) return true;
  switch (mode) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'verified':
      return isVerifiedQuestion(msg.questionStatus);
    case 'unverified':
      return isUnverifiedQuestion(msg.questionStatus);
    default:
      return true;
  }
}

/**
 * Study/test pool membership by visibility mode (status only).
 * Callers should still apply structural validity / isQuestionTestable as needed.
 */
export function questionStatusPassesVisibilityMode(
  status: QuestionStatus | string | null | undefined,
  mode: QuestionVisibilityMode
): boolean {
  switch (mode) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'verified':
      return isVerifiedQuestion(status);
    case 'unverified':
      return isUnverifiedQuestion(status);
    default:
      return true;
  }
}
