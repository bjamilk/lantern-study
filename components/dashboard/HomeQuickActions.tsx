import React from 'react';
import { Illustration } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import type { FeatureKey } from '../ui/featureClasses';

interface QuickAction {
  id: string;
  label: string;
  icon: AppIconName;
  /** Hue for the tile's disc. Identity, never state. */
  feature: FeatureKey;
  onClick: () => void;
}

interface HomeQuickActionsProps {
  onImport?: () => void;
  onOpenTests?: () => void;
  onToggleCompanion?: () => void;
  onOpenTutor?: () => void;
  onRecordLecture?: () => void;
  onOpenStudyHub?: () => void;
}

export const HomeQuickActions: React.FC<HomeQuickActionsProps> = ({
  onImport,
  onOpenTests,
  onToggleCompanion,
  onOpenTutor,
  onRecordLecture,
  onOpenStudyHub,
}) => {
  /**
   * Six doors, six glyphs. Tutor and Open Study both wore `school` and the
   * three plain tiles fell to a grey disc, so half the grid looked alike: the
   * tile that opens a tutor now carries the lesson mortarboard on the AI hue
   * and the hub carries a library.
   */
  const actions: QuickAction[] = ([
    onImport
      ? { id: 'import', label: 'Import materials', icon: 'cloud-upload' as const, feature: 'notes' as const, onClick: onImport }
      : null,
    onOpenTests
      ? { id: 'test', label: 'Create a quiz', icon: 'clipboard-check' as const, feature: 'tests' as const, onClick: onOpenTests }
      : null,
    onToggleCompanion
      ? { id: 'ai', label: 'Chat with Lantern', icon: 'sparkles' as const, feature: 'ai' as const, onClick: onToggleCompanion }
      : null,
    onOpenTutor
      ? { id: 'tutor', label: 'Tutor', icon: 'school' as const, feature: 'ai' as const, onClick: onOpenTutor }
      : null,
    onRecordLecture
      ? { id: 'record', label: 'Record a lecture', icon: 'mic' as const, feature: 'recording' as const, onClick: onRecordLecture }
      : null,
    onOpenStudyHub
      ? { id: 'study', label: 'Open Study', icon: 'library' as const, feature: 'notes' as const, onClick: onOpenStudyHub }
      : null,
  ] as (QuickAction | null)[]).filter((action): action is QuickAction => action != null);

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
            {action.id === 'import' ? (
              <Illustration name="import-tray" feature={action.feature} size={40} />
            ) : action.id === 'record' ? (
              <Illustration name="mic-wave" feature={action.feature} size={40} />
            ) : (
              <FeatureDisc
                feature={action.feature}
                icon={<AppIcon name={action.icon} size={20} />}
              />
            )}
            <span className="text-body font-medium text-lantern-text">{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default HomeQuickActions;
