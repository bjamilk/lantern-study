import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../ui';
import { useTheme } from '../../theme';
import { featureAccents } from '@lantern/shared/design';

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
  const sheetMaxHeight = useMemo(
    () => Math.round(Dimensions.get('window').height * 0.75),
    [],
  );
  const listMaxHeight = useMemo(
    () => Math.max(220, sheetMaxHeight - 140),
    [sheetMaxHeight],
  );

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
      <View
        className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface"
        style={{ borderBottomColor: colors.border, backgroundColor: colors.card }}
      >
        <Pressable onPress={onBack} className="p-2 rounded-lg" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
        </Pressable>

        <Avatar name={displayName} size={36} />

        <View className="flex-1 min-w-0">
          <Text
            className="text-base font-semibold text-lantern-text"
            numberOfLines={1}
            style={{ color: colors.text }}
          >
            {displayName}
          </Text>
          {lowDataMode ? (
            <Text className="text-[10px] text-amber-600">Low-data mode</Text>
          ) : memberCount ? (
            <Text className="text-xs text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
              {memberCount} members
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onAddQuestion}
          className="p-2 rounded-lg min-w-[44px] min-h-[44px] items-center justify-center"
          style={{ backgroundColor: `${featureAccents.groups}20` }}
          accessibilityLabel="Add question"
        >
          <Ionicons name="add-circle-outline" size={22} color={featureAccents.groups} />
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
            className="rounded-t-2xl px-4 pt-3"
            style={{
              backgroundColor: colors.modalBackground,
              paddingBottom: Platform.OS === 'ios' ? 28 : 20,
              maxHeight: sheetMaxHeight,
            }}
            onPress={e => e.stopPropagation()}
          >
            <View className="w-10 h-1 rounded-full self-center mb-3" style={{ backgroundColor: colors.border }} />
            <Text className="text-sm font-semibold text-lantern-text-secondary mb-2 px-1" style={{ color: colors.textSecondary }}>
              Group actions
            </Text>

            <ScrollView
              style={{ maxHeight: listMaxHeight }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              bounces
            >
              {menuActions.map(action => (
                <TouchableOpacity
                  key={action.id}
                  onPress={() => handleAction(action)}
                  disabled={action.disabled}
                  className={`flex-row items-center gap-3 py-3.5 px-1 border-b border-lantern-border ${
                    action.disabled ? 'opacity-40' : ''
                  }`}
                  style={{ borderBottomColor: colors.border }}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center"
                    style={{ backgroundColor: colors.backgroundSecondary }}
                  >
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.iconColor || featureAccents.groups}
                    />
                  </View>
                  <Text className="text-base text-lantern-text flex-1" style={{ color: colors.text }}>
                    {action.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </ScrollView>

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
