import React from 'react';
import { DocumentTextIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { FeatureHero, StatChip, Tabs, TabList, Tab, TabPanel } from './ui';
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
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as LibraryTab)}
      aria-label="Library sections"
      className="flex-1 flex flex-col min-h-0"
    >
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 bg-lantern-background">
        <FeatureHero
          title="Library"
          subtitle="Notes and flashcard decks in one place"
        accentColor={featureAccents.library}
        icon={<RectangleStackIcon className="w-6 h-6 text-lantern-feature-library" />}
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
        <TabList>
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <Tab
              key={id}
              value={id}
              index={index}
              icon={<Icon className="w-4 h-4" />}
              style={tab === id ? { borderTopWidth: 3, borderTopColor: featureAccents.library } : undefined}
              badge={
                id === 'flashcards' && dueCardsCount > 0 ? (
                  <span className="bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {dueCardsCount > 99 ? '99+' : dueCardsCount}
                  </span>
                ) : undefined
              }
            >
              {label}
            </Tab>
          ))}
        </TabList>
      </div>
      <TabPanel value="notes" className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {notesContent}
      </TabPanel>
      <TabPanel value="flashcards" className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {flashcardsContent}
      </TabPanel>
    </Tabs>
  </div>
);

export default LibraryScreen;
