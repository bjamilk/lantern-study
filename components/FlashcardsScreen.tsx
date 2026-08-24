
import React, { useEffect, useRef, useState } from 'react';
import { Deck, Flashcard } from '../types';
import { useAuthStore } from '../stores/authStore';
import { fetchDecks } from '../services/supabase';
import { CourseChips } from './academic/CourseChips';
import { TopicFilterChip } from './academic/TopicFilterChip';
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
import { useLibraryStore } from '../stores/libraryStore';
import { UNFILED_COURSE_ID, matchesCourseFilter, matchesTopicFilter } from '../utils/libraryArchive';
import { MoveToCourseModal } from './academic/MoveToCourseModal';
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
  /** "Move to course…" on a deck card (PUT /decks/:id { courseId }). Rejections surface in the dialog. */
  onMoveDeckToCourse?: (deck: Deck, courseId: string | null, topicId: string | null) => void | Promise<void>;
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
  onMoveDeckToCourse,
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
  // Course chip filter (Phase 1): the archive-wide selection lives in the
  // library store (the Library rail sets it too); `GET /decks?courseId=`
  // decides which decks show — `'null'` asks for unfiled decks — while the
  // store keeps the full list for every other surface.
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  const courseFilterId = useLibraryStore((s) => s.courseFilterId);
  // Topic narrows the same list one level further (`GET /decks?courseId&topicId`).
  const topicFilterId = useLibraryStore((s) => s.topicFilterId);
  const setCourseFilterId = useLibraryStore((s) => s.setCourseFilter);
  const [courseDeckIds, setCourseDeckIds] = useState<Set<string> | null>(null);
  const [courseFilterLoading, setCourseFilterLoading] = useState(false);
  const [movingDeck, setMovingDeck] = useState<Deck | null>(null);
  const [deckMenuId, setDeckMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!courseFilterId || !currentUserId) {
      setCourseDeckIds(null);
      setCourseFilterLoading(false);
      return;
    }
    let cancelled = false;
    setCourseFilterLoading(true);
    void fetchDecks(currentUserId, { includeShared: true, courseId: courseFilterId, topicId: topicFilterId })
      .then((rows) => {
        if (cancelled) return;
        setCourseDeckIds(new Set((rows || []).map((d: { id: string }) => d.id)));
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to the deck rows already in the store.
        setCourseDeckIds(new Set(decks
          .filter((d) => matchesCourseFilter(d?.courseId, courseFilterId) && matchesTopicFilter(d?.topicId, topicFilterId))
          .map((d) => d.id)));
      })
      .finally(() => {
        if (!cancelled) setCourseFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseFilterId, topicFilterId, currentUserId]);
  const validDecks = decks
    .filter((deck): deck is Deck => Boolean(deck?.id && deck?.name))
    .filter((deck) => {
      if (!courseFilterId) return true;
      if (courseDeckIds) {
        // Server answer wins; a deck the store already files under this course
        // (just created / just moved) shows without waiting for a refetch.
        // Server answer wins; a deck the store already files here (just
        // created / just moved) shows without waiting for a refetch — but only
        // if it also matches the topic, or picking a topic would show it back.
        if (courseDeckIds.has(deck.id)) return true;
        return (
          courseFilterId !== UNFILED_COURSE_ID &&
          deck.courseId === courseFilterId &&
          matchesTopicFilter(deck.topicId, topicFilterId)
        );
      }
      // No server answer yet: nothing while loading (skeleton), best effort after a failure.
      return courseFilterLoading
        ? false
        : matchesCourseFilter(deck.courseId, courseFilterId) && matchesTopicFilter(deck.topicId, topicFilterId);
    });

  const handleMoveDeck = async (deck: Deck, courseId: string | null, topicId: string | null = null) => {
    if (!onMoveDeckToCourse) return;
    const nextTopicId = courseId ? topicId : null;
    await onMoveDeckToCourse(deck, courseId, nextTopicId);
    // Keep the filtered view honest without a refetch.
    setCourseDeckIds((prev) => {
      if (!prev || !courseFilterId) return prev;
      const next = new Set(prev);
      if (matchesCourseFilter(courseId, courseFilterId) && matchesTopicFilter(nextTopicId, topicFilterId)) next.add(deck.id);
      else next.delete(deck.id);
      return next;
    });
  };

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
        {/* The chips name the course; the topic gets its own chip, or the list
            is shorter than anything on screen explains. */}
        <div className="mb-4 flex flex-col gap-1.5">
          <CourseChips
            value={courseFilterId}
            onChange={setCourseFilterId}
            ariaLabel="Filter decks by course"
            showUnfiled
          />
          <TopicFilterChip />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : courseFilterId && courseFilterLoading && validDecks.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : courseFilterId && validDecks.length === 0 ? (
          <EmptyState
            icon={<RectangleStackIcon className="w-8 h-8" />}
            title={courseFilterId === UNFILED_COURSE_ID ? 'No unfiled decks' : 'No decks for this course yet'}
            description={
              courseFilterId === UNFILED_COURSE_ID
                ? 'Every deck is filed under a course. Pick All to see them.'
                : 'Create a deck and file it under this course, or pick All to see every deck.'
            }
            actionLabel="Create deck"
            onAction={onOpenCreateDeck}
            secondaryActionLabel="Show all decks"
            onSecondaryAction={() => setCourseFilterId(null)}
          />
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
                      {onMoveDeckToCourse ? (
                        <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                          <Menu
                            open={deckMenuId === deck.id}
                            onOpenChange={(open) => setDeckMenuId(open ? deck.id : null)}
                          >
                            <MenuTrigger
                              aria-label={`Deck options for ${deck.name}`}
                              className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors inline-flex items-center justify-center"
                            >
                              <EllipsisVerticalIcon className="w-4 h-4" />
                            </MenuTrigger>
                            <MenuContent align="end" className="w-48">
                              <MenuItem onSelect={() => setMovingDeck(deck)}>
                                <span className="inline-flex items-center gap-2">
                                  <AcademicCapIcon className="w-4 h-4" /> Move to course…
                                </span>
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        </div>
                      ) : null}
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
      {onMoveDeckToCourse ? (
        <MoveToCourseModal
          isOpen={Boolean(movingDeck)}
          onClose={() => setMovingDeck(null)}
          currentCourseId={movingDeck?.courseId ?? null}
          currentTopicId={movingDeck?.topicId ?? null}
          title={movingDeck ? `Move “${movingDeck.name}” to course` : 'Move deck to course'}
          onSubmit={(courseId, topicId) => (movingDeck ? handleMoveDeck(movingDeck, courseId, topicId) : undefined)}
        />
      ) : null}
    </div>
  );
};

export default FlashcardsScreen;
