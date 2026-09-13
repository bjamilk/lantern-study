import React, { useEffect } from 'react';
import { Pressable, Text, ActivityIndicator, View, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Imported from the module, not the layout barrel: the barrel re-exports
// BottomTabBar, which imports from this file, and that would be a cycle.
import { useScreenBottomPadding } from '../layout/Screen';
import { useToastStore } from '../../stores/toastStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { BackButton } from './BackButton';
// The shared sheet affordance. ActionSheet owns it; the confirm sheet draws
// the same one so the two panels are visibly the same object.
import { SheetGrabber } from './ActionSheet';
import { BUTTON, CARD, SHEET, serifDisplayStyle, useTheme } from '../../theme';
import {
  featureAccentsDark,
  featureAccentsLight,
  type FeatureKey,
  type IllustrationName,
} from '@lantern/shared/design';
import { FeatureDisc, smallTextInk } from './FeatureDisc';
import { Illustration } from './Illustration';
import { AppIcon, type AppIconName } from './AppIcon';
import { Body, Heading, Label } from './Text';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

/**
 * The button, in the StudyFetch anatomy (founder direction 2026-09-11).
 *
 * Measured at 240x94 px on a 420 dpi phone: 36 dp tall at radius 18, i.e.
 * FULLY rounded. A primary is a black fill under a white label; a secondary is
 * the same pill with no fill and a hairline; a destructive is the same pill
 * filled red. There is no indigo button any more — the accent survives as
 * text and as a glyph, and a screen that had two indigo fills on it had two
 * things claiming to be the one next step.
 *
 * WHY THE HEIGHT AND RADIUS ARE INLINE STYLE AND NOT CLASSES. This project's
 * NativeWind inlines `rem` at 14, so `py-2.5` is 8.75 and `rounded-2xl` is 22
 * — neither is the measured number, and a Tailwind height class cannot reach
 * 36 at all. The numbers live in `theme/surfaceMetrics.ts` beside the pill the
 * bottom bar draws, because a lit tab and a primary button are the same object
 * at two widths and must not drift apart.
 */
const BUTTON_SIZE: Record<Size, { height: number; radius: number; paddingHorizontal: number }> = {
  sm: { height: BUTTON.heightSmall, radius: BUTTON.radiusSmall, paddingHorizontal: 14 },
  md: { height: BUTTON.height, radius: BUTTON.radius, paddingHorizontal: BUTTON.paddingHorizontal },
  lg: { height: BUTTON.heightLarge, radius: BUTTON.radiusLarge, paddingHorizontal: 22 },
};

/**
 * Fill and label, per variant, resolved against the theme rather than named as
 * classes: "black" is the page's ink in light and its paper in dark, and there
 * is no Tailwind token for "the inverse of the text colour".
 */
function useButtonSkin(variant: Variant): {
  backgroundColor: string;
  borderColor?: string;
  label: string;
  spinner: string;
} {
  const { colors, isDark } = useTheme();
  switch (variant) {
    case 'primary':
      // Black in light, white in dark, each under the other's ink.
      //
      // `primaryFill` / `textInverse`, NOT `text` / `background`
      // (2026-09-12). The two pairs look interchangeable and are not:
      // light `text` is slate-900, a NAVY-tinted near-black, while
      // `primaryFill` is the brand's true neutral ink. Build 198's device pass
      // caught both shipping side by side — Home's "Study all 68 due" and the
      // lit tab in the slate, Shop's "Sell" in the brand ink — two different
      // "blacks" on one screen. Every filled control takes the one ink token.
      return {
        backgroundColor: colors.primaryFill,
        label: colors.textInverse,
        spinner: colors.textInverse,
      };
    case 'secondary':
      return {
        backgroundColor: 'transparent',
        borderColor: colors.border,
        label: colors.text,
        spinner: colors.text,
      };
    case 'danger':
      // `errorStrong`, not `error`: this fill carries a WHITE label, and
      // dark's `error` (#ef4444) is 3.76:1 under white.
      return { backgroundColor: colors.errorStrong, label: '#ffffff', spinner: '#ffffff' };
    case 'accent': {
      const flashcards = isDark ? featureAccentsDark.flashcards : featureAccentsLight.flashcards;
      return { backgroundColor: flashcards.tint, label: flashcards.ink, spinner: flashcards.ink };
    }
    case 'ghost':
    default:
      return {
        backgroundColor: 'transparent',
        label: colors.textSecondary,
        spinner: colors.textSecondary,
      };
  }
}

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  className?: string;
  accessibilityLabel?: string;
  /** For the source-scan wiring tests and for e2e. Passed to the Pressable. */
  testID?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  fullWidth,
  onPress,
  className = '',
  accessibilityLabel,
  testID,
}: Props) {
  const skin = useButtonSkin(variant);
  const box = BUTTON_SIZE[size];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
      }
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={{
        // `minHeight`, not `height`: a label that wraps (a long word at the
        // largest font-size setting) must grow the pill rather than overflow
        // it, and the measured 36 is the floor the direction specifies.
        minHeight: box.height,
        borderRadius: box.radius,
        paddingHorizontal: box.paddingHorizontal,
        backgroundColor: skin.backgroundColor,
        ...(skin.borderColor ? { borderWidth: 1, borderColor: skin.borderColor } : null),
      }}
      className={`flex-row items-center justify-center gap-2 active:opacity-80 ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? <ActivityIndicator color={skin.spinner} /> : null}
      {typeof children === 'string' ? (
        // Not its own TalkBack stop — the Pressable already announces this
        // label, so leaving the Text important made every Button say its
        // caption twice ("Send", then "Send" again).
        <Text
          importantForAccessibility="no"
          style={{ color: skin.label }}
          className="font-semibold text-body"
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/**
 * The SEGMENTED CONTROL, and the one skin it shares with the primary button.
 *
 * A selected segment is the page's INK under the page's GROUND — black pill,
 * white label in light; the inverse in dark — which is the same relationship
 * `Button`'s primary variant and the bottom bar's lit tab already draw.
 *
 * It IS `primaryFill` now (2026-09-12). The comment here used to say the
 * opposite, and it was true of the pre-pivot palette where `primaryFill` was
 * indigo; it is not true of the post-pivot one, where `primaryFill` is the
 * brand's neutral ink and `colors.text` is the navy-tinted slate-900.
 * Reading the fill off `text` was what put two different blacks on one screen.
 *
 * There is no Tailwind token for "the inverse of the text colour", so the two
 * colours come off the theme rather than out of a class, exactly as the button
 * skin does.
 */
export function useSegmentSkin(selected: boolean): { backgroundColor: string; color: string } {
  const { colors } = useTheme();
  return selected
    ? { backgroundColor: colors.primaryFill, color: colors.textInverse }
    : { backgroundColor: colors.surface, color: colors.text };
}

export interface SegmentedOption<Id extends string> {
  id: Id;
  label: string;
  /** Drawn before the label, in the segment's own foreground. */
  icon?: AppIconName;
  /** Spoken instead of the label, where the word alone is ambiguous. */
  accessibilityLabel?: string;
}

/**
 * Two or more mutually exclusive filters in one hairline-bordered box.
 *
 * `min-h-[44px]` per segment is Material's target, and the box clips its own
 * corners so the selected fill takes the container's radius rather than drawing
 * a square corner over it.
 */
export function Segmented<Id extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: readonly SegmentedOption<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}) {
  return (
    <View
      className={`flex-row rounded-lg border border-lantern-border overflow-hidden ${className}`}
    >
      {options.map((option) => (
        <SegmentedItem
          key={option.id}
          option={option}
          selected={option.id === value}
          onPress={() => onChange(option.id)}
        />
      ))}
    </View>
  );
}

function SegmentedItem<Id extends string>({
  option,
  selected,
  onPress,
}: {
  option: SegmentedOption<Id>;
  selected: boolean;
  onPress: () => void;
}) {
  const skin = useSegmentSkin(selected);
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: skin.backgroundColor }}
      className="flex-1 min-h-[44px] flex-row items-center justify-center gap-1"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={option.accessibilityLabel ?? option.label}
    >
      {option.icon ? (
        <AppIcon name={option.icon} size={14} color={skin.color} importantForAccessibility="no" />
      ) : null}
      <Text
        importantForAccessibility="no"
        numberOfLines={1}
        style={{ color: skin.color }}
        className="text-caption font-semibold"
      >
        {option.label}
      </Text>
    </Pressable>
  );
}

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  /**
   * `feature` draws the spec §5.6 container for a feature-owned card: ONE
   * tint band across the top carrying the feature's disc, its title and an
   * optional count pill, with the body below on the plain surface. The band is
   * the card's only colour, which keeps tint under the 25%-of-a-card budget
   * and keeps the reading surface uncoloured.
   */
  variant?: 'default' | 'feature';
  /** Which hue this card belongs to. Required by `variant="feature"`. */
  feature?: FeatureKey;
  /** Band title. Feature variant only. */
  title?: string;
  /** Glyph on the band's disc. Feature variant only. */
  icon?: AppIconName;
  /** Tint pill at the band's right edge. `0`/`undefined` draws nothing. */
  count?: number;
  /** Spoken form of `count`, e.g. "4 due". */
  countLabel?: string;
  /**
   * ONE spot illustration from `@lantern/shared/design` (spec v3 §5.6). An
   * unmapped name is a compile error; omitting it draws the card as before.
   *
   * It is drawn as a right-hand column of the BODY, not on the band, and the
   * reason is the 25% tint cap. This card's band is 56 dp — a 32 dp disc plus
   * `py-3` — against a body that is typically ~160 dp, which is already 26%.
   * Putting a 72 dp picture up there would make the band 96 and the card 42%
   * tint. In the body the picture costs no tint at all: the only filled part
   * of the asset is its ground ellipse. The card's height does not change
   * either, because the picture is shorter than the content it sits beside.
   */
  illustration?: IllustrationName;
}

export function Card({
  children,
  className = '',
  variant = 'default',
  feature,
  title,
  icon,
  count,
  countLabel,
  illustration,
}: CardProps) {
  const { colors, isDark } = useTheme();
  // Radius 16 and padding 20, from the measured direction rather than from
  // Tailwind: `rounded-lantern-xl` is 20 and `p-4` is 14 at this project's
  // NativeWind rem, so neither class reaches the numbers. One shape for every
  // neutral container in the app — the feature variant only moves where the
  // padding sits, never how round the box is.
  const shell = { borderRadius: CARD.radius } as const;
  const accent =
    variant === 'feature' && feature
      ? (isDark ? featureAccentsDark : featureAccentsLight)[feature]
      : null;

  if (accent && feature) {
    const showCount = typeof count === 'number' && count > 0;
    return (
      <View
        className={`bg-lantern-surface border border-lantern-border overflow-hidden ${className}`}
        style={{
          ...shell,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 2,
        }}
      >
        <View
          style={{ backgroundColor: accent.tint }}
          className="flex-row items-center gap-3 px-4 py-3"
        >
          {icon ? <FeatureDisc feature={feature} icon={icon} size={32} /> : null}
          {title ? (
            <Heading style={{ color: accent.ink, flex: 1 }} numberOfLines={1}>
              {title}
            </Heading>
          ) : (
            <View className="flex-1" />
          )}
          {showCount ? (
            <View className="px-2 py-0.5 rounded-full bg-lantern-surface">
              <Label
                tabular
                style={{ color: smallTextInk(feature, accent, isDark), fontWeight: '700' }}
                accessibilityLabel={countLabel}
              >
                {count > 99 ? '99+' : count}
              </Label>
            </View>
          ) : null}
        </View>
        {illustration ? (
          <View style={{ padding: CARD.padding }} className="flex-row items-start gap-3">
            <View className="flex-1 min-w-0">{children}</View>
            {/* Decorative: the band's title already names the card, so this
                is hidden from the screen reader rather than announced. */}
            <Illustration name={illustration} feature={feature} size={72} />
          </View>
        ) : (
          <View style={{ padding: CARD.padding }}>{children}</View>
        )}
      </View>
    );
  }

  return (
    <View
      className={`bg-lantern-surface border border-lantern-border ${className}`}
      style={{
        ...shell,
        padding: CARD.padding,
        borderColor: colors.border,
        // Neutral black, never a tinted slate: on this app's warm cream
        // surfaces a blue-black shadow reads as a coloured edge around the box
        // rather than as depth. The softness is unchanged — only the hue.
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
  className = '',
  safeTop = false,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  className?: string;
  /** For screens whose root is a plain View: inset below the status bar. */
  safeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={safeTop ? { paddingTop: insets.top + 8 } : undefined}
      className={`px-4 pt-2 pb-3 flex-row items-start ${className}`}
    >
      {onBack ? (
        // A real, visible, 44pt back target — the old text-glyph "←" was the
        // "back buttons are tiny or invisible" complaint for the 21 screens
        // that use this header.
        <BackButton onPress={onBack} style={{ marginLeft: -8, marginRight: 4 }} />
      ) : null}
      <View className="flex-1 min-w-0 pr-3">
        {/* `title` step: 22/28/-0.02em/700, and the SERIF one — this is a
            screen's h1, which is the `title` display role (theme/fonts.ts).
            The class alone left every screen that uses this header (the set
            room, the Study hub, 20 others) drawing its h1 in the platform sans
            while the headings INSIDE the page were Bitter, i.e. the serif
            applied one level too deep. `serifDisplayStyle()` also resets the
            weight, because the face carries it and a `font-bold` against a
            single-weight family is a faux-bold on iOS and dropped on Android
            — so the class keeps the SIZE and the style brings the family. */}
        <Text style={serifDisplayStyle()} className="text-title text-lantern-text">{title}</Text>
        {subtitle ? <Text className="text-caption text-lantern-text-secondary mt-0.5">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name?: string; size?: number }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <View
      style={{ width: size, height: size }}
      className="rounded-full bg-lantern-primary-background dark:bg-lantern-primary-dark/40 items-center justify-center"
    >
      <Text className="font-semibold text-lantern-primary-text">{initial}</Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (!count || count <= 0) return null;
  return (
    // `errorStrong`, not `error`: the fill has to carry a WHITE numeral, and
    // dark mode's `error` (#ef4444) is only 3.76:1 under white.
    <View
      style={{ backgroundColor: colors.errorStrong }}
      className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full items-center justify-center"
    >
      {/* 11 sp is the floor; the badge was the app's other sub-floor string. */}
      <Text className="text-label font-bold tracking-normal text-white">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`rounded-xl bg-lantern-background-secondary animate-pulse ${className}`} />;
}

export function SkeletonCard() {
  return (
    <View className="bg-lantern-surface rounded-2xl border border-lantern-border p-4 mb-3">
      <Skeleton className="h-4 w-2/3 mb-3" />
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-5/6" />
    </View>
  );
}

const toastBg: Record<string, string> = {
  success: 'bg-emerald-600',
  error: 'bg-red-600',
  info: 'bg-lantern-primary-fill',
};

export function ToastHost() {
  const { message, type, dismissToast } = useToastStore();
  // `bottom-10` is 35px at this project's NativeWind rem of 14, and the bottom
  // tab bar is an absolutely-positioned overlay 86-114px tall drawn at
  // elevation 12. Every toast on a tabbed screen was therefore behind the bar:
  // on Android elevation wins over sibling order, so `z-50` alone did nothing.
  // Clearing the bar (or the plain system inset where no bar is over the
  // route) and out-elevating it puts the toast back on screen.
  const bottom = useScreenBottomPadding({ bottomExtra: 8 });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(dismissToast, 4000);
    return () => clearTimeout(t);
  }, [message, dismissToast]);
  if (!message) return null;
  return (
    <View
      className="absolute left-4 right-4 z-50"
      style={{ bottom, elevation: 16 }}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={dismissToast}
        className={`${toastBg[type] || toastBg.info} rounded-2xl px-4 py-3 shadow-lg`}
        accessibilityRole="alert"
      >
        <Text className="text-white text-sm font-medium text-center">{message}</Text>
      </Pressable>
    </View>
  );
}

export function ConfirmSheetHost() {
  const { open, options, handleConfirm, handleCancel } = useConfirmStore();
  // The modal window spans the full screen (edge-to-edge), so without this the
  // Cancel/Confirm row sinks under the system navigation bar and cannot be
  // tapped on devices with 3-button nav.
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!open || !options) return null;
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={handleCancel}>
      <View className="flex-1 bg-black/50 justify-end">
        <View
          accessibilityViewIsModal
          accessibilityLabel={options.title}
          className="px-5 pt-3"
          style={{
            // Cream ground, ~23 dp top corners and a grabber: the one sheet
            // anatomy, shared with ActionSheet (founder direction 2026-09-11).
            backgroundColor: colors.background,
            borderTopLeftRadius: SHEET.topRadius,
            borderTopRightRadius: SHEET.topRadius,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <SheetGrabber />
          {/* The serif title step, like every other sheet heading. */}
          <Heading
            style={{ ...serifDisplayStyle(), fontSize: 22, lineHeight: 28 }}
            className="mb-2"
            accessibilityRole="header"
          >
            {options.title}
          </Heading>
          <Body tone="secondary" className="mb-5">
            {options.message}
          </Body>
          <View className="flex-row gap-3">
            {/* The two pill variants, not two hand-rolled boxes: a sheet's
                choice is the same object as any other choice in the app. */}
            <Button variant="secondary" fullWidth className="flex-1" onPress={handleCancel}>
              {options.cancelLabel || 'Cancel'}
            </Button>
            <Button
              variant={options.danger ? 'danger' : 'primary'}
              fullWidth
              className="flex-1"
              onPress={handleConfirm}
            >
              {options.confirmLabel || 'Confirm'}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export { NotificationRow } from './NotificationRow';
export { FeatureHero } from './FeatureHero';
export { ActionSheet, SheetGrabber, type ActionSheetItem } from './ActionSheet';
// The one bottom-sheet shell: grabber, 23 dp corners, cream ground, serif
// heading, keyboard-safe body. See SheetShell.tsx for why it is one component.
export { SheetShell, type SheetShellProps } from './SheetShell';
export { LoadingState, ErrorState, InlineErrorBanner, EmptyState } from './AsyncStates';
export { IconButton } from './IconButton';
export { BackButton } from './BackButton';
export {
  AppIcon,
  type AppIconName,
  type AppIconTone,
  isAppIconName,
  strokeWidthForSize,
} from './AppIcon';
// What a row is ABOUT, printed once on the right. Neutral by design.
export { CourseChip } from './CourseChip';
// The feature mark, and the two doors built out of it.
export {
  FeatureDisc,
  FeatureTile,
  FeatureRow,
  useFeatureAccent,
  type FeatureDiscSize,
} from './FeatureDisc';
// The hub's unit: pastel panel, white caption strip, hard offset shadow.
export {
  DoorTile,
  doorIllustrationSize,
  doorTileColumnWidth,
  doorTileLayout,
  type DoorTileLayout,
  type DoorTileProps,
} from './DoorTile';
// The ten spot illustrations, rendered. Doors, tiles, empty states, heroes.
export {
  Illustration,
  ILLUSTRATION_SIZES,
  illustrationFills,
  type IllustrationSize,
  type IllustrationVariant,
} from './Illustration';
// The six type steps, for screens built out of StyleSheet rather than classes.
export {
  T,
  Display,
  Title,
  Heading,
  Body,
  Caption,
  Label,
  type TypeProps,
  type TypeTone,
} from './Text';
