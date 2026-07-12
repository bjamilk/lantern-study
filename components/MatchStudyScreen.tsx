import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flashcard } from '../types';
import { shuffleArray } from '../utils/helpers';
import { Button } from './ui';
import { XMarkIcon, ClockIcon } from '@heroicons/react/24/outline';

interface MatchStudyScreenProps {
  cards: Flashcard[];
  deckName: string;
  onExit: () => void;
  theme?: 'light' | 'dark';
}

interface MatchTile {
  id: string;
  cardId: string;
  text: string;
  side: 'front' | 'back';
  matched: boolean;
}

export const MatchStudyScreen: React.FC<MatchStudyScreenProps> = ({
  cards,
  deckName,
  onExit,
  theme = 'light',
}) => {
  const [tiles, setTiles] = useState<MatchTile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongPair, setWrongPair] = useState<string[]>([]);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const isDark = theme === 'dark';

  const basicCards = useMemo(
    () => cards.filter((c) => c.type === 'BASIC' && c.front && c.back).slice(0, 6),
    [cards]
  );

  useEffect(() => {
    const newTiles: MatchTile[] = [];
    basicCards.forEach((card) => {
      newTiles.push({ id: `${card.id}-f`, cardId: card.id, text: card.front!, side: 'front', matched: false });
      newTiles.push({ id: `${card.id}-b`, cardId: card.id, text: card.back!, side: 'back', matched: false });
    });
    setTiles(shuffleArray(newTiles));
  }, [basicCards]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const matchedCount = tiles.filter((t) => t.matched).length / 2;
  const totalPairs = basicCards.length;
  const isComplete = matchedCount === totalPairs && totalPairs > 0;

  const handleTileClick = useCallback((tileId: string) => {
    const tile = tiles.find((t) => t.id === tileId);
    if (!tile || tile.matched || wrongPair.length > 0) return;

    if (!selected) {
      setSelected(tileId);
      return;
    }

    if (selected === tileId) {
      setSelected(null);
      return;
    }

    const first = tiles.find((t) => t.id === selected)!;
    if (first.cardId === tile.cardId && first.side !== tile.side) {
      setTiles((prev) => prev.map((t) => (t.cardId === tile.cardId ? { ...t, matched: true } : t)));
      setSelected(null);
    } else {
      setWrongPair([selected, tileId]);
      setTimeout(() => {
        setWrongPair([]);
        setSelected(null);
      }, 600);
    }
  }, [selected, tiles, wrongPair]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (basicCards.length < 2) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 ${isDark ? 'bg-lantern-background' : 'bg-lantern-background'}`}>
        <p className="text-lantern-text-secondary mb-4">Need at least 2 basic flashcards for Match mode.</p>
        <Button onClick={onExit}>Go back</Button>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col ${isDark ? 'bg-lantern-background text-lantern-text' : 'bg-lantern-background text-lantern-text'}`}>
      <div className="flex items-center justify-between p-4 border-b border-lantern-border">
        <div>
          <h1 className="font-bold text-lg">Match — {deckName}</h1>
          <p className="text-sm text-lantern-text-secondary">{matchedCount}/{totalPairs} pairs · <ClockIcon className="w-3 h-3 inline" /> {formatTime(elapsed)}</p>
        </div>
        <button onClick={onExit} className="p-2 rounded-lg hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {isComplete ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold mb-2">All matched!</h2>
          <p className="text-lantern-text-secondary mb-6">Completed in {formatTime(elapsed)}</p>
          <Button onClick={onExit}>Done</Button>
        </div>
      ) : (
        <div className="flex-1 p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 content-start overflow-y-auto">
          {tiles.map((tile) => {
            const isSelected = selected === tile.id || wrongPair.includes(tile.id);
            const isWrong = wrongPair.includes(tile.id);
            return (
              <button
                key={tile.id}
                onClick={() => handleTileClick(tile.id)}
                disabled={tile.matched}
                className={`p-4 rounded-xl border-2 text-sm font-medium min-h-[80px] flex items-center justify-center text-center transition-all ${
                  tile.matched
                    ? 'opacity-0 pointer-events-none scale-95'
                    : isWrong
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20 shake'
                    : isSelected
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : `${isDark ? 'border-lantern-border bg-lantern-surface hover:border-lantern-primary' : 'border-lantern-border bg-lantern-surface hover:border-lantern-primary/30'}`
                }`}
              >
                {tile.text}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MatchStudyScreen;
