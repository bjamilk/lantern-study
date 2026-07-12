import React from 'react';
import { Modal, View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface MoreMenuItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  badge?: number;
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  items: MoreMenuItem[];
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  lowDataMode?: boolean;
  onToggleLowData?: () => void;
}

export function MoreSheet({ visible, onClose, items, theme, onToggleTheme, lowDataMode, onToggleLowData }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View
        style={{ paddingBottom: insets.bottom + 8 }}
        className="bg-lantern-surface rounded-t-3xl border-t border-lantern-border max-h-[70%]"
      >
        <View className="w-10 h-1 rounded-full bg-lantern-border self-center mt-3 mb-2" />
        <Text className="text-lg font-bold text-lantern-text px-5 pb-2">More</Text>
        <ScrollView className="px-3">
          {items.map(item => (
            <Pressable
              key={item.id}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
            >
              <Ionicons
                name={item.icon}
                size={22}
                color={item.destructive ? '#ef4444' : '#6366f1'}
              />
              <Text
                className={`flex-1 text-base font-medium ${item.destructive ? 'text-red-500' : 'text-lantern-text'}`}
              >
                {item.label}
              </Text>
              {item.badge ? (
                <View className="bg-lantern-error rounded-full min-w-[20px] h-5 px-1 items-center justify-center">
                  <Text className="text-white text-xs font-bold">{item.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
          {onToggleLowData ? (
            <Pressable
              onPress={onToggleLowData}
              className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
            >
              <Ionicons name={lowDataMode ? 'cellular-outline' : 'wifi-outline'} size={22} color="#6366f1" />
              <Text className="flex-1 text-base font-medium text-lantern-text">
                {lowDataMode ? 'Low-data mode: ON' : 'Low-data mode: OFF'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleTheme}
            className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          >
            <Ionicons name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={22} color="#6366f1" />
            <Text className="flex-1 text-base font-medium text-lantern-text">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
