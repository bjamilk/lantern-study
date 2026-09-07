import React from 'react';
import { Button } from './Button';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG, type FeatureKey } from './featureClasses';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  /** The benefit, not the absence: what this screen will do for you once it has something. */
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /**
   * Paints the panel in the feature's tint with the glyph in its ink — the one
   * full-tint panel a screen is allowed (§5.6). Without it the panel stays
   * neutral, which is right for a state that is not about one feature.
   */
  feature?: FeatureKey;
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
            {icon}
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
      <div
        className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
          feature
            ? `bg-lantern-surface ${FEATURE_INK_TEXT[feature]}`
            : 'bg-lantern-primary-background text-lantern-primary-text'
        }`}
      >
        {icon}
      </div>
      <h2 className="text-heading sm:text-title text-lantern-text mb-2">{title}</h2>
      <p className="text-body text-lantern-text-secondary mb-6 max-w-sm mx-auto">{description}</p>
      {actions}
    </div>
  );
};

export default EmptyState;
