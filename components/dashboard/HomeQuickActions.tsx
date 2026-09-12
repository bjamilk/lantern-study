import React from 'react';
import { Illustration } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import { FEATURE_PANEL_INK_OVERRIDE, type FeatureKey } from '../ui/featureClasses';

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
   * Six doors, six glyphs, six hues.
   *
   * Two faults were visible on the live grid. Tutor and Chat with Lantern both
   * took the `ai` hue, so two of six tiles were the same pink; and Import and
   * Record drew a bare `Illustration`, whose only tinted shape is a small
   * ground ellipse that vanishes on a surface — those two tiles read as
   * untinted next to four tinted discs. Every tile now sits on its own
   * feature tint, so no two doors share hue OR glyph.
   *
   * `notes` stays with Import (materials are notes); the hub takes `sets`,
   * which is the hue the set rooms it opens already wear; Tutor moves to
   * `campus`, one step off the companion's `ai` pink and distinct from it.
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
      ? { id: 'tutor', label: 'Tutor', icon: 'school' as const, feature: 'campus' as const, onClick: onOpenTutor }
      : null,
    onRecordLecture
      ? { id: 'record', label: 'Record a lecture', icon: 'mic' as const, feature: 'recording' as const, onClick: onRecordLecture }
      : null,
    onOpenStudyHub
      ? { id: 'study', label: 'Open Study', icon: 'library' as const, feature: 'sets' as const, onClick: onOpenStudyHub }
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
            {/* Every mark sits in the feature's tinted square, drawing or
                glyph alike — that is what makes the hue readable as identity.
                The two illustrated doors keep their drawing; it just moves
                inside the tile, repainted to the panel ink with the
                `!important` override so Tailwind's output order cannot flip
                it back to a mid-tone hue on its own pastel. */}
            <FeatureDisc
              feature={action.feature}
              icon={
                // Names stay spelled out here, not looked up from a map: the
                // illustration placement registry (components/ui/Illustration
                // .test.tsx) reads them out of this source, and an indirection
                // makes a drawing invisible to it.
                action.id === 'import' ? (
                  <Illustration
                    name="import-tray"
                    feature={action.feature}
                    size={24}
                    className={FEATURE_PANEL_INK_OVERRIDE[action.feature]}
                  />
                ) : action.id === 'record' ? (
                  <Illustration
                    name="mic-wave"
                    feature={action.feature}
                    size={24}
                    className={FEATURE_PANEL_INK_OVERRIDE[action.feature]}
                  />
                ) : (
                  <AppIcon name={action.icon} size={20} />
                )
              }
            />
            <span className="text-body font-medium text-lantern-text">{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default HomeQuickActions;
