import React, { useEffect, useMemo, useState } from 'react';
import {
  PLAY_MODES,
  PLAY_REVIEW_COPY,
  PLAY_SECONDS,
  answerPlayQuestion,
  currentPlayQuestion,
  expirePlaySession,
  playBlockerCopy,
  playTaglineCopy,
  playModeBlocker,
  playScoreLine,
  playStudioBlocker,
  playableCards,
  startPlaySession,
  type PlayModeId,
  type PlaySession,
  type WorkspaceScope,
} from '@lantern/shared';
import type { Deck, Flashcard } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, FeatureDisc } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';

interface PlayStudioProps {
  decks: Deck[];
  flashcards: Flashcard[];
  onStartMatch: (deck: Deck) => void;
  onReviewMissed: (deck: Deck, cardIds: string[]) => void;
  /** Which container the student is standing in, so the copy names it. */
  scope?: WorkspaceScope;
}

export function PlayStudio({
  decks,
  flashcards,
  onStartMatch,
  onReviewMissed,
  scope = 'course',
}: PlayStudioProps) {
  const [deckId, setDeckId] = useState(decks[0]?.id || '');
  const [session, setSession] = useState<PlaySession | null>(null);
  const [remaining, setRemaining] = useState(PLAY_SECONDS);

  useEffect(() => {
    if (deckId && decks.some((deck) => deck.id === deckId)) return;
    setDeckId(decks[0]?.id || '');
  }, [deckId, decks]);

  const deck = decks.find((row) => row.id === deckId) ?? decks[0] ?? null;
  const cards = useMemo(
    () => playableCards(flashcards.filter((card) => card.deckId === deck?.id)),
    [flashcards, deck?.id]
  );
  const hubBlocker = playStudioBlocker(decks.length);
  const thinBlocker = playModeBlocker(cards);

  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    setRemaining(PLAY_SECONDS);
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setSession((current) => (current ? expirePlaySession(current) : current));
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.mode, session?.deckId, session?.status === 'playing' ? session.questions[0]?.cardId : '']);

  const startMode = (mode: PlayModeId) => {
    if (!deck) return;
    if (thinBlocker) return;
    if (mode === 'match') {
      onStartMatch(deck);
      return;
    }
    const next = startPlaySession({ mode, deckId: deck.id, deckName: deck.name, cards });
    if (!next) return;
    setSession(next);
  };

  if (session && session.status === 'playing') {
    const question = currentPlayQuestion(session);
    return (
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-heading">{session.mode === 'speed' ? 'Speed' : 'Define'}</h2>
          <p className="text-caption text-lantern-text-secondary">
            {remaining}s · {session.index + 1} of {session.questions.length}
          </p>
        </div>
        <p className="text-body">{question?.prompt}</p>
        <div className="grid gap-2">
          {(question?.options ?? []).map((option) => (
            <Button
              key={option}
              variant="secondary"
              onClick={() => setSession((current) => (current ? answerPlayQuestion(current, option) : current))}
            >
              {option}
            </Button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setSession(null)}>
          Back to Play
        </Button>
      </div>
    );
  }

  if (session && session.status === 'results') {
    const missedDeck = decks.find((row) => row.id === session.deckId);
    return (
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
        <h2 className="text-heading">Results</h2>
        <p className={`text-title ${FEATURE_INK_TEXT.flashcards}`}>{playScoreLine(session)}</p>
        <p className="text-caption text-lantern-text-secondary">{session.deckName}</p>
        {session.missedCardIds.length > 0 && missedDeck ? (
          <Button onClick={() => onReviewMissed(missedDeck, session.missedCardIds)}>
            {PLAY_REVIEW_COPY}
          </Button>
        ) : (
          <p className="text-body text-lantern-text-secondary">No missed cards this round.</p>
        )}
        <Button variant="secondary" onClick={() => setSession(null)}>
          Play again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
      <div>
        <h2 className="text-heading">Play</h2>
        <p className="text-body text-lantern-text-secondary mt-1">
          {playTaglineCopy(scope)}
        </p>
      </div>
      {hubBlocker ? (
        <p className="text-body text-lantern-text-secondary">{playBlockerCopy(hubBlocker, scope)}</p>
      ) : (
        <>
          {decks.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {decks.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setDeckId(row.id)}
                  aria-pressed={row.id === deck?.id}
                  className={`min-h-[44px] rounded-full border px-3 text-caption font-medium ${
                    row.id === deck?.id
                      ? `${FEATURE_TINT_BG.flashcards} ${FEATURE_INK_TEXT.flashcards} border-transparent`
                      : 'border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  {row.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2">
            {PLAY_MODES.map((mode) => {
              const blocked = thinBlocker;
              return (
                <button
                  key={mode.id}
                  type="button"
                  disabled={Boolean(blocked)}
                  onClick={() => startMode(mode.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-lantern-border text-left hover:bg-lantern-background-secondary disabled:opacity-60"
                >
                  <FeatureDisc feature="flashcards" icon={<AppIcon name="game-controller" size={20} />} />
                  <span>
                    <span className="text-body font-semibold block">{mode.label}</span>
                    <span className="text-caption text-lantern-text-secondary">
                      {blocked ? playBlockerCopy(blocked, scope) : mode.promise}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
