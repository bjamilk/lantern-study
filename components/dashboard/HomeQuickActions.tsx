import React from 'react';
import { Illustration } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

interface QuickAction {
  id: string;
  label: string;
  icon: AppIconName;
  onClick: () => void;
}

interface HomeQuickActionsProps {
  onImport?: () => void;
  onOpenTests?: () => void;
  onToggleCompanion?: () => void;
  onReviewDueCards?: () => void;
  onRecordLecture?: () => void;
  onOpenStudyHub?: () => void;
}

export const HomeQuickActions: React.FC<HomeQuickActionsProps> = ({
  onImport,
  onOpenTests,
  onToggleCompanion,
  onReviewDueCards,
  onRecordLecture,
  onOpenStudyHub,
}) => {
  const actions: QuickAction[] = [
    onImport
      ? { id: 'import', label: 'Import materials', icon: 'cloud-upload' as const, onClick: onImport }
      : null,
    onOpenTests
      ? { id: 'test', label: 'Create a quiz', icon: 'clipboard-check' as const, onClick: onOpenTests }
      : null,
    onToggleCompanion
      ? { id: 'ai', label: 'Chat with Lantern', icon: 'sparkles' as const, onClick: onToggleCompanion }
      : null,
    onReviewDueCards
      ? { id: 'review', label: 'Review cards', icon: 'albums' as const, onClick: onReviewDueCards }
      : null,
    onRecordLecture
      ? { id: 'record', label: 'Record a lecture', icon: 'mic' as const, onClick: onRecordLecture }
      : null,
    onOpenStudyHub
      ? { id: 'study', label: 'Open Study', icon: 'school' as const, onClick: onOpenStudyHub }
      : null,
  ].filter((action): action is QuickAction => action != null);

  if (actions.length === 0) return null;

  return (
    <section>
      <h2 className="text-title font-semibold text-lantern-text mb-4">Quick actions</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            className="flex flex-col items-center justify-center gap-3 min-h-[7.5rem] rounded-2xl border border-lantern-border bg-lantern-surface px-4 py-5 text-center hover:bg-lantern-background-secondary/70 transition-colors"
          >
            {action.id === 'review' ? (
              <Illustration name="cards-fan" feature="flashcards" size={40} />
            ) : action.id === 'record' ? (
              <Illustration name="mic-wave" feature="recording" size={40} />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lantern-background-secondary text-lantern-text">
                <AppIcon name={action.icon} size={20} />
              </span>
            )}
            <span className="text-body font-medium text-lantern-text">{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default HomeQuickActions;
