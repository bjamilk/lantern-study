import React from 'react';
import { DocumentTextIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { FeatureHero, StatChip } from './ui';
import { featureAccents } from '@lantern/shared/design';

export type LibraryTab = 'notes' | 'flashcards';

interface LibraryScreenProps {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  notesContent: React.ReactNode;
  flashcardsContent: React.ReactNode;
  dueCardsCount?: number;
  noteCount?: number;
  deckCount?: number;
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
  noteCount,
  deckCount,
}) => (
  <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-lantern-background">
    <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 bg-lantern-background">
      <FeatureHero
        title="Library"
        subtitle="Notes and flashcard decks in one place"
        accentColor={featureAccents.library}
        icon={<RectangleStackIcon className="w-6 h-6" />}
        className="mb-3"
      >
        <div className="flex flex-wrap gap-2">
          {noteCount != null ? (
            <StatChip label={`${noteCount} notes`} variant="primary" />
          ) : null}
          {deckCount != null ? (
            <StatChip label={`${deckCount} decks`} variant="accent" />
          ) : null}
          {dueCardsCount > 0 ? (
            <StatChip label={`${dueCardsCount} due`} variant="neutral" className="bg-lantern-error/10 text-lantern-error" />
          ) : null}
        </div>
      </FeatureHero>
      <div className="flex gap-1 border-b border-lantern-border" role="tablist" aria-label="Library sections">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          const tabId = `library-tab-${id}`;
          const panelId = `library-panel-${id}`;
          return (
            <button
              key={id}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              onClick={() => onTabChange(id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors min-h-[44px] ${
                active
                  ? 'text-lantern-primary bg-lantern-surface border border-b-0 border-lantern-border'
                  : 'text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary'
              }`}
              style={active ? { borderTopWidth: 3, borderTopColor: featureAccents.library } : undefined}
            >
              <Icon className="w-4 h-4" />
              {label}
              {id === 'flashcards' && dueCardsCount > 0 && (
                <span className="bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {dueCardsCount > 99 ? '99+' : dueCardsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
    <div
      id={`library-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`library-tab-${tab}`}
      className="flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      {tab === 'notes' ? notesContent : flashcardsContent}
    </div>
  </div>
);

export default LibraryScreen;
