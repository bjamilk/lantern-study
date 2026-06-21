import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../ui';
import { useTheme } from '../../theme';

export interface GroupChatHeaderAction {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  onPress: () => void;
  disabled?: boolean;
}

interface GroupChatHeaderProps {
  displayName: string;
  memberCount?: number;
  lowDataMode?: boolean;
  onBack: () => void;
  onAddQuestion: () => void;
  menuActions: GroupChatHeaderAction[];
}

export function GroupChatHeader({
  displayName,
  memberCount,
  lowDataMode,
  onBack,
  onAddQuestion,
  menuActions,
}: GroupChatHeaderProps) {
  const { colors } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);

  const openMenu = () => setMenuVisible(true);
  const closeMenu = () => setMenuVisible(false);

  const handleAction = (action: GroupChatHeaderAction) => {
    closeMenu();
    if (!action.disabled) {
      action.onPress();
    }
  };

  return (
    <>
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <Pressable onPress={onBack} className="p-2 rounded-lg" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
        </Pressable>

        <Avatar name={displayName} size={36} />

        <View className="flex-1 min-w-0">
          <Text
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {lowDataMode ? (
            <Text className="text-[10px] text-amber-600">Low-data mode</Text>
          ) : memberCount ? (
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              {memberCount} members
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onAddQuestion}
          className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30"
          accessibilityLabel="Add question"
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
        </Pressable>

        <Pressable
          onPress={openMenu}
          className="p-2 rounded-lg"
          accessibilityLabel="More actions"
        >
          <Ionicons name="ellipsis-vertical" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: colors.modalOverlay }} onPress={closeMenu}>
          <Pressable
            className="rounded-t-2xl px-4 pt-3 pb-6"
            style={{
              backgroundColor: colors.modalBackground,
              paddingBottom: Platform.OS === 'ios' ? 28 : 20,
            }}
            onPress={e => e.stopPropagation()}
          >
            <View className="w-10 h-1 rounded-full self-center mb-3 bg-slate-300 dark:bg-slate-600" />
            <Text className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2 px-1">
              Group actions
            </Text>

            {menuActions.map(action => (
              <TouchableOpacity
                key={action.id}
                onPress={() => handleAction(action)}
                disabled={action.disabled}
                className={`flex-row items-center gap-3 py-3.5 px-1 border-b border-slate-100 dark:border-slate-700 ${
                  action.disabled ? 'opacity-40' : ''
                }`}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <View className="w-9 h-9 rounded-xl items-center justify-center bg-slate-100 dark:bg-slate-700">
                  <Ionicons
                    name={action.icon}
                    size={20}
                    color={action.iconColor || colors.primary}
                  />
                </View>
                <Text className="text-base text-slate-800 dark:text-slate-100 flex-1">
                  {action.label}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={closeMenu} className="mt-3 py-3 items-center">
              <Text className="text-base font-medium" style={{ color: colors.primary }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
