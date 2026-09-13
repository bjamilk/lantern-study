import React, { useState } from 'react';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { Illustration, type IllustrationName } from '../ui/Illustration';
import {
  FEATURE_PANEL_INK_OVERRIDE,
  FEATURE_PANEL_INK_TEXT,
  FEATURE_TINT_BG,
  type FeatureKey,
} from '../ui/featureClasses';

interface RoomRecommendationCardProps {
  feature: FeatureKey;
  icon: AppIconName;
  illustration?: IllustrationName;
  /** "Recommended", "Catch up quickly", "Most used". */
  eyebrow: string;
  label: string;
  /** What `About ⓘ` reveals. One sentence — why this door is being offered. */
  about: string;
  onClick: () => void;
}

/**
 * One of the three ways into the current topic.
 *
 * WHY THIS IS NOT `DoorTile`. The two differ in exactly the three ways the SF2
 * evidence pass flagged: `DoorTile` sits on a hard black offset shadow (killed
 * app-wide at the token this round), its pastel panel is 112px where the
 * reference's illustration tile is deliberately the card's largest element, and
 * it draws the feature's glyph TWICE — once enlarged on the panel and once again
 * in a footer row. The repeat is the tell: three cards side by side showed six
 * copies of three glyphs. `DoorTile` is still right for the places that need a
 * count in a footer; this is right here, and lives in the study lane rather than
 * forking a shared primitive other screens depend on.
 *
 * `About ⓘ` is the reference's affordance for "why am I being shown this", and
 * it is a disclosure rather than a tooltip so it works on a touch screen. It
 * stops the click from reaching the card — the whole card is the button.
 */
export const RoomRecommendationCard: React.FC<RoomRecommendationCardProps> = ({
  feature,
  icon,
  illustration,
  eyebrow,
  label,
  about,
  onClick,
}) => {
  const [showAbout, setShowAbout] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface">
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lantern-ink/40"
      >
        <div
          className={`flex h-32 items-center justify-center ${FEATURE_TINT_BG[feature]} ${FEATURE_PANEL_INK_TEXT[feature]}`}
        >
          {illustration ? (
            <Illustration
              name={illustration}
              feature={feature}
              size={64}
              className={FEATURE_PANEL_INK_OVERRIDE[feature]}
            />
          ) : (
            <AppIcon name={icon} size={40} aria-hidden />
          )}
        </div>
        <div className="px-4 pt-3">
          <p className="text-caption text-lantern-text-secondary">{eyebrow}</p>
          <p className="text-heading text-lantern-text mt-0.5">{label}</p>
        </div>
      </button>
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => setShowAbout((value) => !value)}
          aria-expanded={showAbout}
          className="inline-flex min-h-[36px] items-center gap-1.5 text-caption text-lantern-text-secondary hover:text-lantern-text"
        >
          About
          <AppIcon name="information-circle" size={14} />
        </button>
        {showAbout ? (
          <p className="text-caption text-lantern-text-secondary pb-1">{about}</p>
        ) : null}
      </div>
    </div>
  );
};

export default RoomRecommendationCard;
