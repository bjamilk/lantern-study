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
        className="bg-white dark:bg-slate-800 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 max-h-[70%]"
      >
        <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600 self-center mt-3 mb-2" />
        <Text className="text-lg font-bold text-slate-900 dark:text-slate-100 px-5 pb-2">More</Text>
        <ScrollView className="px-3">
          {items.map(item => (
            <Pressable
              key={item.id}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-slate-100 dark:active:bg-slate-700"
            >
              <Ionicons
                name={item.icon}
                size={22}
                color={item.destructive ? '#ef4444' : '#6366f1'}
              />
              <Text
                className={`flex-1 text-base font-medium ${item.destructive ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}
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
              className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-slate-100 dark:active:bg-slate-700"
            >
              <Ionicons name={lowDataMode ? 'cellular-outline' : 'wifi-outline'} size={22} color="#6366f1" />
              <Text className="flex-1 text-base font-medium text-slate-800 dark:text-slate-100">
                {lowDataMode ? 'Low-data mode: ON' : 'Low-data mode: OFF'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleTheme}
            className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-slate-100 dark:active:bg-slate-700"
          >
            <Ionicons name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={22} color="#6366f1" />
            <Text className="flex-1 text-base font-medium text-slate-800 dark:text-slate-100">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
