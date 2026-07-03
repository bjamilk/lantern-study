import React from 'react';
import { DocumentTextIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { ScreenHeader } from './ui';

export type LibraryTab = 'notes' | 'flashcards';

interface LibraryScreenProps {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  notesContent: React.ReactNode;
  flashcardsContent: React.ReactNode;
  dueCardsCount?: number;
}

const tabs: { id: LibraryTab; label: string; icon: React.ElementType }[] = [
  { id: 'notes', label: 'Notes', icon: DocumentTextIcon },
  { id: 'flashcards', label: 'Flashcards', icon: RectangleStackIcon },
];

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  tab,
  onTabChange,
  notesContent,
  flashcardsContent,
  dueCardsCount = 0,
}) => (
  <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-lantern-background">
    <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 border-b border-lantern-border bg-lantern-surface">
      <ScreenHeader
        title="Library"
        subtitle="Notes and flashcard decks in one place"
        className="mb-3 sm:mb-4"
      />
      <div className="flex gap-1 pb-0" role="tablist" aria-label="Library sections">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                active
                  ? 'text-lantern-primary bg-lantern-background border border-b-0 border-lantern-border'
                  : 'text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {id === 'flashcards' && dueCardsCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {dueCardsCount > 99 ? '99+' : dueCardsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col" role="tabpanel">
      {tab === 'notes' ? notesContent : flashcardsContent}
    </div>
  </div>
);

export default LibraryScreen;
