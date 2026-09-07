import React, { useEffect } from 'react';
import { Pressable, Text, ActivityIndicator, View, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Imported from the module, not the layout barrel: the barrel re-exports
// BottomTabBar, which imports from this file, and that would be a cycle.
import { useScreenBottomPadding } from '../layout/Screen';
import { useToastStore } from '../../stores/toastStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { BackButton } from './BackButton';
import { useTheme } from '../../theme';
import {
  featureAccentsDark,
  featureAccentsLight,
  type FeatureKey,
} from '@lantern/shared/design';
import { FeatureDisc, smallTextInk } from './FeatureDisc';
import { type AppIconName } from './AppIcon';
import { Heading, Label } from './Text';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary: 'bg-lantern-primary-fill active:bg-lantern-primary-dark',
  secondary: 'bg-lantern-surface border border-lantern-border',
  accent: 'bg-lantern-accent active:opacity-90',
  ghost: 'bg-transparent',
  danger: 'bg-lantern-error active:opacity-90',
};

const textClass: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-lantern-text',
  accent: 'text-white',
  ghost: 'text-lantern-text-secondary',
  danger: 'text-white',
};

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-2 rounded-lg',
  md: 'px-4 py-2.5 rounded-2xl',
  lg: 'px-6 py-3 rounded-2xl',
};

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
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
      }
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      className={`flex-row items-center justify-center ${variantClass[variant]} ${sizeClass[size]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#4f46e5' : '#fff'} /> : null}
      {typeof children === 'string' ? (
        // Not its own TalkBack stop — the Pressable already announces this
        // label, so leaving the Text important made every Button say its
        // caption twice ("Send", then "Send" again).
        <Text
          importantForAccessibility="no"
          className={`font-semibold text-sm ${textClass[variant]}`}
        >
          {children}
        </Text>
      ) : (
        children
      )}
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
   * Wave V2 slot: a flat, two-tone mark drawn in the band's ink. Left empty
   * today — the imagery rule is explicitly NOT this wave.
   */
  illustration?: React.ReactNode;
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
  const { isDark } = useTheme();
  const accent =
    variant === 'feature' && feature
      ? (isDark ? featureAccentsDark : featureAccentsLight)[feature]
      : null;

  if (accent && feature) {
    const showCount = typeof count === 'number' && count > 0;
    return (
      <View
        className={`bg-lantern-surface rounded-lantern-xl border border-lantern-border overflow-hidden ${className}`}
        style={{
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
          {illustration}
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
        <View className="p-4">{children}</View>
      </View>
    );
  }

  return (
    <View
      className={`bg-lantern-surface rounded-lantern-xl border border-lantern-border p-4 ${className}`}
      style={{
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
        {/* `title` step: 22/28/-0.02em/700. Was `text-2xl` — 21 sp at this
            project's NativeWind rem of 14, i.e. a size that existed nowhere in
            the scale. */}
        <Text className="text-title font-bold text-lantern-text">{title}</Text>
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
  if (!open || !options) return null;
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={handleCancel}>
      <View className="flex-1 bg-black/50 justify-end">
        <View
          accessibilityViewIsModal
          accessibilityLabel={options.title}
          className="bg-lantern-surface rounded-t-3xl px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 20 }}
        >
          <Text className="text-lg font-bold text-lantern-text mb-2" accessibilityRole="header">
            {options.title}
          </Text>
          <Text className="text-sm text-lantern-text-secondary mb-5">{options.message}</Text>
          <View className="flex-row gap-3">
            <Pressable onPress={handleCancel} className="flex-1 py-3 rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center">
              <Text className="font-semibold text-lantern-text">{options.cancelLabel || 'Cancel'}</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              className={`flex-1 py-3 rounded-2xl items-center ${options.danger ? 'bg-red-500' : 'bg-lantern-primary-fill'}`}
            >
              <Text className="font-semibold text-white">{options.confirmLabel || 'Confirm'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export { NotificationRow } from './NotificationRow';
export { FeatureHero } from './FeatureHero';
export { ActionSheet, type ActionSheetItem } from './ActionSheet';
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
