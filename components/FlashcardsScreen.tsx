
import React, { useEffect, useRef, useState } from 'react';
import { Deck, Flashcard } from '../types';
import {
  RectangleStackIcon,
  PlusCircleIcon,
  ArrowUpTrayIcon,
  AcademicCapIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  SparklesIcon,
  EllipsisVerticalIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { SkeletonCard, ScreenHeader, Button, EmptyState } from './ui';

interface FlashcardsScreenProps {
  decks: Deck[];
  flashcards: Flashcard[];
  isInitialLoading?: boolean;
  onOpenCreateDeck: () => void;
  onOpenCreateFlashcard: () => void;
  onSelectDeck: (deck: Deck) => void;
  onImportDeck: (file: File) => void;
  onStartStudy?: () => void;
  onStudyDeck?: (deck: Deck) => void;
  onOfflineToggle?: (deck: Deck, isOffline: boolean) => void;
  onExportDeck?: (deckId: string, format: 'json' | 'csv') => void;
  embedded?: boolean;
}

const ACCENT_GRADIENTS = [
  'from-rose-500 via-pink-500 to-fuchsia-500',
  'from-fuchsia-500 via-rose-500 to-red-500',
  'from-pink-500 via-rose-400 to-orange-400',
  'from-rose-400 via-red-400 to-amber-400',
  'from-red-500 via-rose-500 to-pink-500',
  'from-orange-400 via-rose-500 to-fuchsia-500',
];

const FlashcardsScreen: React.FC<FlashcardsScreenProps> = ({
  decks,
  flashcards,
  isInitialLoading = false,
  onOpenCreateDeck,
  onOpenCreateFlashcard,
  onSelectDeck,
  onImportDeck,
  onStartStudy,
  onStudyDeck,
  onOfflineToggle,
  onExportDeck,
  embedded = false,
}) => {
  const { isDeckOffline, markDeckOffline, unmarkDeckOffline } = useFlashcardStore();
  const openWithMessage = useCompanionStore(s => s.openWithMessage);
  const { lowDataMode } = useUIStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const isLoading = isInitialLoading;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const handleAIGenerate = () => {
    setMenuOpen(false);
    openWithMessage('Generate flashcards for my weak topics from recent tests and save them to a new deck.');
  };

  const getDeckStats = (deckId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const cardsInDeck = flashcards.filter(fc => fc.deckId === deckId);
    const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions).length;
    const dueCards = cardsInDeck.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length;
    return { newCards, dueCards, totalCards: cardsInDeck.length };
  };

  const handleOfflineToggle = (e: React.MouseEvent, deck: Deck) => {
    e.stopPropagation();
    const offline = isDeckOffline(deck.id);
    if (offline) {
      unmarkDeckOffline(deck.id);
      onOfflineToggle?.(deck, false);
    } else {
      markDeckOffline(deck.id);
      onOfflineToggle?.(deck, true);
    }
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {onStartStudy && (
        <Button variant="accent" size="sm" onClick={onStartStudy}>
          <AcademicCapIcon className="w-4 h-4" />
          Study due
        </Button>
      )}
      <Button size="sm" onClick={onOpenCreateDeck}>
        <PlusCircleIcon className="w-4 h-4" />
        New deck
      </Button>
      <div className="relative" ref={menuRef}>
        <Button variant="secondary" size="sm" onClick={() => setMenuOpen(v => !v)} aria-label="More actions">
          <EllipsisVerticalIcon className="w-4 h-4" />
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-lantern-border bg-lantern-surface shadow-lg z-20 py-1">
            <button type="button" onClick={() => { setMenuOpen(false); onOpenCreateFlashcard(); }} className="w-full text-left px-4 py-2.5 text-sm text-lantern-text hover:bg-lantern-background-secondary">
              New card
            </button>
            <button type="button" onClick={handleAIGenerate} disabled={lowDataMode} className="w-full text-left px-4 py-2.5 text-sm text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-50">
              {lowDataMode ? 'AI Generate (Wi‑Fi)' : 'AI Generate'}
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); importInputRef.current?.click(); }}
              className="w-full text-left px-4 py-2.5 text-sm text-lantern-text hover:bg-lantern-background-secondary"
            >
              Import deck
            </button>
          </div>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.csv,.apkg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportDeck(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-y-auto ${embedded ? '' : 'bg-lantern-background text-lantern-text'}`}>
      {!embedded && (
        <div className="shrink-0 px-4 md:px-6 py-4 border-b border-lantern-border bg-lantern-surface">
          <ScreenHeader
            title="Flashcard Decks"
            subtitle={`${decks.length} deck${decks.length !== 1 ? 's' : ''} · ${flashcards.length} card${flashcards.length !== 1 ? 's' : ''} total`}
            icon={<RectangleStackIcon className="w-6 h-6" />}
            actions={headerActions}
          />
        </div>
      )}

      <div className="p-4 md:p-6 flex-1">
        {embedded && (
          <div className="flex justify-end mb-4">{headerActions}</div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : decks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {decks.map((deck, index) => {
              if (!deck) return null;
              const { newCards, dueCards, totalCards } = getDeckStats(deck.id);
              const hasDueCards = dueCards > 0;
              const gradient = ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length];
              return (
                <div
                  key={deck.id}
                  className="rounded-2xl shadow-md hover:shadow-xl flex flex-col overflow-hidden border border-lantern-border bg-lantern-surface group"
                >
                  <div
                    className={`relative h-14 bg-gradient-to-r ${gradient} px-4 flex items-center justify-between cursor-pointer`}
                    onClick={() => onSelectDeck(deck)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <RectangleStackIcon className="w-5 h-5 text-white/90 flex-shrink-0" />
                      <h2 className="text-sm font-bold text-white truncate drop-shadow-sm">{deck.name}</h2>
                      {deck.isShared && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white/90 bg-white/20 px-1.5 py-0.5 rounded flex-shrink-0">
                          Shared
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {hasDueCards && (
                        <span className="bg-white/25 backdrop-blur-sm text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          {dueCards} due
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleOfflineToggle(e, deck)}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                        title={isDeckOffline(deck.id) ? 'Remove from offline' : 'Save for offline'}
                      >
                        {isDeckOffline(deck.id) ? (
                          <CloudArrowUpIcon className="w-4 h-4" />
                        ) : (
                          <CloudArrowDownIcon className="w-4 h-4" />
                        )}
                      </button>
                      {onExportDeck && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportDeck(deck.id, 'json');
                          }}
                          className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                          title="Export deck (JSON)"
                          aria-label={`Export ${deck.name}`}
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-4 flex-grow flex flex-col">
                    <p
                      className="text-sm text-lantern-text-secondary line-clamp-2 mb-4 flex-grow cursor-pointer"
                      onClick={() => onSelectDeck(deck)}
                    >
                      {deck.description || `${totalCards} card${totalCards !== 1 ? 's' : ''} in this deck`}
                    </p>
                    <div className="flex gap-2 text-xs mb-3">
                      <div className="flex-1 bg-lantern-primary-background border border-lantern-border rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-lantern-primary leading-none">{newCards}</p>
                        <p className="text-lantern-text-secondary mt-1">New</p>
                      </div>
                      <div className="flex-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/50 rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-emerald-600 dark:text-emerald-400 leading-none">{dueCards}</p>
                        <p className="text-lantern-text-secondary mt-1">Due</p>
                      </div>
                      <div className="flex-1 bg-lantern-background-secondary border border-lantern-border rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-lantern-text leading-none">{totalCards}</p>
                        <p className="text-lantern-text-secondary mt-1">Total</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(hasDueCards || onStudyDeck) && (
                        <Button
                          variant="accent"
                          size="sm"
                          fullWidth
                          className="flex-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onStudyDeck) onStudyDeck(deck);
                            else onSelectDeck(deck);
                          }}
                        >
                          <AcademicCapIcon className="w-4 h-4" />
                          {hasDueCards ? 'Study due' : 'Study'}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => onSelectDeck(deck)}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<RectangleStackIcon className="w-8 h-8" />}
            title="No flashcard decks yet"
            description="Create a deck to start adding flashcards and supercharge your learning."
            actionLabel="Create your first deck"
            onAction={onOpenCreateDeck}
            secondaryActionLabel="Import deck"
            onSecondaryAction={() => importInputRef.current?.click()}
          />
        )}
      </div>
    </div>
  );
};

export default FlashcardsScreen;
