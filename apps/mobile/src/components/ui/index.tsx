import React from 'react';
import { Pressable, Text, ActivityIndicator, View } from 'react-native';

type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary: 'bg-indigo-500 active:bg-indigo-600',
  secondary: 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600',
  accent: 'bg-amber-500 active:bg-amber-600',
  ghost: 'bg-transparent',
  danger: 'bg-red-500 active:bg-red-600',
};

const textClass: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-slate-800 dark:text-slate-100',
  accent: 'text-white',
  ghost: 'text-slate-600 dark:text-slate-300',
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
      accessibilityLabel={accessibilityLabel}
      className={`flex-row items-center justify-center ${variantClass[variant]} ${sizeClass[size]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#6366f1' : '#fff'} /> : null}
      {typeof children === 'string' ? (
        <Text className={`font-semibold text-sm ${textClass[variant]}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 ${className}`}>
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
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  className?: string;
}) {
  return (
    <View className={`px-4 pt-2 pb-3 flex-row items-start ${className}`}>
      {onBack ? (
        <Pressable onPress={onBack} className="p-1 mr-2 mt-1">
          <Text className="text-indigo-600 text-lg">←</Text>
        </Pressable>
      ) : null}
      <View className="flex-1 min-w-0 pr-3">
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</Text>
        {subtitle ? <Text className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</Text> : null}
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
      className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center"
    >
      <Text className="font-semibold text-indigo-600 dark:text-indigo-300">{initial}</Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <View className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 items-center justify-center">
      <Text className="text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}
