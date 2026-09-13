
import React, { useEffect, useRef, useState } from 'react';
import { Deck, Flashcard } from '../types';
import { useAuthStore } from '../stores/authStore';
import { fetchDecks } from '../services/supabase';
import { CourseChips, useCourseFilterShownAbove } from './academic/CourseChips';
import { TopicFilterChip } from './academic/TopicFilterChip';
import { useLibraryPanelSearch } from './library/libraryPanelSearch';
import { AppIcon } from './ui/AppIcon';
import {
  isCardDue,
  getDeckListStatsLine,
  getStudyCtaLabel,
  getStudyAllDueLabel,
  deckDisplayTitle,
  deckDisplaySubtitle,
  isLibraryFlashcardDeck,
  sortDecksForList,
} from '@lantern/shared';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { useLibraryStore } from '../stores/libraryStore';
import { UNFILED_COURSE_ID, matchesCourseFilter, matchesTopicFilter } from '../utils/libraryArchive';
import { MoveToCourseModal } from './academic/MoveToCourseModal';
import { ImportCardsModal } from './flashcards/ImportCardsModal';
import {
  SkeletonCard,
  ScreenHeader,
  Button,
  EmptyState,
  FeatureDisc,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
} from './ui';
import { CoverMenuItems, CoverPickerDialog, CoverThumb } from './ui/CoverPicker';
import { coverErrorMessage } from './ui/coverPickerModel';
import { removeCover } from '../stores/coverActions';
import { useToastStore } from '../stores/toastStore';

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
  // Inside the Library the rail and the scope row own the course/topic filter.
  const filterShownAbove = useCourseFilterShownAbove();
  // …and the Library's search box narrows this list in place. Empty outside the
  // Library, where this screen has no text search of its own.
  const panelSearch = useLibraryPanelSearch().trim();
  const panelQuery = panelSearch.toLowerCase();
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
  // The zero-credit door: text export in, cards out, no AI use spent.
  const [importCardsOpen, setImportCardsOpen] = useState(false);
  const [deckMenuId, setDeckMenuId] = useState<string | null>(null);
  // The deck whose cover the picker is editing. Held here, not inside the row
  // menu, because the menu unmounts the moment an item is chosen.
  const [coverDeck, setCoverDeck] = useState<Deck | null>(null);
  const showToast = useToastStore((s) => s.showToast);
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

  // Card text as well as the deck's own name: a student searching "enzyme"
  // means the cards, and those are already on this device — so this keeps
  // working when the server search cannot run at all.
  const visibleDecks = panelQuery
    ? validDecks.filter(
        (deck) =>
          deck.name.toLowerCase().includes(panelQuery) ||
          Boolean(deck.description && deck.description.toLowerCase().includes(panelQuery)) ||
          flashcards.some(
            (fc) =>
              fc.deckId === deck.id &&
              ((fc.front || '').toLowerCase().includes(panelQuery) ||
                (fc.back || '').toLowerCase().includes(panelQuery) ||
                (fc.clozeText || '').toLowerCase().includes(panelQuery))
          )
      )
    : validDecks;

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

  const handleRemoveCover = async (deck: Deck) => {
    try {
      await removeCover('deck', deck.id);
    } catch (err) {
      showToast(coverErrorMessage(err).message, 'error');
    }
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

  const listedDecks = sortDecksForList(
    visibleDecks
      .map((deck) => {
        const { dueCards, totalCards } = getDeckStats(deck.id);
        return { ...deck, due_count: dueCards, card_count: totalCards };
      })
      .filter((deck) => isLibraryFlashcardDeck(deck))
  );

  // List-row cards: one column on the phone, two from lg up. A third column
  // crushed the FeatureDisc + due pill anatomy.
  const deckGridClass = 'grid gap-3 grid-cols-1 lg:grid-cols-2';

  const handleOfflineToggle = (e: React.MouseEvent, deck: Deck) => {
    e.stopPropagation();
    const enable = !isDeckOffline(deck.id);
    onOfflineToggle?.(deck, enable);
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {onStartStudy && totalDueCount > 0 && (
        <Button variant="accent" size="sm" onClick={onStartStudy}>
          <AppIcon name="school" size={16} />
          {getStudyAllDueLabel(totalDueCount)}
        </Button>
      )}
      <Button size="sm" onClick={onOpenCreateDeck}>
        <AppIcon name="add-circle" size={16} />
        New deck
      </Button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger aria-label="More actions" className="inline-flex items-center justify-center rounded-lantern px-3 py-2 text-sm font-medium bg-lantern-background-secondary text-lantern-text hover:bg-lantern-border/40">
          <AppIcon name="ellipsis-vertical" size={16} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={onOpenCreateFlashcard}>New card</MenuItem>
          <MenuItem onSelect={handleAIGenerate} disabled={lowDataMode}>
            {lowDataMode ? 'AI Generate (Wi‑Fi)' : 'AI Generate'}
          </MenuItem>
          <MenuItem onSelect={() => setImportCardsOpen(true)}>Import cards (free)</MenuItem>
          <MenuItem onSelect={() => importInputRef.current?.click()}>Import deck file</MenuItem>
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
            icon={<AppIcon name="albums" size={24} />}
            actions={headerActions}
          />
        </div>
      )}

      <div className={`flex-1 ${embedded ? 'p-3 md:p-4' : 'p-4 md:p-6'}`}>
        {embedded && (
          <div className="flex justify-end mb-2">{headerActions}</div>
        )}
        {/* The chips name the course; the topic gets its own chip, or the list
            is shorter than anything on screen explains. Both render nothing
            inside the Library, so the row itself has to take no space there. */}
        <div className={filterShownAbove ? '' : 'mb-4 flex flex-col gap-1.5'}>
          <CourseChips
            value={courseFilterId}
            onChange={setCourseFilterId}
            ariaLabel="Filter decks by course"
            showUnfiled
          />
          <TopicFilterChip />
        </div>

        {isLoading ? (
          <div className={deckGridClass}>
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : courseFilterId && courseFilterLoading && validDecks.length === 0 ? (
          <div className={deckGridClass}>
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : panelQuery && visibleDecks.length === 0 ? (
          // Ahead of the course-filter and first-run empty states: with a query
          // typed, "No decks yet" would read as if the decks had vanished.
          <EmptyState
            icon={<AppIcon name="search" size={32} />}
            title={`No decks match “${panelSearch}”`}
            description="This searches the deck names and the cards saved on this device. “Search everything” above also covers other decks, cards and offline bundles."
          />
        ) : courseFilterId && visibleDecks.length === 0 ? (
          <EmptyState
            icon={<AppIcon name="albums" size={32} />}
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
        ) : visibleDecks.length > 0 ? (
          <>
          {deckLoadError && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
            >
              <span className="flex items-center gap-2 min-w-0">
                <AppIcon name="warning" size={16} className="flex-shrink-0" aria-hidden />
                Couldn&apos;t refresh your decks — showing what&apos;s saved on this device.
              </span>
              {retryDeckBootstrap && (
                <Button size="sm" variant="secondary" onClick={() => retryDeckBootstrap()}>
                  Retry
                </Button>
              )}
            </div>
          )}
          <div className={deckGridClass}>
            {listedDecks.map((deck) => {
              const dueCards = deck.due_count ?? 0;
              const totalCards = deck.card_count ?? 0;
              const title = deckDisplayTitle(deck);
              const subtitle = deckDisplaySubtitle(deck);
              const offline = isDeckOffline(deck.id);
              return (
                <div
                  key={deck.id}
                  className="rounded-2xl border border-lantern-border bg-lantern-surface p-3"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectDeck(deck)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
                      aria-label={`Deck ${title}. ${getDeckListStatsLine(dueCards, totalCards)}`}
                    >
                      {/* The cover fills the pastel tile's slot and the type
                          glyph shrinks to a badge on it — with a photograph in
                          this position the tile was the only thing saying
                          "deck", so the badge has to carry that instead. */}
                      <CoverThumb
                        coverPath={deck.coverPath}
                        alt=""
                        badge={<AppIcon name="layers" size={16} />}
                        fallback={
                          <FeatureDisc
                            feature="flashcards"
                            icon={<AppIcon name="layers" size={20} />}
                            size={40}
                          />
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <h2 className="truncate text-body font-semibold text-lantern-text">{title}</h2>
                          {offline ? (
                            <AppIcon
                              name="cloud-done"
                              size={14}
                              className="shrink-0 text-lantern-feature-flashcards-ink"
                              aria-label="Saved for offline"
                            />
                          ) : null}
                          {deck.isShared ? (
                            <span className="shrink-0 text-label text-lantern-text-secondary">Shared</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-caption tabular-nums text-lantern-text-secondary">
                          {getDeckListStatsLine(dueCards, totalCards)}
                        </span>
                      </span>
                    </button>
                    {dueCards > 0 ? (
                      <span className="shrink-0 rounded-full bg-lantern-feature-flashcards-tint px-2 py-0.5 text-label font-bold tabular-nums text-lantern-feature-flashcards-ink">
                        {dueCards > 99 ? '99+' : dueCards} due
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => handleOfflineToggle(e, deck)}
                      className="shrink-0 rounded-lg p-1.5 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
                      title={offline ? 'Remove from offline' : 'Save for offline'}
                      aria-label={offline ? `Remove ${title} from offline` : `Save ${title} for offline`}
                    >
                      {offline ? (
                        <AppIcon name="cloud-upload" size={16} />
                      ) : (
                        <AppIcon name="cloud-download" size={16} />
                      )}
                    </button>
                    {onMoveDeckToCourse || !deck.isShared ? (
                      <Menu
                        open={deckMenuId === deck.id}
                        onOpenChange={(open) => setDeckMenuId(open ? deck.id : null)}
                      >
                        <MenuTrigger
                          aria-label={`Deck options for ${title}`}
                          className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
                        >
                          <AppIcon name="ellipsis-vertical" size={16} />
                        </MenuTrigger>
                        <MenuContent align="end" className="w-48">
                          {onMoveDeckToCourse ? (
                            <MenuItem onSelect={() => setMovingDeck(deck)}>
                              <span className="inline-flex items-center gap-2">
                                <AppIcon name="school" size={16} /> Move to course…
                              </span>
                            </MenuItem>
                          ) : null}
                          {/* Only the owner may restyle a deck — the route
                              refuses a collaborator, so offering it here would
                              be a menu item that always 403s. */}
                          {!deck.isShared ? (
                            <CoverMenuItems
                              hasCover={Boolean(deck.coverPath)}
                              onChoose={() => setCoverDeck(deck)}
                              onRemove={() => void handleRemoveCover(deck)}
                            />
                          ) : null}
                        </MenuContent>
                      </Menu>
                    ) : null}
                  </div>
                  {subtitle ? (
                    <p className="mt-2 text-caption text-lantern-text-secondary line-clamp-2">{subtitle}</p>
                  ) : null}
                  {onStudyDeck && dueCards > 0 ? (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStudyDeck(deck);
                        }}
                      >
                        {getStudyCtaLabel(dueCards, totalCards)}
                      </Button>
                    </div>
                  ) : null}
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
            <AppIcon name="warning" size={32} className="mx-auto text-amber-500" aria-hidden />
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
            icon={<AppIcon name="albums" size={32} />}
            title="No flashcard decks yet"
            description="Create a deck to start adding flashcards and supercharge your learning."
            actionLabel="Create your first deck"
            onAction={onOpenCreateDeck}
            secondaryActionLabel="Import cards (free)"
            onSecondaryAction={() => setImportCardsOpen(true)}
          />
        )}
      </div>
      {coverDeck ? (
        <CoverPickerDialog
          open
          kind="deck"
          id={coverDeck.id}
          hasCover={Boolean(coverDeck.coverPath)}
          onClose={() => setCoverDeck(null)}
        />
      ) : null}
      <ImportCardsModal
        isOpen={importCardsOpen}
        onClose={() => setImportCardsOpen(false)}
        onImported={(deckId) => {
          const deck = useFlashcardStore.getState().decks.find((d) => d.id === deckId);
          if (deck) onSelectDeck(deck);
        }}
      />
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
