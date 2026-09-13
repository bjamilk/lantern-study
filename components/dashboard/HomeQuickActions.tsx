import React from 'react';
import {
  HOME_QUICK_ACTIONS,
  quickActionColumns,
  type HomeQuickActionId,
} from '@lantern/shared/dashboard';
import { Illustration } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import { FEATURE_PANEL_INK_OVERRIDE, type FeatureKey } from '../ui/featureClasses';

interface QuickAction {
  id: HomeQuickActionId;
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
   * Two faults were visible on the live grid. Tutor and the companion door both
   * took the `ai` hue, so two of six tiles were the same pink; and Import and
   * Record drew a bare `Illustration`, whose only tinted shape is a small
   * ground ellipse that vanishes on a surface — those two tiles read as
   * untinted next to four tinted discs. Every tile now sits on its own
   * feature tint, so no two doors share hue OR glyph.
   *
   * `notes` stays with Import (materials are notes); the hub takes `sets`,
   * which is the hue the set rooms it opens already wear; Tutor moves to
   * `campus`, one step off the companion's `ai` pink and distinct from it.
   *
   * The LABELS and their ORDER are no longer spelled out here. They come from
   * `HOME_QUICK_ACTIONS` in `@lantern/shared/dashboard`, which mobile's door
   * grid reads too — written out twice, the six doors had already drifted. The
   * hue, the glyph and the handler stay here: they are this platform's own.
   */
  const presentation: Record<
    HomeQuickActionId,
    { icon: AppIconName; feature: FeatureKey; onClick?: () => void }
  > = {
    import: { icon: 'cloud-upload', feature: 'notes', onClick: onImport },
    createQuiz: { icon: 'clipboard-check', feature: 'tests', onClick: onOpenTests },
    askLantern: { icon: 'sparkles', feature: 'ai', onClick: onToggleCompanion },
    tutor: { icon: 'school', feature: 'campus', onClick: onOpenTutor },
    recordLecture: { icon: 'mic', feature: 'recording', onClick: onRecordLecture },
    openStudy: { icon: 'library', feature: 'sets', onClick: onOpenStudyHub },
  };

  const actions: QuickAction[] = HOME_QUICK_ACTIONS.flatMap((door) => {
    const row = presentation[door.id];
    if (!row.onClick) return [];
    return [{ id: door.id, label: door.label, icon: row.icon, feature: row.feature, onClick: row.onClick }];
  });

  if (actions.length === 0) return null;

  return (
    <section>
      <h2 className="text-title font-semibold text-lantern-text mb-4">Quick actions</h2>
      <div
        className={`grid grid-cols-2 gap-3 ${
          quickActionColumns('web') === 3 ? 'sm:grid-cols-3' : ''
        }`}
      >
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
                ) : action.id === 'recordLecture' ? (
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
