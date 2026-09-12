/**
 * Play studio — Wave I of the academic replica.
 *
 * Match already ships. This hub adds speed games loaded from the open course's
 * deck. No AI credits. Group duels stay in Chat. A course with no deck cannot
 * start Play.
 */

import type { WorkspaceScope } from './courseWorkspace';

export type PlayModeId = 'match' | 'speed' | 'define';

export interface PlayMode {
  id: PlayModeId;
  label: string;
  promise: string;
  minCards: number;
}

export const PLAY_MODES: readonly PlayMode[] = [
  {
    id: 'match',
    label: 'Match',
    promise: 'Pair terms with their backs.',
    minCards: 2,
  },
  {
    id: 'speed',
    label: 'Speed',
    promise: 'See the definition, tap the term.',
    minCards: 2,
  },
  {
    id: 'define',
    label: 'Define',
    promise: 'See the term, tap the definition.',
    minCards: 2,
  },
];

export const PLAY_ROUND_CAP = 8;
export const PLAY_SECONDS = 45;
export const PLAY_OPTION_CAP = 4;

/** Scope-aware empty state: a set room must not send a student to "this course". */
export function playEmptyCopy(scope: WorkspaceScope = 'course'): string {
  return `File a deck in this ${scope} first.`;
}

/** The Play hub tagline, with its container named correctly. */
export function playTaglineCopy(scope: WorkspaceScope = 'course'): string {
  return `Games from this ${scope}’s cards. Group duels stay in Chat.`;
}

export const PLAY_EMPTY_COPY = playEmptyCopy('course');
export const PLAY_THIN_COPY = 'This deck needs at least two term-and-definition cards.';
export const PLAY_REVIEW_COPY = 'Review missed cards';

export type PlayBlocker = 'no_deck' | 'thin_deck';

export interface PlayCard {
  id: string;
  front: string;
  back: string;
}

export interface PlayQuestion {
  cardId: string;
  prompt: string;
  options: string[];
  correct: string;
}

export interface PlaySession {
  mode: 'speed' | 'define';
  deckId: string;
  deckName: string;
  questions: PlayQuestion[];
  index: number;
  correctCount: number;
  missedCardIds: string[];
  status: 'playing' | 'results';
}

export function playStudioBlocker(deckCount: number): PlayBlocker | null {
  return deckCount <= 0 ? 'no_deck' : null;
}

export function playableCards<
  T extends { id: string; type?: string | null; front?: string | null; back?: string | null },
>(cards: readonly T[]): PlayCard[] {
  const out: PlayCard[] = [];
  for (const card of cards) {
    const type = card.type ?? 'BASIC';
    if (type !== 'BASIC') continue;
    const front = (card.front ?? '').trim();
    const back = (card.back ?? '').trim();
    if (!front || !back) continue;
    out.push({ id: card.id, front, back });
  }
  return out;
}

export function playModeBlocker(cards: readonly PlayCard[], minCards = 2): PlayBlocker | null {
  return cards.length < minCards ? 'thin_deck' : null;
}

export function playBlockerCopy(
  blocker: PlayBlocker | null,
  scope: WorkspaceScope = 'course'
): string | null {
  if (blocker === 'no_deck') return playEmptyCopy(scope);
  if (blocker === 'thin_deck') return PLAY_THIN_COPY;
  return null;
}

export function shuffleCopy<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

function uniqueSide(cards: readonly PlayCard[], side: 'front' | 'back', exceptId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    if (card.id === exceptId) continue;
    const value = side === 'front' ? card.front : card.back;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function buildPlayQuestions(
  cards: readonly PlayCard[],
  mode: 'speed' | 'define',
  random: () => number = Math.random
): PlayQuestion[] {
  const pool = cards.slice(0, Math.max(cards.length, 0));
  if (pool.length < 2) return [];
  const picked = shuffleCopy(pool, random).slice(0, PLAY_ROUND_CAP);
  const questions: PlayQuestion[] = [];
  for (const card of picked) {
    const prompt = mode === 'speed' ? card.back : card.front;
    const correct = mode === 'speed' ? card.front : card.back;
    const distractorSide = mode === 'speed' ? 'front' : 'back';
    const distractors = shuffleCopy(uniqueSide(pool, distractorSide, card.id), random)
      .filter((value) => value !== correct)
      .slice(0, PLAY_OPTION_CAP - 1);
    const options = shuffleCopy([correct, ...distractors], random);
    questions.push({ cardId: card.id, prompt, options, correct });
  }
  return questions;
}

export function startPlaySession(input: {
  mode: 'speed' | 'define';
  deckId: string;
  deckName: string;
  cards: readonly PlayCard[];
  random?: () => number;
}): PlaySession | null {
  const questions = buildPlayQuestions(input.cards, input.mode, input.random);
  if (questions.length === 0) return null;
  return {
    mode: input.mode,
    deckId: input.deckId,
    deckName: input.deckName,
    questions,
    index: 0,
    correctCount: 0,
    missedCardIds: [],
    status: 'playing',
  };
}

export function currentPlayQuestion(session: PlaySession): PlayQuestion | null {
  return session.questions[session.index] ?? null;
}

export function answerPlayQuestion(session: PlaySession, choice: string): PlaySession {
  if (session.status === 'results') return session;
  const question = currentPlayQuestion(session);
  if (!question) return { ...session, status: 'results' };
  const hit = choice === question.correct;
  const missedCardIds = hit
    ? session.missedCardIds
    : session.missedCardIds.includes(question.cardId)
      ? session.missedCardIds
      : [...session.missedCardIds, question.cardId];
  const nextIndex = session.index + 1;
  const done = nextIndex >= session.questions.length;
  return {
    ...session,
    index: done ? session.index : nextIndex,
    correctCount: session.correctCount + (hit ? 1 : 0),
    missedCardIds,
    status: done ? 'results' : 'playing',
  };
}

export function expirePlaySession(session: PlaySession): PlaySession {
  if (session.status === 'results') return session;
  const remaining = session.questions.slice(session.index);
  const missed = [...session.missedCardIds];
  for (const question of remaining) {
    if (!missed.includes(question.cardId)) missed.push(question.cardId);
  }
  return { ...session, missedCardIds: missed, status: 'results' };
}

export function playScoreLine(session: PlaySession): string {
  return `${session.correctCount} of ${session.questions.length}`;
}
