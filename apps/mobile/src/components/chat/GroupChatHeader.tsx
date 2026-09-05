import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useTheme } from '../../theme';
import { featureAccents } from '@lantern/shared/design';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export interface GroupChatHeaderAction {
  id: string;
  label: string;
  icon: AppIconName;
  /**
   * Paints the icon solid. For a row that toggles a state its own glyph shows
   * (starred messages), so the state is not carried by colour alone.
   */
  iconFilled?: boolean;
  iconColor?: string;
  /** Direct-action rows fire this on tap. Omitted on rows that only open a submenu. */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Groups rows under a labeled section in the overflow sheet. Consecutive
   * actions that share a `section` render under a single section header.
   */
  section?: string;
  /** Secondary line under the label — used for the per-option helper text in a submenu. */
  helper?: string;
  /** Radio-style check mark for the current selection inside a submenu. */
  selected?: boolean;
  /**
   * When set, tapping this row opens a nested option list (e.g. the question
   * filter) instead of firing an action. This is the only row type that keeps a
   * trailing chevron — it genuinely navigates within the sheet.
   */
  submenu?: {
    title?: string;
    options: GroupChatHeaderAction[];
  };
}

interface GroupChatHeaderProps {
  displayName: string;
  avatarUrl?: string | null;
  memberCount?: number;
  lowDataMode?: boolean;
  onBack: () => void;
  onAddQuestion: () => void;
  /** Hide the add-question "+" — e.g. an archived group is read-only. */
  addQuestionDisabled?: boolean;
  /** Tapping the avatar/title opens Group Info. */
  onTitlePress?: () => void;
  menuActions: GroupChatHeaderAction[];
  /**
   * Community channel context (spec §4.5): when set, the subtitle slot shows
   * `${contextLabel} ›` as a link instead of the member count (which stays in
   * Group Info). Low-data mode keeps precedence as before.
   */
  contextLabel?: string;
  onContextPress?: () => void;
}

export function GroupChatHeader({
  displayName,
  avatarUrl,
  memberCount,
  lowDataMode,
  onBack,
  onAddQuestion,
  addQuestionDisabled,
  onTitlePress,
  menuActions,
  contextLabel,
  onContextPress,
}: GroupChatHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [menuVisible, setMenuVisible] = useState(false);
  const [submenu, setSubmenu] = useState<GroupChatHeaderAction | null>(null);
  const sheetMaxHeight = useMemo(
    () => Math.round(Dimensions.get('window').height * 0.75),
    [],
  );
  const listMaxHeight = useMemo(
    () => Math.max(220, sheetMaxHeight - 140),
    [sheetMaxHeight],
  );

  const openMenu = () => setMenuVisible(true);
  const closeMenu = () => {
    setMenuVisible(false);
    setSubmenu(null);
  };

  const handleAction = (action: GroupChatHeaderAction) => {
    if (action.disabled) return;
    if (action.submenu) {
      // Open the nested list in place; keep the sheet open.
      setSubmenu(action);
      return;
    }
    closeMenu();
    action.onPress?.();
  };

  const handleSubmenuOption = (option: GroupChatHeaderAction) => {
    if (option.disabled) return;
    closeMenu();
    option.onPress?.();
  };

  // Group the flat action list into sections so the sheet reads as
  // Practice / View / Notifications / Manage instead of one long list.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: 'section'; id: string; title: string }
      | { kind: 'action'; action: GroupChatHeaderAction }
    > = [];
    let currentSection: string | undefined;
    for (const action of menuActions) {
      if (action.section && action.section !== currentSection) {
        currentSection = action.section;
        out.push({ kind: 'section', id: `section-${action.section}`, title: action.section });
      }
      out.push({ kind: 'action', action });
    }
    return out;
  }, [menuActions]);

  const renderActionRow = (action: GroupChatHeaderAction) => (
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
      accessibilityState={{ disabled: !!action.disabled }}
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: colors.backgroundSecondary }}
      >
        <AppIcon
          name={action.icon}
          filled={action.iconFilled}
          size={20}
          color={action.iconColor || featureAccents.groups}
        />
      </View>
      <Text className="text-base text-lantern-text flex-1" style={{ color: colors.text }}>
        {action.label}
      </Text>
      {/* Only submenu rows keep a chevron — they navigate within the sheet.
          Direct-action rows dropped it (it implied navigation that never happened). */}
      {action.submenu ? (
        <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
      ) : null}
    </TouchableOpacity>
  );

  const renderOptionRow = (option: GroupChatHeaderAction) => (
    <TouchableOpacity
      key={option.id}
      onPress={() => handleSubmenuOption(option)}
      disabled={option.disabled}
      className={`flex-row items-center gap-3 py-3 px-1 border-b border-lantern-border ${
        option.disabled ? 'opacity-40' : ''
      }`}
      style={{ borderBottomColor: colors.border }}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ selected: !!option.selected }}
    >
      <View className="w-6 items-center justify-center">
        {option.selected ? (
          <AppIcon name="checkmark" size={20} color={colors.primary} />
        ) : null}
      </View>
      <View className="flex-1">
        <Text
          className="text-base text-lantern-text"
          style={{ color: option.selected ? colors.primary : colors.text }}
        >
          {option.label}
        </Text>
        {option.helper ? (
          <Text
            className="text-xs text-lantern-text-secondary mt-0.5"
            style={{ color: colors.textSecondary }}
          >
            {option.helper}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <>
      <View
        className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface"
        style={{ borderBottomColor: colors.border, backgroundColor: colors.card }}
      >
        <Pressable hitSlop={10}
          onPress={onBack}
          // 48dp is the Android/Material minimum target; p-2 around a 22px icon was 36dp.
          className="p-2 rounded-lg min-w-[48px] min-h-[48px] items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <AppIcon name="arrow-back" size={24} color={colors.textSecondary} />
        </Pressable>

        {/* Tapping the avatar/title opens Group Info — previously an inert View,
            so Group Info was only reachable through the overflow menu. */}
        <Pressable
          onPress={onTitlePress}
          disabled={!onTitlePress}
          className="flex-1 flex-row items-center gap-2 min-w-0"
          accessibilityRole={onTitlePress ? 'button' : undefined}
          accessibilityLabel={onTitlePress ? `${displayName}, open group info` : undefined}
        >
          <ResolvedAvatar
            name={displayName}
            uri={resolveAvatarSrc(avatarUrl, lowDataMode)}
            size={36}
            // The title right next to it already announces the group name.
            decorative
          />

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
            ) : contextLabel ? (
              <Pressable
                onPress={onContextPress}
                disabled={!onContextPress}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel={`${contextLabel}, open community`}
                className="self-start min-h-[24px] justify-center"
              >
                <Text className="text-xs text-lantern-primary" style={{ color: colors.primary }} numberOfLines={1}>
                  {contextLabel} ›
                </Text>
              </Pressable>
            ) : memberCount ? (
              <Text className="text-xs text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
                {memberCount} members
              </Text>
            ) : null}
          </View>
        </Pressable>

        {!addQuestionDisabled ? (
          <Pressable
            onPress={onAddQuestion}
            className="p-2 rounded-lg min-w-[48px] min-h-[48px] items-center justify-center"
            style={{ backgroundColor: `${featureAccents.groups}20` }}
            accessibilityRole="button"
            accessibilityLabel="Add question"
          >
            <AppIcon name="add-circle" size={22} color={featureAccents.groups} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={openMenu}
          className="p-2 rounded-lg min-w-[48px] min-h-[48px] items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel="More actions"
        >
          <AppIcon name="ellipsis-vertical" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={submenu ? () => setSubmenu(null) : closeMenu}
      >
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: colors.modalOverlay }} onPress={closeMenu}>
          <Pressable
            className="rounded-t-2xl px-4 pt-3"
            style={{
              backgroundColor: colors.modalBackground,
              paddingBottom: insets.bottom + 20,
              maxHeight: sheetMaxHeight,
            }}
            onPress={e => e.stopPropagation()}
          >
            <View className="w-10 h-1 rounded-full self-center mb-3" style={{ backgroundColor: colors.border }} />

            {submenu ? (
              <>
                <View className="flex-row items-center gap-2 mb-2">
                  <TouchableOpacity
                    onPress={() => setSubmenu(null)}
                    className="p-1 -ml-1"
                    accessibilityRole="button"
                    accessibilityLabel="Back to group actions"
                  >
                    <AppIcon name="chevron-back" size={24} color={colors.primary} />
                  </TouchableOpacity>
                  <Text
                    className="text-sm font-semibold text-lantern-text-secondary"
                    style={{ color: colors.textSecondary }}
                  >
                    {submenu.submenu?.title || submenu.label}
                  </Text>
                </View>

                <ScrollView
                  style={{ maxHeight: listMaxHeight }}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  bounces
                >
                  {(submenu.submenu?.options || []).map(renderOptionRow)}
                </ScrollView>
              </>
            ) : (
              <>
                <Text className="text-sm font-semibold text-lantern-text-secondary mb-2 px-1" style={{ color: colors.textSecondary }}>
                  Group actions
                </Text>

                <ScrollView
                  style={{ maxHeight: listMaxHeight }}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  bounces
                >
                  {rows.map(row =>
                    row.kind === 'section' ? (
                      <Text
                        key={row.id}
                        className="text-[11px] font-semibold uppercase tracking-wide px-1 pt-3 pb-1"
                        style={{ color: colors.textTertiary }}
                      >
                        {row.title}
                      </Text>
                    ) : (
                      renderActionRow(row.action)
                    )
                  )}
                </ScrollView>
              </>
            )}

            <TouchableOpacity onPress={closeMenu} className="mt-3 py-3 items-center">
              <Text className="text-base font-medium" style={{ color: colors.primary }}>
                {submenu ? 'Done' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
