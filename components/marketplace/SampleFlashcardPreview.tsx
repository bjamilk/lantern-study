import React from 'react';
import { FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';

interface SampleFlashcardPreviewProps {
  fronts: string[];
}

/**
 * Marketplace sample fronts, drawn as the same paper + lime rail as Review.
 * A grey list of prompt text used to look like a note dump, not a deck.
 */
export function SampleFlashcardPreview({ fronts }: SampleFlashcardPreviewProps) {
  if (fronts.length === 0) return null;
  return (
    <ul className="space-y-2">
      {fronts.map((front, index) => (
        <li
          key={`${index}-${front.slice(0, 24)}`}
          className="relative overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface"
        >
          <span className="absolute inset-x-0 top-0 h-[3px] bg-lantern-feature-flashcards-ink" aria-hidden />
          <div className="flex items-start gap-3 px-3 pb-3 pt-4">
            <FeatureDisc
              feature="flashcards"
              icon={<AppIcon name="layers" size={16} />}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="text-label font-semibold uppercase tracking-wider text-lantern-feature-flashcards-ink">
                Question
              </p>
              <p className="mt-1 text-body text-lantern-text line-clamp-3">{front}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default SampleFlashcardPreview;
