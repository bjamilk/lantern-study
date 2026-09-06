import React from 'react';
import { Pressable, Text, ActivityIndicator } from 'react-native';
import { RESEND_COOLDOWN_SECONDS } from '@lantern/shared';

interface ResendEmailButtonProps {
  label: string;
  cooldownSeconds: number;
  loading?: boolean;
  onPress: () => void;
}

export function ResendEmailButton({
  label,
  cooldownSeconds,
  loading = false,
  onPress,
}: ResendEmailButtonProps) {
  const disabled = loading || cooldownSeconds > 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`py-3 ${disabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : (
        <Text className="text-center text-sm font-medium text-lantern-primary-text">
          {cooldownSeconds > 0 ? `${label} (${cooldownSeconds}s)` : label}
        </Text>
      )}
    </Pressable>
  );
}

export { RESEND_COOLDOWN_SECONDS };
