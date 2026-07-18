import React, { useEffect, useState } from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

const STORAGE_KEY = 'lantern_getting_started_v1';

export interface GettingStartedProgress {
  dismissed: boolean;
  createDeck: boolean;
  takeTest: boolean;
  joinGroup: boolean;
  setBudget: boolean;
}

const defaultProgress: GettingStartedProgress = {
  dismissed: false,
  createDeck: false,
  takeTest: false,
  joinGroup: false,
  setBudget: false,
};

function loadProgress(): GettingStartedProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultProgress };
    return { ...defaultProgress, ...JSON.parse(raw) };
  } catch {
    return { ...defaultProgress };
  }
}

function saveProgress(p: GettingStartedProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

interface Props {
  hasDecks: boolean;
  hasTests: boolean;
  hasGroups: boolean;
  hasBudget: boolean;
  onCreateDeck: () => void;
  onTakeTest: () => void;
  onJoinGroup: () => void;
  onSetBudget: () => void;
}

export const GettingStartedChecklist: React.FC<Props> = ({
  hasDecks,
  hasTests,
  hasGroups,
  hasBudget,
  onCreateDeck,
  onTakeTest,
  onJoinGroup,
  onSetBudget,
}) => {
  const [progress, setProgress] = useState<GettingStartedProgress>(loadProgress);

  useEffect(() => {
    setProgress((prev) => {
      const next = {
        ...prev,
        createDeck: prev.createDeck || hasDecks,
        takeTest: prev.takeTest || hasTests,
        joinGroup: prev.joinGroup || hasGroups,
        setBudget: prev.setBudget || hasBudget,
      };
      saveProgress(next);
      return next;
    });
  }, [hasDecks, hasTests, hasGroups, hasBudget]);

  if (progress.dismissed) return null;

  const items = [
    { key: 'createDeck' as const, label: 'Create a flashcard deck', done: progress.createDeck, onClick: onCreateDeck },
    { key: 'takeTest' as const, label: 'Take a practice test', done: progress.takeTest, onClick: onTakeTest },
    { key: 'joinGroup' as const, label: 'Join or create a study group', done: progress.joinGroup, onClick: onJoinGroup },
    { key: 'setBudget' as const, label: 'Set your monthly budget', done: progress.setBudget, onClick: onSetBudget },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="rounded-2xl border border-lantern-primary/30 dark:border-lantern-primary/30 bg-lantern-primary-background/80 dark:bg-lantern-primary-background p-4 mb-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-lantern-primary-dark dark:text-lantern-primary-light">Getting started</h3>
          <p className="text-xs text-lantern-primary/80 dark:text-lantern-primary-light/80">{doneCount} of {items.length} complete</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss getting started"
          onClick={() => {
            const next = { ...progress, dismissed: true };
            setProgress(next);
            saveProgress(next);
          }}
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
              onClick={item.onClick}
              disabled={item.done}
              className={`w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors ${
                item.done
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-lantern-primary-dark dark:text-lantern-primary-light hover:bg-lantern-primary-background/80 dark:hover:bg-lantern-primary-dark/40'
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
