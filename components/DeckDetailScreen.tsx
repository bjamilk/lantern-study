import React, { useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { Deck, Flashcard, FlashcardType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useRegisterFeatureTip } from './featureTips/FeatureTip';
import {
  ArrowUturnLeftIcon,
  PlayCircleIcon,
  PlusCircleIcon,
  PencilIcon,
  TrashIcon,
  SparklesIcon,
  BoltIcon,
  ArrowPathIcon,
  ClockIcon,
  UserGroupIcon,
  Squares2X2Icon,
  AcademicCapIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  FlagIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';
import GenerateFlashcardsModal from './GenerateFlashcardsModal';
import { PublishStudyPackModal } from './marketplace/PublishStudyPackModal';
import UpdateStudyPackModal from './marketplace/UpdateStudyPackModal';
import CollaboratorsModal from './CollaboratorsModal';
import Modal from './ui/Modal';
import { Button } from './ui';
import { Menu, MenuTrigger, MenuContent, MenuItem } from './ui/Menu';
import ReportContentModal from './moderation/ReportContentModal';
import { MoveToCourseModal } from './academic/MoveToCourseModal';
import { useAcademicStore } from '../stores/academicStore';
import { courseLabel } from '../utils/academicSetup';
import {
  MarkdownRenderer,
  isCardDue,
  FLASHCARD_MODE_LABELS,
  FLASHCARD_STAT_LABELS,
  getStudyCtaLabel,
} from '@lantern/shared';

interface DeckDetailScreenProps {
  deck: Deck;
  flashcards: Flashcard[];
  onBack: () => void;
  onStartReview: (deck: Deck) => void;
  onStartCram: (deck: Deck, timerSeconds?: number) => void;
  onStartMatch?: (deck: Deck) => void;
  onStartLearn?: (deck: Deck) => void;
  onOpenCreateFlashcard: (deckId: string) => void;
  onOpenEditFlashcard: (flashcard: Flashcard) => void;
  onDeleteFlashcard: (flashcardId: string) => void;
  onOpenEditDeck: (deck: Deck) => void;
  /** "Move to course…" (PUT /decks/:id { courseId }); rejections surface in the dialog. */
  onMoveDeckToCourse?: (deck: Deck, courseId: string | null) => void | Promise<void>;
  onDeleteDeck: (deckId: string) => void;
  onGenerateFlashcards: (deckId: string, notes: string, count: number) => void;
  isGenerating: boolean;
  onResetStatistics: (deckId: string) => void;
  onExportDeck: (deckId: string, format: 'json' | 'csv') => void;
  onLoadMoreCards?: (deckId: string, page: number) => Promise<number>;
  onEnhanceFlashcard?: (
    front: string,
    back: string
  ) => Promise<{ front: string; back: string; mnemonic?: string; example?: string } | null>;
}

interface PracticeButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  disabled?: boolean;
  className?: string;
}

const PracticeButton: React.FC<PracticeButtonProps> = ({
  onClick,
  icon,
  label,
  subtitle,
  disabled,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-2.5 px-3 py-2.5 min-h-[52px] rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text shadow-sm hover:bg-lantern-background-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
  >
    <span className="flex-shrink-0 rounded-lg bg-lantern-primary/10 p-1.5 text-lantern-primary">{icon}</span>
    <span className="text-left min-w-0 flex-1">
      <span className="block text-sm font-semibold leading-snug truncate">{label}</span>
      <span className="block text-[11px] leading-snug text-lantern-text-secondary mt-0.5 truncate">
        {subtitle}
      </span>
    </span>
  </button>
);

const DeckDetailScreen: React.FC<DeckDetailScreenProps> = ({
  deck,
  flashcards,
  onBack,
  onStartReview,
  onStartCram,
  onStartMatch,
  onStartLearn,
  onOpenCreateFlashcard,
  onOpenEditFlashcard,
  onDeleteFlashcard,
  onOpenEditDeck,
  onMoveDeckToCourse,
  onDeleteDeck,
  onGenerateFlashcards,
  isGenerating,
  onResetStatistics,
  onExportDeck,
  onLoadMoreCards,
  onEnhanceFlashcard,
}) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  // A deck somebody else shared with me is reportable; my own decks never are.
  const isSharedWithMe = !!deck.userId && !!currentUser?.id && deck.userId !== currentUser.id;
  const cardsInDeck = flashcards.filter((fc) => fc && fc.deckId === deck.id);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isCollaboratorsModalOpen, setIsCollaboratorsModalOpen] = useState(false);
  const [isMoveCourseOpen, setIsMoveCourseOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isSellOpen, setIsSellOpen] = useState(false);
  const [isUpdatePackOpen, setIsUpdatePackOpen] = useState(false);
  // Course label under the title (Phase 1 · B); courses load lazily on first use.
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  const academicLoaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  React.useEffect(() => {
    if (deck.courseId && !academicLoaded) void loadMyCourses();
  }, [deck.courseId, academicLoaded, loadMyCourses]);
  void knownCourses; // subscribe so the label resolves once courses load
  const deckCourse = deck.courseId ? resolveCourse(deck.courseId) : null;
  const [enhancingCardId, setEnhancingCardId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreModesOpen, setMoreModesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useRegisterFeatureTip('flashcards.deckModes', true);

  const CARDS_PER_PAGE = 20;

  React.useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [deck.id]);

  const newCards = cardsInDeck.filter((fc) => !fc.srsData?.repetitions).length;
  /** Match Library / Dashboard badges — due via shared isCardDue (excludes never-started). */
  const dueCards = cardsInDeck.filter((fc) => isCardDue(fc.srsData)).length;
  const reviewedCards = cardsInDeck.filter(
    (fc) => fc.srsData?.repetitions && fc.srsData.repetitions > 0
  );
  const avgEaseFactor =
    reviewedCards.length > 0
      ? reviewedCards.reduce((sum, fc) => sum + (fc.srsData?.easeFactor || 0), 0) /
        reviewedCards.length
      : 0;
  const leechCards = cardsInDeck.filter((fc) => fc.srsData?.isLeech).length;
  const hasCards = cardsInDeck.length > 0;
  const studyLabel = getStudyCtaLabel(dueCards, cardsInDeck.length);

  const handleDeleteDeckClick = async () => {
    const ok = await confirmDialog({
      title: 'Delete deck?',
      message: `Are you sure you want to delete the deck "${deck.name}"? This will also delete all ${cardsInDeck.length} cards inside it. This action cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (ok) onDeleteDeck(deck.id);
  };

  const handleGenerateSubmit = (notes: string, count: number) => {
    onGenerateFlashcards(deck.id, notes, count);
    setIsGenerateModalOpen(false);
  };

  const [cramMinutesOpen, setCramMinutesOpen] = useState(false);
  const [cramMinutes, setCramMinutes] = useState('5');

  const handleTimedCram = () => {
    setCramMinutes('5');
    setCramMinutesOpen(true);
  };

  const confirmTimedCram = () => {
    const parsed = parseFloat(cramMinutes);
    if (isNaN(parsed) || parsed <= 0) {
      useToastStore.getState().showToast('Please enter a valid number of minutes.', 'error');
      return;
    }
    setCramMinutesOpen(false);
    onStartCram(deck, Math.round(parsed * 60));
  };

  const handleLoadMore = async () => {
    if (!onLoadMoreCards || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const fetched = await onLoadMoreCards(deck.id, page + 1);
    setIsLoadingMore(false);

    if (fetched > 0) {
      setPage((prev) => prev + 1);
      if (fetched < CARDS_PER_PAGE) {
        setHasMore(false);
      }
    } else {
      setHasMore(false);
    }
  };

  const getCardPreview = (card: Flashcard) => {
    if (card.type === FlashcardType.BASIC) {
      return card.front;
    }
    if (card.type === FlashcardType.CLOZE) {
      return card.clozeText
        ? card.clozeText.replace(/\{\{c\d+::(.*?)\}\}/g, '[...]')
        : 'Cloze card';
    }
    if (card.type === FlashcardType.IMAGE_OCCLUSION) {
      return card.front || 'Image occlusion card';
    }
    return 'Unknown card type';
  };

  const studyPanel = (
    <div className="space-y-3" data-tip-id="flashcards.deckModes">
      <Button
        variant="accent"
        size="lg"
        fullWidth
        disabled={!hasCards}
        onClick={() => onStartReview(deck)}
        className="min-h-[52px] text-base justify-center"
      >
        <PlayCircleIcon className="w-5 h-5" />
        {studyLabel}
      </Button>
      <p className="text-xs text-lantern-text-secondary px-0.5">
        {FLASHCARD_MODE_LABELS.smart_review.subtitle}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {onStartLearn && (
          <PracticeButton
            onClick={() => onStartLearn(deck)}
            disabled={!hasCards}
            icon={<AcademicCapIcon className="w-5 h-5" />}
            label={FLASHCARD_MODE_LABELS.quiz.label}
            subtitle={FLASHCARD_MODE_LABELS.quiz.subtitle}
          />
        )}
        {onStartMatch && (
          <PracticeButton
            onClick={() => onStartMatch(deck)}
            disabled={!hasCards}
            icon={<Squares2X2Icon className="w-5 h-5" />}
            label={FLASHCARD_MODE_LABELS.match.label}
            subtitle={FLASHCARD_MODE_LABELS.match.subtitle}
          />
        )}
      </div>

      <div className="rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden">
        <button
          type="button"
          onClick={() => setMoreModesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-lantern-text hover:bg-lantern-background-secondary"
        >
          More ways to study
          <ChevronDownIcon
            className={`w-4 h-4 text-lantern-text-secondary transition-transform ${moreModesOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {moreModesOpen && (
          <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-lantern-border pt-2">
            <PracticeButton
              onClick={() => onStartCram(deck)}
              disabled={!hasCards}
              icon={<BoltIcon className="w-5 h-5" />}
              label={FLASHCARD_MODE_LABELS.speed_run.label}
              subtitle={FLASHCARD_MODE_LABELS.speed_run.subtitle}
            />
            <PracticeButton
              onClick={handleTimedCram}
              disabled={!hasCards}
              icon={<ClockIcon className="w-5 h-5" />}
              label={FLASHCARD_MODE_LABELS.timed_drill.label}
              subtitle={FLASHCARD_MODE_LABELS.timed_drill.subtitle}
            />
          </div>
        )}
      </div>

      {hasCards && (
        <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-lantern-background-secondary border border-lantern-border text-center text-sm">
          <div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">{dueCards}</div>
            <div className="text-[11px] text-lantern-text-secondary mt-0.5">
              {FLASHCARD_STAT_LABELS.readyToReview}
            </div>
          </div>
          <div>
            <div className="font-semibold text-lantern-primary">{newCards}</div>
            <div className="text-[11px] text-lantern-text-secondary mt-0.5">
              {FLASHCARD_STAT_LABELS.notStarted}
            </div>
          </div>
          <div>
            <div className="font-semibold text-lantern-text">{cardsInDeck.length}</div>
            <div className="text-[11px] text-lantern-text-secondary mt-0.5">
              {FLASHCARD_STAT_LABELS.total}
            </div>
          </div>
        </div>
      )}

      {hasCards && (
        <div className="rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden">
          <button
            type="button"
            onClick={() => setInsightsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            Deck insights
            <ChevronDownIcon
              className={`w-4 h-4 text-lantern-text-secondary transition-transform ${insightsOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {insightsOpen && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-3 border-t border-lantern-border pt-3 text-sm text-center">
              <div>
                <div className="font-semibold text-orange-600">{avgEaseFactor.toFixed(2)}</div>
                <div className="text-[11px] text-lantern-text-secondary mt-0.5">
                  {FLASHCARD_STAT_LABELS.avgDifficulty}
                </div>
              </div>
              <div>
                <div className="font-semibold text-red-600">{leechCards}</div>
                <div className="text-[11px] text-lantern-text-secondary mt-0.5">
                  {FLASHCARD_STAT_LABELS.trickyCards}
                </div>
              </div>
              <div className="col-span-2">
                <div className="font-semibold text-lantern-primary">{reviewedCards.length}</div>
                <div className="text-[11px] text-lantern-text-secondary mt-0.5">Reviewed before</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col flex-1 overflow-y-auto p-4 md:p-6 bg-lantern-background text-lantern-text">
      <div className="mb-6 pb-4 border-b border-lantern-border dark:border-lantern-border">
        <button
          onClick={onBack}
          className="flex items-center text-sm font-semibold text-lantern-primary hover:underline mb-4"
        >
          <ArrowUturnLeftIcon className="w-5 h-5 mr-1.5" />
          Back to All Decks
        </button>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-lantern-text truncate">{deck.name}</h1>
            {/* Phase 3 M: decks.study_count had a writer but no reader, so
                "studied by N" never appeared anywhere. Hidden at zero — a lonely
                "studied by 0 people" is worse than saying nothing. */}
            {(deck.studyCount ?? 0) > 0 && (
              <p className="text-xs text-lantern-text-secondary">
                Studied by {deck.studyCount} {deck.studyCount === 1 ? 'person' : 'people'}
              </p>
            )}
            <p className="text-sm text-lantern-text-secondary mt-1">
              {deck.description || 'No description.'}
            </p>
            {deck.courseId ? (
              <button
                type="button"
                onClick={() => (onMoveDeckToCourse ? setIsMoveCourseOpen(true) : undefined)}
                disabled={!onMoveDeckToCourse}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lantern-primary/10 px-2.5 py-1 text-xs font-medium text-lantern-primary disabled:cursor-default"
                title={onMoveDeckToCourse ? 'Move to another course' : undefined}
              >
                <AcademicCapIcon className="w-3.5 h-3.5" aria-hidden />
                {deckCourse ? courseLabel(deckCourse) : 'Filed under a course'}
              </button>
            ) : null}
          </div>
          <Menu open={manageOpen} onOpenChange={setManageOpen}>
            <MenuTrigger
              aria-label="Manage deck"
              className="inline-flex items-center gap-1.5 rounded-lantern px-3 py-2 text-sm font-medium bg-lantern-background-secondary text-lantern-text hover:bg-lantern-border/40"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
              Manage deck
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                onSelect={() => {
                  onOpenCreateFlashcard(deck.id);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <PlusCircleIcon className="w-4 h-4" /> Add card
                </span>
              </MenuItem>
              <MenuItem
                onSelect={() => setIsGenerateModalOpen(true)}
                disabled={isGenerating}
              >
                <span className="inline-flex items-center gap-2">
                  <SparklesIcon className="w-4 h-4" />
                  {isGenerating ? 'Generating…' : 'Generate with AI'}
                </span>
              </MenuItem>
              <MenuItem onSelect={() => onOpenEditDeck(deck)}>
                <span className="inline-flex items-center gap-2">
                  <PencilIcon className="w-4 h-4" /> Edit deck
                </span>
              </MenuItem>
              {onMoveDeckToCourse && (
                <MenuItem onSelect={() => setIsMoveCourseOpen(true)}>
                  <span className="inline-flex items-center gap-2">
                    <AcademicCapIcon className="w-4 h-4" /> Move to course…
                  </span>
                </MenuItem>
              )}
              {deck.isShared && (
                <MenuItem onSelect={() => setIsCollaboratorsModalOpen(true)}>
                  <span className="inline-flex items-center gap-2">
                    <UserGroupIcon className="w-4 h-4" /> Collaborators
                  </span>
                </MenuItem>
              )}
              <MenuItem onSelect={() => onExportDeck(deck.id, 'json')}>
                <span className="inline-flex items-center gap-2">
                  <ArrowDownTrayIcon className="w-4 h-4" /> Export JSON
                </span>
              </MenuItem>
              <MenuItem onSelect={() => onExportDeck(deck.id, 'csv')}>
                <span className="inline-flex items-center gap-2">
                  <ArrowDownTrayIcon className="w-4 h-4" /> Export CSV
                </span>
              </MenuItem>
              {!isSharedWithMe && cardsInDeck.length > 0 && (
                <MenuItem onSelect={() => setIsSellOpen(true)}>
                  <span className="inline-flex items-center gap-2">
                    <BuildingStorefrontIcon className="w-4 h-4" /> Sell as study pack…
                  </span>
                </MenuItem>
              )}
              {/* Phase 2 G: the server has supported republish-as-update since
                  the pack shipped (version bump + optimistic lock + buyer
                  update-pull), but NO client ever called it — a seller could
                  publish a pack and then never fix a typo in it. */}
              {!isSharedWithMe && cardsInDeck.length > 0 && (
                <MenuItem onSelect={() => setIsUpdatePackOpen(true)}>
                  <span className="inline-flex items-center gap-2">
                    <ArrowPathIcon className="w-4 h-4" /> Push update to my study pack…
                  </span>
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  void confirmDialog({
                    title: 'Reset progress?',
                    message:
                      'Reset review progress for this deck? All cards will be treated as not started again.',
                    danger: false,
                  }).then((ok) => {
                    if (ok) onResetStatistics(deck.id);
                  });
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <ArrowPathIcon className="w-4 h-4" /> Reset progress
                </span>
              </MenuItem>
              {isSharedWithMe && (
                <MenuItem onSelect={() => setIsReportOpen(true)}>
                  <span className="inline-flex items-center gap-2">
                    <FlagIcon className="w-4 h-4" /> Report deck…
                  </span>
                </MenuItem>
              )}
              <MenuItem destructive onSelect={() => void handleDeleteDeckClick()}>
                <span className="inline-flex items-center gap-2">
                  <TrashIcon className="w-4 h-4" /> Delete deck
                </span>
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="mb-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-72 shrink-0">{studyPanel}</aside>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold mb-3 text-lantern-text">
            Cards in this deck ({cardsInDeck.length})
            {hasMore && onLoadMoreCards && (
              <span className="ml-3 text-sm text-lantern-text-secondary font-normal">
                (showing first {CARDS_PER_PAGE}, load more below)
              </span>
            )}
          </h2>

          {cardsInDeck.length > 0 ? (
            <div className="bg-lantern-surface rounded-lg shadow-md overflow-hidden">
              <ul className="divide-y divide-lantern-border">
                {cardsInDeck.map((card) => (
                  <li
                    key={card.id}
                    className="p-4 flex justify-between items-center hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/50"
                  >
                    <div className="min-w-0 flex-grow pr-4">
                      <div className="text-sm text-lantern-text truncate" title={getCardPreview(card)}>
                        <MarkdownRenderer content={getCardPreview(card)} />
                      </div>
                      {card.tags && card.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1" aria-label="Tags">
                          {card.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full bg-lantern-primary/10 px-2 py-0.5 text-[11px] font-medium text-lantern-primary"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex space-x-2 flex-shrink-0">
                      {onEnhanceFlashcard &&
                        card.type === 'BASIC' &&
                        card.front &&
                        card.back && (
                          <button
                            onClick={async () => {
                              setEnhancingCardId(card.id);
                              const enhanced = await onEnhanceFlashcard(card.front!, card.back!);
                              setEnhancingCardId(null);
                              if (enhanced) {
                                onOpenEditFlashcard({
                                  ...card,
                                  front: enhanced.front,
                                  back:
                                    enhanced.back +
                                    (enhanced.mnemonic ? `\n\n💡 ${enhanced.mnemonic}` : '') +
                                    (enhanced.example ? `\n📝 ${enhanced.example}` : ''),
                                });
                              }
                            }}
                            disabled={enhancingCardId === card.id}
                            className="p-1.5 text-lantern-primary-light hover:text-lantern-primary rounded-md disabled:opacity-50"
                            title="Enhance with AI"
                          >
                            <SparklesIcon
                              className={`w-5 h-5 ${enhancingCardId === card.id ? 'animate-pulse' : ''}`}
                            />
                          </button>
                        )}
                      <button
                        onClick={() => onOpenEditFlashcard(card)}
                        className="p-1.5 text-lantern-text-secondary hover:text-lantern-primary rounded-md"
                      >
                        <PencilIcon className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          void confirmDialog({
                            title: 'Delete flashcard?',
                            message: 'Are you sure you want to delete this flashcard?',
                            danger: true,
                            confirmLabel: 'Delete',
                          }).then((ok) => {
                            if (ok) onDeleteFlashcard(card.id);
                          });
                        }}
                        className="p-1.5 text-lantern-text-secondary hover:text-red-600 rounded-md"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {onLoadMoreCards && hasMore && (
                <div className="p-4 border-t border-lantern-border flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary text-white rounded-md shadow-sm disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading…' : 'Load more cards'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-lantern-border bg-lantern-surface p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-lantern-text mb-1">Get this deck ready</h3>
              <p className="text-sm text-lantern-text-secondary mb-5">
                Add a few cards, then tap Study for a smart review.
              </p>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lantern-primary text-white text-sm font-bold">
                    1
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-lantern-text mb-2">Add cards</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => onOpenCreateFlashcard(deck.id)}>
                        <PlusCircleIcon className="w-4 h-4" />
                        Add manually
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isGenerating}
                        onClick={() => setIsGenerateModalOpen(true)}
                      >
                        <SparklesIcon className="w-4 h-4" />
                        Generate with AI
                      </Button>
                    </div>
                  </div>
                </li>
                <li className="flex gap-3 opacity-60">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lantern-background-secondary text-lantern-text-secondary text-sm font-bold border border-lantern-border">
                    2
                  </span>
                  <div>
                    <p className="text-sm font-medium text-lantern-text">Study</p>
                    <p className="text-xs text-lantern-text-secondary mt-0.5">
                      The Study button unlocks once this deck has cards.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>

      <GenerateFlashcardsModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onSubmit={handleGenerateSubmit}
        isGenerating={isGenerating}
      />
      <CollaboratorsModal
        isOpen={isCollaboratorsModalOpen}
        onClose={() => setIsCollaboratorsModalOpen(false)}
        deckId={deck.id}
        currentUserId={currentUser?.id}
      />
      {isSharedWithMe && isReportOpen ? (
        <ReportContentModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          targetType="deck"
          targetId={deck.id}
          targetLabel={deck.name}
        />
      ) : null}
      {onMoveDeckToCourse ? (
        <MoveToCourseModal
          isOpen={isMoveCourseOpen}
          onClose={() => setIsMoveCourseOpen(false)}
          currentCourseId={deck.courseId ?? null}
          title={`Move “${deck.name}” to course`}
          onSubmit={(courseId) => onMoveDeckToCourse(deck, courseId)}
        />
      ) : null}
      {isSellOpen ? (
        <PublishStudyPackModal
          isOpen={isSellOpen}
          onClose={() => setIsSellOpen(false)}
          defaultTitle={deck.name}
          defaultCourseId={deck.courseId ?? null}
          content={{
            flashcards: cardsInDeck
              .map((c) => ({
                front: c.front || (c as unknown as { clozeText?: string }).clozeText || '',
                back: c.back || '',
                tags: Array.isArray(c.tags) ? c.tags : undefined,
              }))
              .filter((c) => c.front.trim().length > 0),
          }}
        />
      ) : null}
      {isUpdatePackOpen ? (
        <UpdateStudyPackModal
          isOpen={isUpdatePackOpen}
          onClose={() => setIsUpdatePackOpen(false)}
          content={{
            flashcards: cardsInDeck
              .map((c) => ({
                front: c.front || (c as unknown as { clozeText?: string }).clozeText || '',
                back: c.back || '',
                tags: Array.isArray(c.tags) ? c.tags : undefined,
              }))
              .filter((c) => c.front.trim().length > 0),
          }}
        />
      ) : null}
      {cramMinutesOpen && (
        <Modal
          isOpen={cramMinutesOpen}
          onClose={() => setCramMinutesOpen(false)}
          ariaLabelledBy="cram-minutes-title"
          maxWidthClass="max-w-sm"
          zIndexClass="z-[70]"
        >
          <div className="space-y-4">
            <h3 id="cram-minutes-title" className="text-lg font-semibold text-lantern-text">
              {FLASHCARD_MODE_LABELS.timed_drill.label}
            </h3>
            <label className="block text-sm text-lantern-text-secondary">
              Duration (minutes)
              <input
                type="number"
                min={1}
                value={cramMinutes}
                onChange={(e) => setCramMinutes(e.target.value)}
                className="mt-1 w-full min-h-[44px] rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-lantern-text focus:ring-2 focus:ring-lantern-primary"
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCramMinutesOpen(false)}
                className="min-h-[44px] px-3 py-2 text-sm rounded-lg bg-lantern-background-secondary text-lantern-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmTimedCram}
                className="min-h-[44px] px-3 py-2 text-sm rounded-lg bg-lantern-primary text-white"
              >
                Start
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DeckDetailScreen;
