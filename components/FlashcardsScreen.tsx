

import React from 'react';
import { Deck, Flashcard } from '../types';
import { RectangleStackIcon, PlusCircleIcon, PlayCircleIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, AcademicCapIcon, CloudArrowDownIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import { useFlashcardStore } from '../stores/flashcardStore';

interface FlashcardsScreenProps {
  decks: Deck[];
  flashcards: Flashcard[];
  onOpenCreateDeck: () => void;
  onOpenCreateFlashcard: () => void;
  onSelectDeck: (deck: Deck) => void;
  onExportDeck: (deckId: string) => void;
  onImportDeck: (file: File) => void;
  onStartStudy?: () => void;
}

const FlashcardsScreen: React.FC<FlashcardsScreenProps> = ({ decks, flashcards, onOpenCreateDeck, onOpenCreateFlashcard, onSelectDeck, onExportDeck, onImportDeck, onStartStudy }) => {
  const { offlineDeckIds, isDeckOffline, markDeckOffline, unmarkDeckOffline } = useFlashcardStore();

  const getDeckStats = (deckId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const cardsInDeck = flashcards.filter(fc => fc.deckId === deckId);
    
    const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions).length;
    const dueCards = cardsInDeck.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length;
    
    return { newCards, dueCards, totalCards: cardsInDeck.length };
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 overflow-y-auto">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 md:px-6 py-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center mr-3">
              <RectangleStackIcon className="w-6 h-6 text-rose-600 dark:text-rose-400" />
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
            <label className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg flex items-center text-sm cursor-pointer transition-colors">
              <ArrowUpTrayIcon className="w-4 h-4 mr-1.5" /> Import
              <input
                type="file"
                accept=".json"
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
        {decks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {decks.map(deck => {
              if (!deck) return null;
              const { newCards, dueCards, totalCards } = getDeckStats(deck.id);
              const hasDueCards = dueCards > 0;
              return (
                <div 
                  key={deck.id} 
                  className="bg-white dark:bg-slate-800 rounded-xl shadow-sm flex flex-col cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all border border-slate-200 dark:border-slate-700 group"
                  onClick={() => onSelectDeck(deck)}
                >
                  <div className="p-4 flex-grow">
                    <div className="flex items-start justify-between">
                              <div className="flex items-center">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{deck.name}</h2>
                          {deck.isShared && (
                            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-200 bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full">
                              Shared
                            </span>
                          )}
                        </div>
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
                          className="ml-2 focus:outline-none"
                        >
                          {isDeckOffline(deck.id) ? (
                            <CloudArrowUpIcon className="w-5 h-5 text-indigo-600" />
                          ) : (
                            <CloudArrowDownIcon className="w-5 h-5 text-slate-400" />
                          )}
                        </button>
                      </div>
                      {hasDueCards && (
                        <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
                          {dueCards} due
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-2">{deck.description || `${totalCards} card${totalCards !== 1 ? 's' : ''}`}</p>
                  </div>
                  <div className="px-4 pb-4">
                    <div className="flex gap-3 text-xs mb-3">
                      <div className="flex-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2 text-center">
                        <p className="font-bold text-indigo-600 dark:text-indigo-400">{newCards}</p>
                        <p className="text-slate-500 dark:text-slate-400">New</p>
                      </div>
                      <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center">
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">{dueCards}</p>
                        <p className="text-slate-500 dark:text-slate-400">Due</p>
                      </div>
                      <div className="flex-1 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
                        <p className="font-bold text-slate-600 dark:text-slate-300">{totalCards}</p>
                        <p className="text-slate-500 dark:text-slate-400">Total</p>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportDeck(deck.id);
                      }}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg flex items-center justify-center text-xs transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-3.5 h-3.5 mr-1.5" /> Export Deck
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="w-16 h-16 rounded-2xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-4">
              <RectangleStackIcon className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-200 mb-2">No Flashcard Decks Yet</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">Create a deck to start adding flashcards and supercharge your learning.</p>
            <button onClick={onOpenCreateDeck} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 text-sm font-medium transition-colors">
              Create Your First Deck
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlashcardsScreen;