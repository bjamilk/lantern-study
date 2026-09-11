import { describe, expect, it } from 'vitest';
import {
  PLAY_EMPTY_COPY,
  PLAY_MODES,
  PLAY_REVIEW_COPY,
  PLAY_SECONDS,
  answerPlayQuestion,
  buildPlayQuestions,
  expirePlaySession,
  playBlockerCopy,
  playModeBlocker,
  playStudioBlocker,
  playableCards,
  playScoreLine,
  startPlaySession,
} from './playStudio';

const CARDS = [
  { id: '1', type: 'BASIC', front: 'PE', back: 'Clot in a pulmonary artery' },
  { id: '2', type: 'BASIC', front: 'DVT', back: 'Clot in a deep vein' },
  { id: '3', type: 'BASIC', front: 'Heparin', back: 'Anticoagulant started in hospital' },
  { id: '4', type: 'BASIC', front: 'Warfarin', back: 'Oral anticoagulant needing INR' },
  { id: '5', type: 'CLOZE', front: 'Skip', back: 'Not a basic card' },
];

function sequential() {
  let i = 0;
  return () => {
    i += 1;
    return (i % 10) / 10;
  };
}

describe('play studio', () => {
  it('lists Match plus speed and define, and blocks a course with no deck', () => {
    expect(PLAY_MODES.map((mode) => mode.id)).toEqual(['match', 'speed', 'define']);
    expect(playStudioBlocker(0)).toBe('no_deck');
    expect(playBlockerCopy('no_deck')).toBe(PLAY_EMPTY_COPY);
    expect(playStudioBlocker(1)).toBeNull();
    expect(PLAY_SECONDS).toBe(45);
    expect(PLAY_REVIEW_COPY).toBe('Review missed cards');
  });

  it('builds speed questions from basic cards only, definition first', () => {
    const playable = playableCards(CARDS);
    expect(playable).toHaveLength(4);
    expect(playModeBlocker(playable.slice(0, 1))).toBe('thin_deck');
    expect(PLAY_MODES.find((mode) => mode.id === 'match')?.minCards).toBe(2);
    expect(playModeBlocker(playable.slice(0, 1), 2)).toBe('thin_deck');
    const questions = buildPlayQuestions(playable, 'speed', sequential());
    expect(questions.length).toBeGreaterThanOrEqual(2);
    const first = questions[0]!;
    expect(playable.some((card) => card.back === first.prompt)).toBe(true);
    expect(first.options).toContain(first.correct);
    expect(first.options.length).toBeGreaterThanOrEqual(2);
  });

  it('builds define questions term-first and records missed cards for review', () => {
    const playable = playableCards(CARDS);
    const session = startPlaySession({
      mode: 'define',
      deckId: 'd1',
      deckName: 'PE cards',
      cards: playable,
      random: sequential(),
    });
    expect(session).not.toBeNull();
    const q = session!.questions[0]!;
    expect(playable.some((card) => card.front === q.prompt)).toBe(true);
    const wrong = q.options.find((opt) => opt !== q.correct) ?? 'nope';
    const afterWrong = answerPlayQuestion(session!, wrong);
    expect(afterWrong.missedCardIds).toContain(q.cardId);
    expect(afterWrong.correctCount).toBe(0);
    const afterRight = answerPlayQuestion(session!, q.correct);
    expect(afterRight.correctCount).toBe(1);
    const expired = expirePlaySession(session!);
    expect(expired.status).toBe('results');
    expect(expired.missedCardIds.length).toBeGreaterThan(0);
    expect(playScoreLine({ ...expired, correctCount: 2, questions: session!.questions })).toMatch(
      /2 of /
    );
  });
});
