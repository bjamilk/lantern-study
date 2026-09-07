import React from 'react';
import { Button } from './Button';
import { Illustration, type IllustrationName } from './Illustration';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG, type FeatureKey } from './featureClasses';

/**
 * The art, and the rule that an illustration always names its feature.
 *
 * A spot illustration is drawn in the feature ink with a ground in the feature
 * tint; without a feature there is no ink and no tint, so "illustration with no
 * feature" is not a state this component can render — the union makes it a
 * compile error rather than something that silently falls back to a hue that
 * belongs to another screen.
 */
type EmptyStateArtProps =
  | {
      /**
       * The screen's spot illustration (§5.6: doors and empty states, nowhere
       * else). Given one it replaces `icon`.
       *
       * Reach for it on a FIRST-RUN empty state — the one a student meets
       * before the screen has ever had anything in it. A no-results state
       * after a search keeps the plain glyph: an illustration there says "this
       * feature is empty" when the truth is "your query matched nothing", and
       * StudyFetch's one-dog-on-every-empty-screen is exactly what that turns
       * into.
       */
      illustration: IllustrationName;
      feature: FeatureKey;
      icon?: undefined;
    }
  | {
      illustration?: undefined;
      /**
       * Paints the panel in the feature's tint with the glyph in its ink — the
       * one full-tint panel a screen is allowed (§5.6). Without it the panel
       * stays neutral, which is right for a state that is not about one
       * feature.
       */
      feature?: FeatureKey;
      icon: React.ReactNode;
    };

interface EmptyStateBaseProps {
  title: string;
  /** The benefit, not the absence: what this screen will do for you once it has something. */
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /**
   * The compact anatomy, and the one to reach for on a wide screen: a neutral
   * card capped at 768 px with a 72 px tint band, the title, one sentence and
   * one action.
   *
   * A phone's full-tint panel is a small share of a narrow column; the same
   * panel stretched across a 1280 px desktop column is a wall of colour that
   * blows the screen's chromatic budget (§5.6: hubs 8–15%, and an empty Tests
   * screen has nothing else to spend it on). Same parts, same order, same
   * meaning as mobile — bounded.
   */
  compact?: boolean;
  className?: string;
}

export type EmptyStateProps = EmptyStateBaseProps & EmptyStateArtProps;

/**
 * The empty-state anatomy: one tint panel, one glyph, a benefit line, one
 * action (a second only when it is a genuinely different route).
 *
 * StudyFetch's counter-example is the same seated dog on every empty screen —
 * an illustration that tells a student nothing about where she is. The glyph
 * here belongs to the feature, and the description says what the screen is for
 * rather than that it is empty.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  illustration,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  feature,
  compact = false,
  className = '',
}) => {
  const actions = (actionLabel && onAction) ? (
    <div className={`flex flex-col sm:flex-row gap-2 ${compact ? '' : 'justify-center'}`}>
      <Button onClick={onAction}>{actionLabel}</Button>
      {secondaryActionLabel && onSecondaryAction && (
        <Button variant="secondary" onClick={onSecondaryAction}>{secondaryActionLabel}</Button>
      )}
    </div>
  ) : null;

  // `illustration && feature` rather than a bare `illustration`: destructuring
  // loses the union's narrowing, and the second half is unreachable by type.
  const art = (size: number) =>
    illustration && feature ? (
      <Illustration name={illustration} feature={feature} size={size} />
    ) : (
      icon
    );

  if (compact) {
    return (
      <div
        className={`w-full max-w-3xl overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface ${className}`}
      >
        <div
          className={`flex h-[72px] items-center px-5 ${
            feature
              ? `${FEATURE_TINT_BG[feature]} ${FEATURE_INK_TEXT[feature]}`
              : 'bg-lantern-primary-background text-lantern-primary-text'
          }`}
        >
          <span aria-hidden="true" className="flex items-center">
            {/* The band is 72 px and so is the drawing — see DoorTile. */}
            {art(72)}
          </span>
        </div>
        <div className="px-5 py-4">
          <h2 className="text-heading text-lantern-text mb-1">{title}</h2>
          <p className="text-body text-lantern-text-secondary max-w-prose">{description}</p>
          {actions && <div className="mt-4">{actions}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`text-center py-10 sm:py-12 px-4 rounded-lantern-xl border ${
        feature
          ? `border-transparent ${FEATURE_TINT_BG[feature]}`
          : 'border-lantern-border bg-lantern-surface'
      } ${className}`}
    >
      {illustration ? (
        // No box. The illustration already carries its own ground ellipse, and
        // a rounded plate behind it would be a second container for one drawing.
        <div className="flex justify-center mb-4">{art(88)}</div>
      ) : (
        <div
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
            feature
              ? `bg-lantern-surface ${FEATURE_INK_TEXT[feature]}`
              : 'bg-lantern-primary-background text-lantern-primary-text'
          }`}
        >
          {icon}
        </div>
      )}
      <h2 className="text-heading sm:text-title text-lantern-text mb-2">{title}</h2>
      <p className="text-body text-lantern-text-secondary mb-6 max-w-sm mx-auto">{description}</p>
      {actions}
    </div>
  );
};

export default EmptyState;
