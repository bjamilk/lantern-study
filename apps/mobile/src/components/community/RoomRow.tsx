import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { roomSubtitle, type StudyRoomListItem } from '@lantern/shared/network';

/** One open study room under STUDY ROOMS — the voice-like channel of the server. */
export function RoomRow({
  room,
  now,
  onPress,
}: {
  room: StudyRoomListItem;
  now: number;
  onPress: () => void;
}) {
  const subtitle = roomSubtitle(room, now);
  const action = room.joined ? 'Open' : 'Join';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${action} ${room.title}, ${subtitle}`}
      className="flex-row items-center px-4 min-h-[52px] active:bg-lantern-background-secondary"
    >
      <Ionicons name="volume-medium-outline" size={16} color="#94a3b8" />
      <View className="flex-1 min-w-0 ml-2">
        <Text className="text-[15px] font-medium text-lantern-text" numberOfLines={1}>
          {room.title}
        </Text>
        <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text
        className={`text-xs font-semibold ${
          room.joined ? 'text-lantern-text-secondary' : 'text-lantern-primary'
        }`}
      >
        {action}
      </Text>
    </Pressable>
  );
}

export default RoomRow;
