import React, { useState } from 'react';
import { Deck, Flashcard, FlashcardType } from '../types';
import { useAuthStore } from '../stores/authStore';
import { ArrowUturnLeftIcon, PlayCircleIcon, PlusCircleIcon, PencilIcon, TrashIcon, SparklesIcon, BoltIcon, ArrowPathIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import GenerateFlashcardsModal from './GenerateFlashcardsModal';
import CollaboratorsModal from './CollaboratorsModal';
import StudySessionModal from './StudySessionModal';
import { MarkdownRenderer } from '@lantern/shared';

interface DeckDetailScreenProps {
  deck: Deck;
  flashcards: Flashcard[];
  onBack: () => void;
  onStartReview: (deck: Deck) => void;
  onStartCram: (deck: Deck, timerSeconds?: number) => void;
  onOpenCreateFlashcard: (deckId: string) => void;
  onOpenEditFlashcard: (flashcard: Flashcard) => void;
  onDeleteFlashcard: (flashcardId: string) => void;
  onOpenEditDeck: (deck: Deck) => void;
  onDeleteDeck: (deckId: string) => void;
  onGenerateFlashcards: (deckId: string, notes: string, count: number) => void;
  isGenerating: boolean;
  onResetStatistics: (deckId: string) => void;
  onLoadMoreCards?: (deckId: string, page: number) => Promise<number>;
  onEnhanceFlashcard?: (front: string, back: string) => Promise<{ front: string; back: string; mnemonic?: string; example?: string } | null>;
  autoJoinSessionId?: string;
  onDeepLinkHandled?: () => void;
}

const DeckDetailScreen: React.FC<DeckDetailScreenProps> = ({
  deck,
  flashcards,
  onBack,
  onStartReview,
  onStartCram,
  onOpenCreateFlashcard,
  onOpenEditFlashcard,
  onDeleteFlashcard,
  onOpenEditDeck,
  onDeleteDeck,
  onGenerateFlashcards,
  isGenerating,
  onResetStatistics,
  onLoadMoreCards,
  onEnhanceFlashcard,
  autoJoinSessionId,
  onDeepLinkHandled,
}) => {
  const currentUser = useAuthStore(s => s.currentUser);
  const cardsInDeck = flashcards.filter(fc => fc && fc.deckId === deck.id);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isCollaboratorsModalOpen, setIsCollaboratorsModalOpen] = useState(false);
  const [isStudySessionModalOpen, setIsStudySessionModalOpen] = useState(false);
  const [pendingJoinSessionId, setPendingJoinSessionId] = useState<string | null>(null);
  const [enhancingCardId, setEnhancingCardId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const CARDS_PER_PAGE = 20;

  React.useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [deck.id]);

  const today = new Date().toISOString().split('T')[0];
  const newCards = cardsInDeck.filter(fc => !fc.srsData?.repetitions).length;
  const dueCards = cardsInDeck.filter(fc => fc.srsData && fc.srsData.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length;
  const reviewedCards = cardsInDeck.filter(fc => fc.srsData?.repetitions && fc.srsData.repetitions > 0);
  const avgEaseFactor = reviewedCards.length > 0 ? reviewedCards.reduce((sum, fc) => sum + (fc.srsData?.easeFactor || 0), 0) / reviewedCards.length : 0;
  const leechCards = cardsInDeck.filter(fc => fc.srsData?.isLeech).length;

  const handleDeleteDeckClick = () => {
    if (window.confirm(`Are you sure you want to delete the deck "${deck.name}"? This will also delete all ${cardsInDeck.length} cards inside it. This action cannot be undone.`)) {
      onDeleteDeck(deck.id);
    }
  };
  
  const handleGenerateSubmit = (notes: string, count: number) => {
    onGenerateFlashcards(deck.id, notes, count);
    setIsGenerateModalOpen(false);
  };

  React.useEffect(() => {
    if (autoJoinSessionId) {
      setIsStudySessionModalOpen(true);
      setPendingJoinSessionId(autoJoinSessionId);
      onDeepLinkHandled?.();
    }
  }, [autoJoinSessionId, onDeepLinkHandled]);

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
    <div className="h-screen flex flex-col flex-1 overflow-y-auto p-4 md:p-6 bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      <div className="mb-6 pb-4 border-b border-slate-300 dark:border-slate-700">
        <button onClick={onBack} className="flex items-center text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mb-4">
          <ArrowUturnLeftIcon className="w-5 h-5 mr-1.5" />
          Back to All Decks
        </button>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100">{deck.name}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{deck.description || 'No description.'}</p>
            </div>
            <div className="flex space-x-2 mt-3 sm:mt-0 flex-wrap gap-2">
                <button onClick={() => onOpenEditDeck(deck)} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-md flex items-center text-sm shadow"><PencilIcon className="w-4 h-4 mr-1.5" /> Edit</button>
                {deck.isShared && (
                  <>
                    <button onClick={() => setIsCollaboratorsModalOpen(true)} className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md flex items-center text-sm shadow">
                      <UserGroupIcon className="w-4 h-4 mr-1.5" /> Collaborators
                    </button>
                    <button onClick={() => setIsStudySessionModalOpen(true)} className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md flex items-center text-sm shadow">
                      <SparklesIcon className="w-4 h-4 mr-1.5" /> Shared Session
                    </button>
                  </>
                )}
                <button onClick={() => { if(window.confirm('Are you sure you want to reset all SRS statistics for this deck? This will mark all cards as new.')) onResetStatistics(deck.id) }} className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center text-sm shadow"><ArrowPathIcon className="w-4 h-4 mr-1.5" /> Reset Stats</button>
                <button onClick={handleDeleteDeckClick} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md flex items-center text-sm shadow"><TrashIcon className="w-4 h-4 mr-1.5" /> Delete</button>
            </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
         <button onClick={() => onStartReview(deck)} className="p-3 bg-rose-500 hover:bg-rose-600 text-white rounded-lg shadow-sm text-left flex items-center justify-center transition-transform hover:scale-105">
             <PlayCircleIcon className="w-6 h-6 mr-2" />
             <div>
                <h2 className="text-lg font-semibold">Study Now</h2>
                <p className="text-xs">Spaced Repetition</p>
             </div>
        </button>
         <div className="grid grid-cols-2 gap-2">
           <button onClick={() => onStartCram(deck)} className="p-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg shadow-sm text-left flex items-center justify-center transition-transform hover:scale-105">
             <BoltIcon className="w-6 h-6 mr-2" />
             <div>
                <h2 className="text-lg font-semibold">Cram Mode</h2>
                <p className="text-xs">Review all cards</p>
             </div>
           </button>
           <button
             onClick={() => {
               const minutes = window.prompt('Enter duration in minutes for timed cram (e.g. 5):');
               if (!minutes) return;
               const parsed = parseFloat(minutes);
               if (isNaN(parsed) || parsed <= 0) {
                 alert('Please enter a valid number of minutes.');
                 return;
               }
               onStartCram(deck, Math.round(parsed * 60));
             }}
             className="p-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-sm text-left flex items-center justify-center transition-transform hover:scale-105"
           >
             <ClockIcon className="w-6 h-6 mr-2" />
             <div>
                <h2 className="text-lg font-semibold">Timed Cram</h2>
                <p className="text-xs">Beat the clock</p>
             </div>
           </button>
         </div>
         <button onClick={() => onOpenCreateFlashcard(deck.id)} className="p-3 bg-green-500 hover:bg-green-600 text-white rounded-lg shadow-sm text-left flex items-center justify-center transition-transform hover:scale-105">
             <PlusCircleIcon className="w-6 h-6 mr-2" />
             <div>
                <h2 className="text-lg font-semibold">Add Card</h2>
                <p className="text-xs">Manually create</p>
             </div>
        </button>
         <button onClick={() => setIsGenerateModalOpen(true)} disabled={isGenerating} className="p-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg shadow-sm text-left flex items-center justify-center transition-transform hover:scale-105">
             <SparklesIcon className="w-6 h-6 mr-2" />
             <div>
                <h2 className="text-lg font-semibold">{isGenerating ? 'Generating...' : 'Generate'}</h2>
                <p className="text-xs">From your notes</p>
             </div>
        </button>
      </div>

      <h2 className="text-xl font-semibold mb-3 text-slate-700 dark:text-slate-300">
        Flashcards in this Deck ({cardsInDeck.length})
        {hasMore && (
          <span className="ml-3 text-sm text-slate-500 dark:text-slate-400">(showing first {CARDS_PER_PAGE}, load more below)</span>
        )}
      </h2>
      
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-260px)]">
        {cardsInDeck.length > 0 && (
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div className="text-center">
                <div className="font-semibold text-blue-600">{newCards}</div>
                <div className="text-slate-500 dark:text-slate-400">New Cards</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-green-600">{dueCards}</div>
                <div className="text-slate-500 dark:text-slate-400">Due Today</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-purple-600">{reviewedCards.length}</div>
                <div className="text-slate-500 dark:text-slate-400">Reviewed</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-orange-600">{avgEaseFactor.toFixed(2)}</div>
                <div className="text-slate-500 dark:text-slate-400">Avg Ease</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-red-600">{leechCards}</div>
                <div className="text-slate-500 dark:text-slate-400">Leeches</div>
              </div>
            </div>
          </div>
        )}
        
        {cardsInDeck.length > 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {cardsInDeck.map(card => (
              <li key={card.id} className="p-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <div className="text-sm text-slate-800 dark:text-slate-200 flex-grow pr-4 truncate" title={getCardPreview(card)}>
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
                  <button onClick={() => onOpenEditFlashcard(card)} className="p-1.5 text-slate-500 hover:text-indigo-600 rounded-md"><PencilIcon className="w-5 h-5"/></button>
                  <button onClick={() => { if(window.confirm('Are you sure you want to delete this flashcard?')) onDeleteFlashcard(card.id) }} className="p-1.5 text-slate-500 hover:text-red-600 rounded-md"><TrashIcon className="w-5 h-5"/></button>
                </div>
              </li>
            ))}
          </ul>

          {onLoadMoreCards && hasMore && (
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-md shadow-sm disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading…' : 'Load more cards'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-lg shadow">
          <p className="text-slate-500 dark:text-slate-400">This deck is empty.</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Add some cards to start studying!</p>
        </div>
      )}
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
      <StudySessionModal
        isOpen={isStudySessionModalOpen}
        onClose={() => {
          setIsStudySessionModalOpen(false);
          setPendingJoinSessionId(null);
        }}
        deckId={deck.id}
        autoJoinCode={pendingJoinSessionId ?? undefined}
      />
    </div>
  );
};

export default DeckDetailScreen;