import React, { useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { Deck, Flashcard, FlashcardType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { ArrowUturnLeftIcon, PlayCircleIcon, PlusCircleIcon, PencilIcon, TrashIcon, SparklesIcon, BoltIcon, ArrowPathIcon, ClockIcon, UserGroupIcon, Squares2X2Icon, AcademicCapIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import GenerateFlashcardsModal from './GenerateFlashcardsModal';
import CollaboratorsModal from './CollaboratorsModal';
import Modal from './ui/Modal';
import { MarkdownRenderer, isCardDue } from '@lantern/shared';

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
  onDeleteDeck: (deckId: string) => void;
  onGenerateFlashcards: (deckId: string, notes: string, count: number) => void;
  isGenerating: boolean;
  onResetStatistics: (deckId: string) => void;
  onExportDeck: (deckId: string, format: 'json' | 'csv') => void;
  onLoadMoreCards?: (deckId: string, page: number) => Promise<number>;
  onEnhanceFlashcard?: (front: string, back: string) => Promise<{ front: string; back: string; mnemonic?: string; example?: string } | null>;
}

interface DeckActionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  colorClass: string;
  disabled?: boolean;
  className?: string;
}

const DeckActionButton: React.FC<DeckActionButtonProps> = ({
  onClick,
  icon,
  label,
  subtitle,
  colorClass,
  disabled,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`group flex items-center gap-2.5 px-3 py-2.5 min-h-[58px] rounded-xl text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${colorClass} ${className}`}
  >
    <span className="flex-shrink-0 rounded-lg bg-black/10 p-1.5 group-hover:bg-black/15 transition-colors">
      {icon}
    </span>
    <span className="text-left min-w-0 flex-1">
      <span className="block text-sm font-semibold leading-snug truncate">{label}</span>
      <span className="block text-[11px] leading-snug opacity-80 mt-0.5 truncate">{subtitle}</span>
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
  onDeleteDeck,
  onGenerateFlashcards,
  isGenerating,
  onResetStatistics,
  onExportDeck,
  onLoadMoreCards,
  onEnhanceFlashcard,
}) => {
  const currentUser = useAuthStore(s => s.currentUser);
  const cardsInDeck = flashcards.filter(fc => fc && fc.deckId === deck.id);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isCollaboratorsModalOpen, setIsCollaboratorsModalOpen] = useState(false);
  const [enhancingCardId, setEnhancingCardId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const CARDS_PER_PAGE = 20;

  React.useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [deck.id]);

  const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions).length;
  const dueCards = cardsInDeck.filter(
    fc => Boolean(fc.srsData?.repetitions) && isCardDue(fc.srsData)
  ).length;
  const reviewedCards = cardsInDeck.filter(fc => fc.srsData?.repetitions && fc.srsData.repetitions > 0);
  const avgEaseFactor = reviewedCards.length > 0 ? reviewedCards.reduce((sum, fc) => sum + (fc.srsData?.easeFactor || 0), 0) / reviewedCards.length : 0;
  const leechCards = cardsInDeck.filter(fc => fc.srsData?.isLeech).length;

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
      setPage(prev => prev + 1);
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
      // Render cloze text with blanks
      return card.clozeText
        ? card.clozeText.replace(/\{\{c\d+::(.*?)\}\}/g, '[...]')
        : 'Cloze card';
    }
    if (card.type === FlashcardType.IMAGE_OCCLUSION) {
      return card.front || 'Image occlusion card';
    }
    return 'Unknown card type';
  };

  return (
    <div className="h-screen flex flex-col flex-1 overflow-y-auto p-4 md:p-6 bg-lantern-background text-lantern-text">
      <div className="mb-6 pb-4 border-b border-lantern-border dark:border-lantern-border">
        <button onClick={onBack} className="flex items-center text-sm font-semibold text-lantern-primary hover:underline mb-4">
          <ArrowUturnLeftIcon className="w-5 h-5 mr-1.5" />
          Back to All Decks
        </button>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-lantern-text">{deck.name}</h1>
                <p className="text-sm text-lantern-text-secondary mt-1">{deck.description || 'No description.'}</p>
            </div>
            <div className="flex space-x-2 mt-3 sm:mt-0 flex-wrap gap-2">
                <button onClick={() => onOpenEditDeck(deck)} className="px-3 py-2 bg-lantern-background-secondary hover:bg-lantern-border dark:bg-lantern-surface-secondary dark:hover:bg-lantern-border text-lantern-text rounded-md flex items-center text-sm shadow"><PencilIcon className="w-4 h-4 mr-1.5" /> Edit</button>
                {deck.isShared && (
                  <button onClick={() => setIsCollaboratorsModalOpen(true)} className="px-3 py-2 bg-lantern-primary hover:bg-lantern-primary text-white rounded-md flex items-center text-sm shadow">
                    <UserGroupIcon className="w-4 h-4 mr-1.5" /> Collaborators
                  </button>
                )}
                <button onClick={() => { void confirmDialog({ title: 'Reset statistics?', message: 'Are you sure you want to reset all SRS statistics for this deck? This will mark all cards as new.', danger: false }).then((ok) => { if (ok) onResetStatistics(deck.id); }); }} className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center text-sm shadow"><ArrowPathIcon className="w-4 h-4 mr-1.5" /> Reset Stats</button>
                <button onClick={handleDeleteDeckClick} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md flex items-center text-sm shadow"><TrashIcon className="w-4 h-4 mr-1.5" /> Delete</button>
            </div>
        </div>
      </div>

      <div className="mb-6 flex flex-col md:flex-row gap-6">
        {/* Study modes sidebar */}
        <aside className="hidden md:block md:w-56 shrink-0 space-y-2">
          <p className="text-xs font-semibold uppercase text-lantern-text-secondary tracking-wide px-1 mb-2">Study modes</p>
          <DeckActionButton
            onClick={() => onStartLearn ? onStartLearn(deck) : onStartReview(deck)}
            icon={<AcademicCapIcon className="w-5 h-5" />}
            label="Learn"
            subtitle="Adaptive MCQ mode"
            colorClass="bg-sky-500 hover:bg-sky-600 ring-1 ring-inset ring-white/20 w-full"
            className="w-full"
          />
          <DeckActionButton
            onClick={() => onStartReview(deck)}
            icon={<PlayCircleIcon className="w-5 h-5" />}
            label="Spaced repetition"
            subtitle={`${dueCards} due · FSRS`}
            colorClass="bg-rose-500 hover:bg-rose-600 ring-1 ring-inset ring-white/20 w-full"
            className="w-full"
          />
          {onStartMatch && (
            <DeckActionButton
              onClick={() => onStartMatch(deck)}
              icon={<Squares2X2Icon className="w-5 h-5" />}
              label="Match"
              subtitle="Pair terms quickly"
              colorClass="bg-teal-500 hover:bg-teal-600 w-full"
              className="w-full"
            />
          )}
          <DeckActionButton
            onClick={() => onStartCram(deck)}
            icon={<BoltIcon className="w-5 h-5" />}
            label="Cram"
            subtitle="Review every card"
            colorClass="bg-purple-500 hover:bg-purple-600 w-full"
            className="w-full"
          />
          <DeckActionButton
            onClick={handleTimedCram}
            icon={<ClockIcon className="w-5 h-5" />}
            label="Timed Cram"
            subtitle="Beat the clock"
            colorClass="bg-lantern-primary hover:bg-lantern-primary w-full"
            className="w-full"
          />
          <p className="text-xs font-semibold uppercase text-lantern-text-secondary tracking-wide px-1 mt-4 mb-2">Deck actions</p>
          <DeckActionButton
            onClick={() => onOpenCreateFlashcard(deck.id)}
            icon={<PlusCircleIcon className="w-5 h-5" />}
            label="Add Card"
            subtitle="Create manually"
            colorClass="bg-emerald-500 hover:bg-emerald-600 w-full"
            className="w-full"
          />
          <DeckActionButton
            onClick={() => setIsGenerateModalOpen(true)}
            disabled={isGenerating}
            icon={<SparklesIcon className="w-5 h-5" />}
            label={isGenerating ? 'Generating…' : 'Generate'}
            subtitle="From your notes"
            colorClass="bg-amber-500 hover:bg-amber-600 w-full"
            className="w-full"
          />
          <DeckActionButton
            onClick={() => onExportDeck(deck.id, 'json')}
            icon={<ArrowDownTrayIcon className="w-5 h-5" />}
            label="Export JSON"
            subtitle="Full backup"
            colorClass="bg-lantern-border hover:bg-lantern-surface-secondary ring-1 ring-inset ring-white/10 w-full"
            className="w-full"
          />
          <DeckActionButton
            onClick={() => onExportDeck(deck.id, 'csv')}
            icon={<ArrowDownTrayIcon className="w-5 h-5" />}
            label="Export CSV"
            subtitle="Spreadsheet export"
            colorClass="bg-lantern-border hover:bg-lantern-border w-full"
            className="w-full"
          />
          <div className="mt-4 p-3 rounded-xl bg-lantern-background-secondary border border-lantern-border text-xs space-y-1">
            <p className="flex justify-between"><span className="text-lantern-text-secondary">New</span><span className="font-bold text-lantern-text">{newCards}</span></p>
            <p className="flex justify-between"><span className="text-lantern-text-secondary">Due</span><span className="font-bold text-emerald-600">{dueCards}</span></p>
            <p className="flex justify-between"><span className="text-lantern-text-secondary">Total</span><span className="font-bold text-lantern-text">{cardsInDeck.length}</span></p>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:hidden">
        {onStartLearn && (
          <DeckActionButton
            onClick={() => onStartLearn(deck)}
            icon={<AcademicCapIcon className="w-5 h-5" />}
            label="Learn"
            subtitle="Adaptive MCQ mode"
            colorClass="bg-sky-500 hover:bg-sky-600 ring-1 ring-inset ring-white/20 col-span-full"
            className="w-full"
          />
        )}
        <DeckActionButton
          onClick={() => onStartReview(deck)}
          icon={<PlayCircleIcon className="w-5 h-5" />}
          label="Spaced repetition"
          subtitle="FSRS review"
          colorClass="bg-rose-500 hover:bg-rose-600 ring-1 ring-inset ring-white/20"
        />
        {onStartMatch && (
          <DeckActionButton
            onClick={() => onStartMatch(deck)}
            icon={<Squares2X2Icon className="w-5 h-5" />}
            label="Match"
            subtitle="Pair terms quickly"
            colorClass="bg-teal-500 hover:bg-teal-600"
          />
        )}
        <DeckActionButton
          onClick={() => onStartCram(deck)}
          icon={<BoltIcon className="w-5 h-5" />}
          label="Cram Mode"
          subtitle="Review every card"
          colorClass="bg-purple-500 hover:bg-purple-600"
        />
        <DeckActionButton
          onClick={handleTimedCram}
          icon={<ClockIcon className="w-5 h-5" />}
          label="Timed Cram"
          subtitle="Beat the clock"
          colorClass="bg-lantern-primary hover:bg-lantern-primary"
        />
        <DeckActionButton
          onClick={() => onOpenCreateFlashcard(deck.id)}
          icon={<PlusCircleIcon className="w-5 h-5" />}
          label="Add Card"
          subtitle="Create manually"
          colorClass="bg-emerald-500 hover:bg-emerald-600"
        />
        <DeckActionButton
          onClick={() => setIsGenerateModalOpen(true)}
          disabled={isGenerating}
          icon={<SparklesIcon className="w-5 h-5" />}
          label={isGenerating ? 'Generating…' : 'Generate'}
          subtitle="From your notes"
          colorClass="bg-amber-500 hover:bg-amber-600"
        />
        <DeckActionButton
          onClick={() => onExportDeck(deck.id, 'json')}
          icon={<ArrowDownTrayIcon className="w-5 h-5" />}
          label="Export JSON"
          subtitle="Full backup (images + progress)"
          colorClass="bg-lantern-border hover:bg-lantern-surface-secondary ring-1 ring-inset ring-white/10"
        />
        <DeckActionButton
          onClick={() => onExportDeck(deck.id, 'csv')}
          icon={<ArrowDownTrayIcon className="w-5 h-5" />}
          label="Export CSV"
          subtitle="Spreadsheet (front/back only)"
          colorClass="bg-lantern-border hover:bg-lantern-border"
        />
      </div>

      <h2 className="text-xl font-semibold mb-3 text-lantern-text">
        Flashcards in this Deck ({cardsInDeck.length})
        {hasMore && (
          <span className="ml-3 text-sm text-lantern-text-secondary">(showing first {CARDS_PER_PAGE}, load more below)</span>
        )}
      </h2>
      
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-260px)]">
        {cardsInDeck.length > 0 && (
          <div className="mb-4 p-4 bg-lantern-background-secondary rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div className="text-center">
                <div className="font-semibold text-lantern-primary">{newCards}</div>
                <div className="text-lantern-text-secondary">New Cards</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-green-600">{dueCards}</div>
                <div className="text-lantern-text-secondary">Due Today</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-purple-600">{reviewedCards.length}</div>
                <div className="text-lantern-text-secondary">Reviewed</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-orange-600">{avgEaseFactor.toFixed(2)}</div>
                <div className="text-lantern-text-secondary">Avg Ease</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-red-600">{leechCards}</div>
                <div className="text-lantern-text-secondary">Leeches</div>
              </div>
            </div>
          </div>
        )}
        
        {cardsInDeck.length > 0 ? (
          <div className="bg-lantern-surface rounded-lg shadow-md overflow-hidden">
            <ul className="divide-y divide-lantern-border">
            {cardsInDeck.map(card => (
              <li key={card.id} className="p-4 flex justify-between items-center hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/50">
                <div className="text-sm text-lantern-text flex-grow pr-4 truncate" title={getCardPreview(card)}>
                  <MarkdownRenderer content={getCardPreview(card)} />
                </div>
                <div className="flex space-x-2 flex-shrink-0">
                  {onEnhanceFlashcard && card.type === 'BASIC' && card.front && card.back && (
                    <button
                      onClick={async () => {
                        setEnhancingCardId(card.id);
                        const enhanced = await onEnhanceFlashcard(card.front!, card.back!);
                        setEnhancingCardId(null);
                        if (enhanced) {
                          onOpenEditFlashcard({ ...card, front: enhanced.front, back: enhanced.back + (enhanced.mnemonic ? `\n\n💡 ${enhanced.mnemonic}` : '') + (enhanced.example ? `\n📝 ${enhanced.example}` : '') });
                        }
                      }}
                      disabled={enhancingCardId === card.id}
                      className="p-1.5 text-purple-400 hover:text-purple-600 rounded-md disabled:opacity-50"
                      title="Enhance with AI"
                    >
                      <SparklesIcon className={`w-5 h-5 ${enhancingCardId === card.id ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  <button onClick={() => onOpenEditFlashcard(card)} className="p-1.5 text-lantern-text-secondary hover:text-lantern-primary rounded-md"><PencilIcon className="w-5 h-5"/></button>
                  <button onClick={() => { void confirmDialog({ title: 'Delete flashcard?', message: 'Are you sure you want to delete this flashcard?', danger: true, confirmLabel: 'Delete' }).then((ok) => { if (ok) onDeleteFlashcard(card.id); }); }} className="p-1.5 text-lantern-text-secondary hover:text-red-600 rounded-md"><TrashIcon className="w-5 h-5"/></button>
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
        <div className="text-center py-10 bg-lantern-surface rounded-lg shadow">
          <p className="text-lantern-text-secondary">This deck is empty.</p>
          <p className="text-sm text-lantern-text-tertiary mt-1">Add some cards to start studying!</p>
        </div>
      )}
      </div>
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
      {cramMinutesOpen && (
        <Modal
          isOpen={cramMinutesOpen}
          onClose={() => setCramMinutesOpen(false)}
          ariaLabelledBy="cram-minutes-title"
          maxWidthClass="max-w-sm"
          zIndexClass="z-[70]"
        >
          <div className="space-y-4">
            <h3 id="cram-minutes-title" className="text-lg font-semibold text-lantern-text">Timed cram</h3>
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
              <button type="button" onClick={() => setCramMinutesOpen(false)} className="min-h-[44px] px-3 py-2 text-sm rounded-lg bg-lantern-background-secondary text-lantern-text">Cancel</button>
              <button type="button" onClick={confirmTimedCram} className="min-h-[44px] px-3 py-2 text-sm rounded-lg bg-lantern-primary text-white">Start</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DeckDetailScreen;