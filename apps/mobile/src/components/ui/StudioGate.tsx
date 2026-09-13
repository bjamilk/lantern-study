/**
 * `<StudioGate/>` — the one surface a blocked studio is allowed to show.
 *
 * SF2 mobile evidence §4.2: StudyFetch never renders a naked sentence. Every
 * blocked screen keeps its chrome and puts the blocker in a card with a mark,
 * a title and something to press. Lantern's quiz studio on an empty set showed
 * two grey sentences on 1700 px of bare cream and no button at all
 * (`ln-19-quiz-empty.png`). Four more studios did the same.
 *
 * The anatomy, from that evidence:
 *
 *   ┌──────────────────────────────────────┐  white surface, hairline border,
 *   │  ▢  (pastel disc, the studio's hue)  │  radius 14 (SHEET.rowRadius — the
 *   │                                      │  white-row-on-cream shape), and
 *   │  Start from a note        ← serif    │  NO shadow: the neo-brutalist
 *   │  Import or create a note…  ← body    │  hard black offset that the room
 *   │  Writing new questions uses 1 AI use.│  tiles use appears nowhere in
 *   │  [ Import materials ] [ Create a… ]  │  StudyFetch (evidence §4.1).
 *   └──────────────────────────────────────┘
 *
 * Two rules this component enforces on its callers rather than trusting them
 * with:
 *
 *  1. It cannot be rendered without actions — `content.actions` comes from
 *     `studioGate()`, which is tested to always return at least one. A gate
 *     with nothing to tap is the defect, not a variant of it.
 *  2. It does NOT fill the screen or hide anything above it. The caller keeps
 *     its header, its search field and its toolbar, because StudyFetch keeps
 *     them and because a toolbar that vanishes when a list empties is a
 *     toolbar the student cannot use to un-empty the list.
 *
 * Type comes from `T` and the Button pill from `Button`, so the gate inherits
 * the six steps, the font-scale setting and both palettes rather than sizing
 * anything itself.
 */
import React from 'react';
import { View } from 'react-native';
import type { FeatureKey } from '@lantern/shared/design';
import { SHEET, useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { FeatureDisc } from './FeatureDisc';
// From the barrel, which re-exports this file: a cycle on paper, and inert in
// practice because `Button` is only ever READ at render time, long after both
// modules have finished evaluating. `Button` lives inside index.tsx itself, so
// there is no module underneath it to import instead (the BottomTabBar note at
// the top of index.tsx is the case where there was one).
import { Button } from './index';
import { T } from './Text';
import type { StudioGateAction, StudioGateContent } from './studioGateModel';

export interface StudioGateProps {
  /** What to say and what to offer — always from `studioGate()`. */
  content: StudioGateContent;
  /** The studio's hue. Quiz is `tests`, the tutor and the recap `ai`, … */
  feature: FeatureKey;
  /** The glyph on the disc: the same one the studio's door tile carries. */
  icon: AppIconName;
  /** Routed by the caller, which alone knows the set the studio was opened on. */
  onAction: (action: StudioGateAction) => void;
  className?: string;
}

export function StudioGate({
  content,
  feature,
  icon,
  onAction,
  className = '',
}: StudioGateProps) {
  const { colors } = useTheme();
  return (
    <View
      className={`bg-lantern-surface border border-lantern-border ${className}`}
      // Radius from the token, not from a Tailwind class: this project's
      // NativeWind inlines rem at 14, so `rounded-xl` does not land on 14 dp.
      // No shadow* keys at all — see the header note.
      style={{ borderRadius: SHEET.rowRadius, padding: 20, gap: 12 }}
      accessible={false}
    >
      <FeatureDisc feature={feature} icon={icon} size={56} />
      <View style={{ gap: 6 }}>
        <T.Title accessibilityRole="header">{content.title}</T.Title>
        <T.Body tone="secondary">{content.body}</T.Body>
        {content.costLine ? (
          <View className="flex-row items-center gap-1.5">
            <AppIcon
              name="sparkles"
              size={14}
              color={colors.textTertiary}
              importantForAccessibility="no"
            />
            {/* Tertiary, not secondary: the price is true and must be legible,
                but it is not the sentence the student is here to read. */}
            <T.Caption tone="tertiary">{content.costLine}</T.Caption>
          </View>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {content.actions.map((action) => (
          <Button
            key={action.id}
            variant={action.variant === 'primary' ? 'primary' : 'secondary'}
            onPress={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </View>
    </View>
  );
}

export default StudioGate;
