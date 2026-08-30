import React, { useEffect } from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { CHECKLIST_ITEMS, shouldShowChecklist, type ChecklistItemKey } from '@lantern/shared/featureTips';
import { useFeatureTipStore } from '../../stores/featureTipStore';

interface Props {
  hasDecks: boolean;
  hasTests: boolean;
  hasGroups: boolean;
  hasBudget: boolean;
  hasOpenedLibrary?: boolean;
  hasTriedCompanion?: boolean;
  hasSubmittedQuestion?: boolean;
  hasExploredMarketplace?: boolean;
  hasTriedOffline?: boolean;
  onCreateDeck: () => void;
  onTakeTest: () => void;
  onJoinGroup: () => void;
  onSetBudget: () => void;
  onOpenLibrary?: () => void;
  onTryCompanion?: () => void;
  onSubmitQuestion?: () => void;
  onExploreMarketplace?: () => void;
  onTryOffline?: () => void;
}

export const GettingStartedChecklist: React.FC<Props> = ({
  hasDecks,
  hasTests,
  hasGroups,
  hasBudget,
  hasOpenedLibrary = false,
  hasTriedCompanion = false,
  hasSubmittedQuestion = false,
  hasExploredMarketplace = false,
  hasTriedOffline = false,
  onCreateDeck,
  onTakeTest,
  onJoinGroup,
  onSetBudget,
  onOpenLibrary,
  onTryCompanion,
  onSubmitQuestion,
  onExploreMarketplace,
  onTryOffline,
}) => {
  const tips = useFeatureTipStore((s) => s.tips);
  const hydrated = useFeatureTipStore((s) => s.hydrated);
  const markChecklist = useFeatureTipStore((s) => s.markChecklist);
  const dismissGettingStarted = useFeatureTipStore((s) => s.dismissGettingStarted);
  const hydrate = useFeatureTipStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (hasDecks) markChecklist('createDeck');
    if (hasTests) markChecklist('takeTest');
    if (hasGroups) markChecklist('joinGroup');
    if (hasBudget) markChecklist('setBudget');
    if (hasOpenedLibrary) markChecklist('openLibrary');
    if (hasTriedCompanion) markChecklist('tryCompanion');
    if (hasSubmittedQuestion) markChecklist('submitQuestion');
    if (hasExploredMarketplace) markChecklist('exploreMarketplace');
    if (hasTriedOffline) markChecklist('tryOffline');
  }, [
    hydrated,
    hasDecks,
    hasTests,
    hasGroups,
    hasBudget,
    hasOpenedLibrary,
    hasTriedCompanion,
    hasSubmittedQuestion,
    hasExploredMarketplace,
    hasTriedOffline,
    markChecklist,
  ]);

  if (!hydrated || !shouldShowChecklist(tips)) return null;

  const actions: Partial<Record<ChecklistItemKey, () => void>> = {
    createDeck: onCreateDeck,
    openLibrary: onOpenLibrary,
    takeTest: onTakeTest,
    joinGroup: onJoinGroup,
    tryCompanion: onTryCompanion,
    submitQuestion: onSubmitQuestion,
    setBudget: onSetBudget,
    exploreMarketplace: onExploreMarketplace,
    tryOffline: onTryOffline,
  };

  const items = CHECKLIST_ITEMS.map((item) => ({
    ...item,
    done: Boolean(tips.checklist[item.key]),
    onClick: actions[item.key],
  }));

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="rounded-2xl border border-lantern-primary/30 dark:border-lantern-primary/30 bg-lantern-primary-background dark:bg-lantern-primary-background p-4 mb-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-lantern-primary-dark dark:text-lantern-primary-light">Getting started</h3>
          <p className="text-xs text-lantern-primary/80 dark:text-lantern-primary-light/80">
            {doneCount} of {items.length} complete
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss getting started"
          onClick={() => dismissGettingStarted()}
          className="p-1 rounded-lg text-lantern-primary hover:bg-lantern-primary-background dark:hover:bg-lantern-primary-dark/40"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => item.onClick?.()}
              disabled={item.done || !item.onClick}
              className={`w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
                item.done
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-lantern-primary-dark dark:text-lantern-primary-light hover:bg-lantern-primary-background dark:hover:bg-lantern-primary-dark/40'
              }`}
            >
              {item.done ? (
                <CheckCircleSolid className="w-5 h-5 text-emerald-500 shrink-0" />
              ) : (
                <CheckCircleIcon className="w-5 h-5 text-lantern-primary shrink-0" />
              )}
              <span className={item.done ? 'line-through opacity-80' : ''}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default GettingStartedChecklist;
