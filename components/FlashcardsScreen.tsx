
import React, { useRef, useState } from 'react';
import { Deck, Flashcard } from '../types';
import {
  RectangleStackIcon,
  PlusCircleIcon,
  AcademicCapIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { isCardDue, getDeckListStatsLine, getStudyCtaLabel, getStudyAllDueLabel } from '@lantern/shared';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { SkeletonCard, ScreenHeader, Button, EmptyState, Menu, MenuTrigger, MenuContent, MenuItem } from './ui';

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
  onOfflineToggle?: (deck: Deck, enable: boolean) => void;
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
  embedded = false,
}) => {
  const { isDeckOffline } = useFlashcardStore();
  // Deck bootstrap error contract (being added to the store by a parallel change):
  // `deckLoadError: string | null` and `retryDeckBootstrap(): void`. Read defensively so
  // this renders correctly whether or not the store fields exist yet at runtime.
  const deckLoadError = useFlashcardStore(
    (s) => ((s as unknown as { deckLoadError?: string | null }).deckLoadError ?? null)
  );
  const retryDeckBootstrap = useFlashcardStore(
    (s) => (s as unknown as { retryDeckBootstrap?: () => void }).retryDeckBootstrap
  );
  const openWithMessage = useCompanionStore(s => s.openWithMessage);
  const { lowDataMode } = useUIStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const isLoading = isInitialLoading;
  const validDecks = decks.filter((deck): deck is Deck => Boolean(deck?.id && deck?.name));

  const handleAIGenerate = () => {
    openWithMessage('Generate flashcards for my weak topics from recent tests and save them to a new deck.');
  };

  const getDeckStats = (deckId: string) => {
    const cardsInDeck = flashcards.filter(fc => fc.deckId === deckId);
    const dueCards = cardsInDeck.filter(fc => isCardDue(fc.srsData)).length;
    return { dueCards, totalCards: cardsInDeck.length };
  };

  const totalDueCount = flashcards.filter(fc => isCardDue(fc.srsData)).length;

  const handleOfflineToggle = (e: React.MouseEvent, deck: Deck) => {
    e.stopPropagation();
    const enable = !isDeckOffline(deck.id);
    onOfflineToggle?.(deck, enable);
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {onStartStudy && totalDueCount > 0 && (
        <Button variant="accent" size="sm" onClick={onStartStudy}>
          <AcademicCapIcon className="w-4 h-4" />
          {getStudyAllDueLabel(totalDueCount)}
        </Button>
      )}
      <Button size="sm" onClick={onOpenCreateDeck}>
        <PlusCircleIcon className="w-4 h-4" />
        New deck
      </Button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger aria-label="More actions" className="inline-flex items-center justify-center rounded-lantern px-3 py-2 text-sm font-medium bg-lantern-background-secondary text-lantern-text hover:bg-lantern-border/40">
          <EllipsisVerticalIcon className="w-4 h-4" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={onOpenCreateFlashcard}>New card</MenuItem>
          <MenuItem onSelect={handleAIGenerate} disabled={lowDataMode}>
            {lowDataMode ? 'AI Generate (Wi‑Fi)' : 'AI Generate'}
          </MenuItem>
          <MenuItem onSelect={() => importInputRef.current?.click()}>Import deck</MenuItem>
        </MenuContent>
      </Menu>
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
  );

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-y-auto ${embedded ? '' : 'bg-lantern-background text-lantern-text'}`}>
      {!embedded && (
        <div className="shrink-0 px-4 md:px-6 py-4 border-b border-lantern-border bg-lantern-surface">
          <ScreenHeader
            title="Flashcard Decks"
            subtitle={`${validDecks.length} deck${validDecks.length !== 1 ? 's' : ''} · ${flashcards.length} card${flashcards.length !== 1 ? 's' : ''} total`}
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
        ) : validDecks.length > 0 ? (
          <>
          {deckLoadError && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
            >
              <span className="flex items-center gap-2 min-w-0">
                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" aria-hidden />
                Couldn&apos;t refresh your decks — showing what&apos;s saved on this device.
              </span>
              {retryDeckBootstrap && (
                <Button size="sm" variant="secondary" onClick={() => retryDeckBootstrap()}>
                  Retry
                </Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {validDecks.map((deck, index) => {
              const { dueCards, totalCards } = getDeckStats(deck.id);
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
                    </div>
                  </div>

                  <div className="p-4 flex-grow flex flex-col">
                    <p
                      className="text-sm text-lantern-text-secondary line-clamp-2 mb-2 flex-grow cursor-pointer"
                      onClick={() => onSelectDeck(deck)}
                    >
                      {deck.description || 'No description'}
                    </p>
                    <p className="text-xs text-lantern-text-secondary mb-4">
                      {getDeckListStatsLine(dueCards, totalCards)}
                    </p>
                    {onStudyDeck && (
                      <Button
                        variant="accent"
                        size="sm"
                        fullWidth
                        onClick={(e) => {
                          e.stopPropagation();
                          onStudyDeck(deck);
                        }}
                      >
                        <AcademicCapIcon className="w-4 h-4" />
                        {getStudyCtaLabel(dueCards, totalCards)}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        ) : deckLoadError ? (
          <div
            role="alert"
            className="max-w-md mx-auto mt-8 rounded-2xl border border-lantern-border bg-lantern-surface p-6 text-center space-y-3"
          >
            <ExclamationTriangleIcon className="w-8 h-8 mx-auto text-amber-500" aria-hidden />
            <p className="font-semibold text-lantern-text">Couldn&apos;t load your decks</p>
            <p className="text-sm text-lantern-text-secondary">{deckLoadError}</p>
            {retryDeckBootstrap && (
              <Button variant="primary" onClick={() => retryDeckBootstrap()}>
                Retry
              </Button>
            )}
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
