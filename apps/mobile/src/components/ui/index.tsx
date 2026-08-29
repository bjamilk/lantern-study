import React, { useEffect } from 'react';
import { Pressable, Text, ActivityIndicator, View, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../../stores/toastStore';
import { useConfirmStore } from '../../stores/confirmStore';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary: 'bg-lantern-primary active:bg-lantern-primary-dark',
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

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View
      className={`bg-lantern-surface rounded-lantern-xl border border-lantern-border p-4 ${className}`}
      style={{
        shadowColor: '#0f172a',
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
        <Pressable onPress={onBack} className="p-1 mr-2 mt-1">
          <Text className="text-lantern-primary text-lg">←</Text>
        </Pressable>
      ) : null}
      <View className="flex-1 min-w-0 pr-3">
        <Text className="text-2xl font-bold text-lantern-text tracking-tight">{title}</Text>
        {subtitle ? <Text className="text-sm text-lantern-text-secondary mt-0.5">{subtitle}</Text> : null}
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
      <Text className="font-semibold text-lantern-primary">{initial}</Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <View className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-lantern-error items-center justify-center">
      <Text className="text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</Text>
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
  info: 'bg-lantern-primary',
};

export function ToastHost() {
  const { message, type, dismissToast } = useToastStore();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(dismissToast, 4000);
    return () => clearTimeout(t);
  }, [message, dismissToast]);
  if (!message) return null;
  return (
    <View className="absolute left-4 right-4 bottom-10 z-50" pointerEvents="box-none">
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
              className={`flex-1 py-3 rounded-2xl items-center ${options.danger ? 'bg-red-500' : 'bg-lantern-primary'}`}
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
