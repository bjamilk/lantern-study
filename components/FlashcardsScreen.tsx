
import React from 'react';
import { Deck, Flashcard } from '../types';
import { RectangleStackIcon, PlusCircleIcon, ArrowUpTrayIcon, AcademicCapIcon, CloudArrowDownIcon, CloudArrowUpIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { SkeletonCard } from './ui';

interface FlashcardsScreenProps {
  decks: Deck[];
  flashcards: Flashcard[];
  isInitialLoading?: boolean;
  onOpenCreateDeck: () => void;
  onOpenCreateFlashcard: () => void;
  onSelectDeck: (deck: Deck) => void;
  onImportDeck: (file: File) => void;
  onStartStudy?: () => void;
}

const ACCENT_GRADIENTS = [
  'from-indigo-500 via-violet-500 to-rose-500',
  'from-rose-500 via-orange-400 to-amber-500',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-blue-500 via-indigo-500 to-purple-500',
  'from-fuchsia-500 via-pink-500 to-rose-500',
  'from-amber-500 via-orange-500 to-red-500',
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
}) => {
  const { isDeckOffline, markDeckOffline, unmarkDeckOffline } = useFlashcardStore();
  const openWithMessage = useCompanionStore(s => s.openWithMessage);
  const { lowDataMode } = useUIStore();
  const isLoading = isInitialLoading;

  const handleAIGenerate = () => {
    openWithMessage('Generate flashcards for my weak topics from recent tests and save them to a new deck.');
  };

  const getDeckStats = (deckId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const cardsInDeck = flashcards.filter(fc => fc.deckId === deckId);

    const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions).length;
    const dueCards = cardsInDeck.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length;

    return { newCards, dueCards, totalCards: cardsInDeck.length };
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 overflow-y-auto">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 md:px-6 py-4 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center mr-3 shadow-md">
              <RectangleStackIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">Flashcard Decks</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">{decks.length} deck{decks.length !== 1 ? 's' : ''} &middot; {flashcards.length} card{flashcards.length !== 1 ? 's' : ''} total</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {onStartStudy && (
              <button onClick={onStartStudy} className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center text-sm shadow-sm transition-colors">
                <AcademicCapIcon className="w-4 h-4 mr-1.5" /> Study
              </button>
            )}
            <button onClick={onOpenCreateDeck} className="px-2.5 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg flex items-center text-sm shadow-sm transition-colors">
              <PlusCircleIcon className="w-4 h-4 mr-1.5" /> New Deck
            </button>
            <button onClick={onOpenCreateFlashcard} className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center text-sm shadow-sm transition-colors">
              <PlusCircleIcon className="w-4 h-4 mr-1.5" /> New Card
            </button>
            <button onClick={handleAIGenerate} className="px-2.5 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg flex items-center text-sm shadow-sm transition-colors" title="Ask Lantern AI to generate flashcards for your weak topics" disabled={lowDataMode}>
              <SparklesIcon className="w-4 h-4 mr-1.5" /> {lowDataMode ? 'AI (Wi‑Fi)' : 'AI Generate'}
            </button>
            <label className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center text-sm cursor-pointer transition-colors border border-slate-300 dark:border-slate-700">
              <ArrowUpTrayIcon className="w-4 h-4 mr-1.5" /> Import
              <input
                type="file"
                accept=".json,.csv,.apkg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportDeck(file);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6">
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
                  className="rounded-2xl shadow-md hover:shadow-xl flex flex-col cursor-pointer hover:-translate-y-1 transition-all duration-200 overflow-hidden border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 group"
                  onClick={() => onSelectDeck(deck)}
                >
                  {/* Gradient accent band */}
                  <div className={`relative h-14 bg-gradient-to-r ${gradient} px-4 flex items-center justify-between`}>
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
                        onClick={e => {
                          e.stopPropagation();
                          if (isDeckOffline(deck.id)) {
                            unmarkDeckOffline(deck.id);
                            alert('Deck removed from offline storage');
                          } else {
                            markDeckOffline(deck.id);
                            alert('Deck downloaded for offline use');
                          }
                        }}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
                        title={isDeckOffline(deck.id) ? 'Remove from offline' : 'Save for offline'}
                      >
                        {isDeckOffline(deck.id) ? (
                          <CloudArrowUpIcon className="w-4 h-4" />
                        ) : (
                          <CloudArrowDownIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 flex-grow flex flex-col">
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 flex-grow">
                      {deck.description || `${totalCards} card${totalCards !== 1 ? 's' : ''} in this deck`}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <div className="flex-1 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-indigo-600 dark:text-indigo-400 leading-none">{newCards}</p>
                        <p className="text-slate-500 dark:text-slate-400 mt-1">New</p>
                      </div>
                      <div className="flex-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/50 rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-emerald-600 dark:text-emerald-400 leading-none">{dueCards}</p>
                        <p className="text-slate-500 dark:text-slate-400 mt-1">Due</p>
                      </div>
                      <div className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-2 text-center">
                        <p className="font-bold text-lg text-slate-700 dark:text-slate-300 leading-none">{totalCards}</p>
                        <p className="text-slate-500 dark:text-slate-400 mt-1">Total</p>
                      </div>
                    </div>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-3 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                      Open deck →
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-rose-500" />
            <div className="px-6 py-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <RectangleStackIcon className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">No Flashcard Decks Yet</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">Create a deck to start adding flashcards and supercharge your learning.</p>
              <button onClick={onOpenCreateDeck} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 text-sm font-medium transition-colors shadow-md">
                Create Your First Deck
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlashcardsScreen;
