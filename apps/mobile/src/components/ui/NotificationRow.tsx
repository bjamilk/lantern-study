import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getNotificationMeta,
  formatRelativeTime,
  type NotificationIconKey,
} from '@lantern/shared';

const iconMap: Record<NotificationIconKey, keyof typeof Ionicons.glyphMap> = {
  bell: 'notifications-outline',
  currency: 'cash-outline',
  chat: 'chatbubble-ellipses-outline',
  shopping: 'bag-outline',
  envelope: 'mail-outline',
  flashcards: 'albums-outline',
  test: 'clipboard-outline',
  game: 'game-controller-outline',
  briefcase: 'briefcase-outline',
  order: 'receipt-outline',
  megaphone: 'megaphone-outline',
  heart: 'heart-outline',
  alert: 'warning-outline',
};

interface NotificationRowProps {
  message: string;
  date: string | Date;
  read?: boolean;
  link?: string;
  type?: string;
  data?: Record<string, unknown>;
  onPress?: () => void;
  className?: string;
}

export function NotificationRow({
  message,
  date,
  read = false,
  link,
  type,
  data,
  onPress,
  className = '',
}: NotificationRowProps) {
  const meta = getNotificationMeta(link, { type, data, link });

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      className={`p-4 rounded-lantern-xl border border-lantern-border mb-2 ${
        read ? 'bg-lantern-surface' : 'bg-lantern-primary-background'
      } ${className}`}
      // No accent rail: the icon already carries the feature's colour, and a
      // coloured edge on every row made the list read as a warning list.
    >
      <View className="flex-row items-start gap-3">
        <View
          className={`w-9 h-9 rounded-xl items-center justify-center ${meta.mobileBgClass}`}
        >
          <Ionicons name={iconMap[meta.iconKey]} size={18} color={meta.mobileIconColor} />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1 min-w-0">
              {meta.label ? (
                <Text className="text-[10px] font-bold uppercase tracking-wider text-lantern-text-tertiary mb-0.5">
                  {meta.label}
                </Text>
              ) : null}
              <Text className="text-sm text-lantern-text">{message}</Text>
            </View>
            {!read ? (
              <View className="w-2.5 h-2.5 rounded-full bg-lantern-primary mt-1" />
            ) : null}
          </View>
          <Text className="text-xs text-lantern-text-tertiary mt-1">
            {formatRelativeTime(date)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
