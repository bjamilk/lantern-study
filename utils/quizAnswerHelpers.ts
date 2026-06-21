import type { DailyQuizQuestion } from '../types';

function stripAnswerPrefix(value: string): string {
  return value.trim().replace(/^[A-Da-d][.)]\s*/, '').trim();
}

export function normalizeAnswerText(value: string): string {
  return stripAnswerPrefix(value).trim().toLowerCase();
}

/** Resolve letter/index/prefixed correctAnswer values to the option text shown in the UI. */
export function resolveQuizCorrectAnswer(
  correctAnswer: string,
  options?: string[]
): string {
  const trimmed = String(correctAnswer || '').trim();
  if (!trimmed || !options?.length) return trimmed;

  const letterMatch = trimmed.match(/^([A-Da-d])[.)]?$/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) {
    const raw = parseInt(numMatch[1], 10);
    if (raw >= 1 && raw <= options.length) return options[raw - 1];
    if (raw >= 0 && raw < options.length) return options[raw];
  }

  const normalizedCorrect = normalizeAnswerText(trimmed);
  const exact = options.find(opt => normalizeAnswerText(opt) === normalizedCorrect);
  if (exact) return exact;

  const prefixed = options.find(opt => {
    const match = opt.match(/^([A-Da-d])[.)]\s*(.*)$/);
    if (!match) return false;
    return match[1].toLowerCase() === trimmed.toLowerCase()
      || normalizeAnswerText(match[2]) === normalizedCorrect;
  });
  if (prefixed) return prefixed;

  const fuzzy = options.find(opt => {
    const nOpt = normalizeAnswerText(opt);
    return nOpt.includes(normalizedCorrect) || normalizedCorrect.includes(nOpt);
  });
  if (fuzzy) return fuzzy;

  return trimmed;
}

export function isQuizAnswerCorrect(
  selected: string,
  question: Pick<DailyQuizQuestion, 'correctAnswer' | 'options'>
): boolean {
  const resolved = resolveQuizCorrectAnswer(question.correctAnswer, question.options);
  return normalizeAnswerText(selected) === normalizeAnswerText(resolved);
}
