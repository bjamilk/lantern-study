import { describe, expect, it } from 'vitest';
import {
  answerPlayQuestion,
  expirePlaySession,
  startPlaySession,
  type PlaySession,
} from '@lantern/shared';
import { buildPlayActivity } from './PlayStudio';

function cards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    front: `Term ${i}`,
    back: `Definition ${i}`,
  }));
}

function round(mode: 'speed' | 'define' = 'speed', count = 4): PlaySession {
  const session = startPlaySession({
    mode,
    deckId: 'pharm',
    deckName: 'Pharmacology',
    cards: cards(count),
  });
  if (!session) throw new Error('expected a session');
  return session;
}

/** Answer every question, choosing right or wrong. */
function playThrough(session: PlaySession, correct: boolean): PlaySession {
  let current = session;
  while (current.status === 'playing') {
    const question = current.questions[current.index];
    const choice = correct
      ? question.correct
      : question.options.find((option) => option !== question.correct) ?? question.correct;
    current = answerPlayQuestion(current, choice);
  }
  return current;
}

describe('buildPlayActivity', () => {
  it('records nothing while the round is still being played', () => {
    expect(buildPlayActivity(round())).toBeNull();
  });

  it('records nothing when there is no session at all', () => {
    expect(buildPlayActivity(null)).toBeNull();
  });

  it('reports a finished round as one game, the same type Match uses', () => {
    const finished = playThrough(round(), true);
    const activity = buildPlayActivity(finished);
    expect(activity).toEqual({ type: 'game', amount: 1, scorePercent: 100 });
  });

  it('weights the row by how the student actually did', () => {
    const finished = playThrough(round('define', 4), false);
    expect(buildPlayActivity(finished)?.scorePercent).toBe(0);
  });

  it('counts a round the clock ended, not just one played out', () => {
    const expired = expirePlaySession(round());
    const activity = buildPlayActivity(expired);
    expect(activity?.type).toBe('game');
    expect(activity?.amount).toBe(1);
  });

  it('scores a partly finished round against everything it asked', () => {
    // Two of four right, then time runs out.
    let session = round('speed', 4);
    session = answerPlayQuestion(session, session.questions[0].correct);
    session = answerPlayQuestion(session, session.questions[1].correct);
    const expired = expirePlaySession(session);
    expect(buildPlayActivity(expired)?.scorePercent).toBe(50);
  });

  it('never records a study day for a round with no questions', () => {
    const empty = { ...round(), questions: [], status: 'results' as const, correctCount: 0 };
    expect(buildPlayActivity(empty)).toBeNull();
  });

  it('clamps a score that claims more right answers than questions asked', () => {
    const bogus = { ...playThrough(round(), true), correctCount: 999 };
    expect(buildPlayActivity(bogus)?.scorePercent).toBe(100);
  });

  it('never reports a negative score', () => {
    const bogus = { ...playThrough(round(), true), correctCount: -5 };
    expect(buildPlayActivity(bogus)?.scorePercent).toBe(0);
  });
});
