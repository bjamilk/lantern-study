import React from 'react';
import {
  SparklesIcon,
  DocumentTextIcon,
  RectangleStackIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

interface DashboardQuickLinksProps {
  dueCardsCount?: number;
  onNavigateToAITools?: () => void;
  onNavigateToNotes?: () => void;
  onNavigateToFlashcards?: () => void;
  onNavigateToMarketplace?: () => void;
}

const linkBase =
  'relative flex flex-col items-center justify-center gap-2 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-lantern transition-all duration-200 hover:scale-[1.02] hover:shadow-lantern-md hover:border-lantern-primary/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';

export const DashboardQuickLinks: React.FC<DashboardQuickLinksProps> = ({
  dueCardsCount = 0,
  onNavigateToAITools,
  onNavigateToNotes,
  onNavigateToFlashcards,
  onNavigateToMarketplace,
}) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    {onNavigateToAITools && (
      <button type="button" onClick={onNavigateToAITools} className={linkBase}>
        <SparklesIcon className="w-6 h-6 text-lantern-accent" />
        <span className="text-xs font-semibold text-lantern-text">AI Tools</span>
      </button>
    )}
    {onNavigateToNotes && (
      <button type="button" onClick={onNavigateToNotes} className={linkBase}>
        <DocumentTextIcon className="w-6 h-6 text-lantern-primary" />
        <span className="text-xs font-semibold text-lantern-text">Notes</span>
      </button>
    )}
    <button type="button" onClick={onNavigateToFlashcards} className={linkBase}>
      <RectangleStackIcon className="w-6 h-6 text-lantern-success" />
      <span className="text-xs font-semibold text-lantern-text">Flashcards</span>
      {dueCardsCount > 0 && (
        <span className="absolute top-2 right-2 bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
          {dueCardsCount > 99 ? '99+' : dueCardsCount}
        </span>
      )}
    </button>
    <button type="button" onClick={onNavigateToMarketplace} className={linkBase}>
      <ShoppingBagIcon className="w-6 h-6 text-lantern-primary" />
      <span className="text-xs font-semibold text-lantern-text">Explore</span>
    </button>
  </div>
);

export default DashboardQuickLinks;
