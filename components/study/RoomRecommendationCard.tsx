import React, { useState } from 'react';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { Illustration, type IllustrationName } from '../ui/Illustration';
import { TileScene, type TileSceneName } from '../ui/TileScene';
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
  /**
   * The landscape scene for this door, where the art set has one. It wins
   * over `illustration` and over the glyph: the scene was drawn FOR this
   * pastel band, where a square spot drawing is a picture parked in the
   * middle of a landscape panel and a 40px glyph is a label.
   */
  scene?: TileSceneName;
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
  scene,
  eyebrow,
  label,
  about,
  onClick,
}) => {
  const [showAbout, setShowAbout] = useState(false);

  return (
    // The measured card: 235×200, `rounded-xl` (r12), one hairline, no shadow.
    // `min-h` rather than `h`, because the About disclosure expands INSIDE it
    // and a fixed height would either clip that sentence or force it into a
    // popover — and the whole reason About is a disclosure is that a tooltip
    // does not exist on a touch screen.
    <div className="relative flex min-h-[200px] flex-col overflow-hidden rounded-xl border border-lantern-border bg-lantern-surface">
      {/* `About ⓘ` is the card's TOP-RIGHT corner, at an 8px inset, as
          measured — not a footer control. It sits OUTSIDE the card button (a
          <button> inside a <button> is markup the keyboard cannot reach) and
          above it in the stacking order, so the ring is drawn over the
          illustration band. */}
      <button
        type="button"
        onClick={() => setShowAbout((value) => !value)}
        aria-expanded={showAbout}
        aria-label={`About ${label}`}
        // 16×16 glyph with a 44px hit target from the pseudo-element rather
        // than from a bigger mark — the reference's (i) is 16px.
        className="absolute right-2 top-2 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full text-lantern-text-secondary after:absolute after:-inset-3.5 after:content-[''] hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
      >
        <AppIcon name="information-circle" size={16} />
      </button>
      <button
        type="button"
        onClick={onClick}
        className="block w-full flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lantern-ink/40"
      >
        <div
          className={`flex h-[104px] items-center justify-center ${FEATURE_TINT_BG[feature]} ${FEATURE_PANEL_INK_TEXT[feature]}`}
        >
          {scene ? (
            <TileScene scene={scene} feature={feature} height={84} />
          ) : illustration ? (
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
        {/* THE EYEBROW IS THE CARD'S VOICE, and it is the serif: doc 02
            measures it Bitter 18/28 weight 500 in the body ink, the same role
            as a section eyebrow. It shipped as 14px secondary sans, which read
            as a caption above a label — two quiet lines and no hierarchy. The
            label under it is the 14/500 the reference sets, with the 16px
            glyph that tells three cards apart at a glance.
            `font-display` explicitly: only `text-display` / `text-title` carry
            the family, and this is the `heading` step. */}
        <div className="px-3 pt-2.5">
          <p className="text-heading font-display text-lantern-text">{eyebrow}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-body font-medium text-lantern-text-secondary">
            <AppIcon name={icon} size={16} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </p>
        </div>
      </button>
      {showAbout ? (
        <p className="px-3 pb-2.5 text-caption text-lantern-text-secondary">{about}</p>
      ) : null}
    </div>
  );
};

export default RoomRecommendationCard;
