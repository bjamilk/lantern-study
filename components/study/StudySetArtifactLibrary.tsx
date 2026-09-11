import React from 'react';
import { Button, FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';

export interface ArtifactCard {
  id: string;
  title: string;
  preview?: string | null;
  meta?: string;
  feature: 'tests' | 'flashcards' | 'ai';
  icon: 'clipboard' | 'layers' | 'headphones';
}

interface StudySetArtifactLibraryProps {
  title: string;
  empty: string;
  items: ArtifactCard[];
  onOpen: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
}

export const StudySetArtifactLibrary: React.FC<StudySetArtifactLibraryProps> = ({
  title,
  empty,
  items,
  onOpen,
  onCreate,
  createLabel = 'New',
}) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading">{title}</h2>
        {onCreate ? (
          <Button size="sm" onClick={onCreate}>
            {createLabel}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-body text-lantern-text-secondary">{empty}</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="w-full rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary"
          >
            <div className="flex items-start gap-3">
              <FeatureDisc feature={item.feature} icon={<AppIcon name={item.icon} size={18} />} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold truncate">{item.title}</span>
                {item.preview ? (
                  <span className="mt-1 block text-caption text-lantern-text-secondary line-clamp-2">
                    {item.preview}
                  </span>
                ) : null}
                {item.meta ? (
                  <span className="mt-1 block text-caption text-lantern-text-tertiary">{item.meta}</span>
                ) : null}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
};

export default StudySetArtifactLibrary;
