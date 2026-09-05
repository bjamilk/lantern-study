import React, { useCallback } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { ScreenScroll, useChrome } from '../../components/layout';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { useAppTheme, useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';
import { buildMeSections, type MeRow, type MeRowId } from './meRows';
import { AppIcon } from '../../components/ui/AppIcon';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/** 44px minimum touch target — NativeWind inlines rem at 14 here, so px. */
const ROW_MIN_HEIGHT = 56;

/**
 * Me — the fifth destination, and the one that is nobody else's.
 *
 * It replaces the profile drawer, which was a left-edge swipe and an avatar
 * tap away from being undiscoverable, and which mixed shared destinations
 * (Community, Jobs) in with personal settings. What is here is exactly what
 * belongs to one student: their profile and academic details, the two ledgers
 * they alone read (Budget, Downloads), the two modes that change how the app
 * behaves for them, Settings and Log out.
 *
 * The row list itself is built by meRows.ts, which is pure and unit-tested;
 * this file is the render and the wiring.
 */
export function MeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const theme = useAppTheme();
  const { profileName, profileAvatarUri, profileEmail } = useChrome();
  const signOut = useAuthStore((s) => s.signOut);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const { lowDataMode, toggleLowDataMode } = useLowDataMode();

  const darkMode = theme === 'dark';

  const toggleTheme = useCallback(() => {
    // The quick switch is light/dark only; Settings keeps the System option.
    void updateSettings('appearance', { theme: darkMode ? 'light' : 'dark' });
  }, [darkMode, updateSettings]);

  const onRow = useCallback(
    (id: MeRowId) => {
      switch (id) {
        case 'academic':
          navigateFromRoot('AcademicSettings');
          return;
        case 'budget':
          // Budget lives on this stack, so Back returns to Me and the Me tab
          // stays lit the whole time.
          navigation.navigate('BudgetHome');
          return;
        case 'downloads':
          // The Downloads screen is a root-stack modal, shared with the
          // Library tree's course-filtered link — one screen, one door.
          navigateFromRoot('Offline');
          return;
        case 'darkMode':
          toggleTheme();
          return;
        case 'lowData':
          toggleLowDataMode();
          return;
        case 'settings':
          navigateFromRoot('Settings');
          return;
        case 'logout':
          void signOut();
          return;
      }
    },
    [navigation, signOut, toggleLowDataMode, toggleTheme]
  );

  const sections = buildMeSections({ darkMode, lowDataMode });

  const renderRow = (row: MeRow) => {
    const destructive = row.kind === 'destructive';
    const isSwitch = row.kind === 'switch';
    return (
      <Pressable
        key={row.id}
        onPress={() => onRow(row.id)}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        accessibilityRole={isSwitch ? 'switch' : 'button'}
        accessibilityLabel={row.accessibilityLabel}
        accessibilityState={isSwitch ? { checked: row.value === true } : undefined}
        className="flex-row items-center gap-3 px-4 py-3 active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
      >
        <AppIcon
          name={row.icon}
          size={22}
          color={destructive ? colors.error : colors.primary}
        />
        <View className="flex-1 min-w-0">
          <Text
            className={`text-base font-medium ${destructive ? 'text-red-500' : 'text-lantern-text'}`}
          >
            {row.label}
          </Text>
          {row.hint ? (
            <Text className="text-xs text-lantern-text-secondary mt-0.5">{row.hint}</Text>
          ) : null}
        </View>
        {isSwitch ? (
          <Switch
            value={row.value === true}
            onValueChange={() => onRow(row.id)}
            // The row already announces itself as a switch with its state;
            // a second focusable control would announce the same thing twice.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        ) : destructive ? null : (
          <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
      </Pressable>
    );
  };

  return (
    <ScreenScroll>
      <Pressable
        onPress={() => navigateFromRoot('EditProfile')}
        accessibilityRole="button"
        accessibilityLabel={`Edit profile, ${profileName}`}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        className="flex-row items-center gap-3 px-4 py-4"
      >
        <ResolvedAvatar name={profileName} uri={profileAvatarUri} size={56} decorative />
        <View className="flex-1 min-w-0">
          <Text className="text-lg font-bold text-lantern-text" numberOfLines={1}>
            {profileName}
          </Text>
          {profileEmail ? (
            <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
              {profileEmail}
            </Text>
          ) : null}
          <Text className="text-xs font-medium text-lantern-primary mt-0.5">Edit profile</Text>
        </View>
        <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>

      {sections.map((section) => (
        <View
          key={section.id}
          className="mt-2 border-t border-lantern-border bg-lantern-surface"
        >
          {section.rows.map(renderRow)}
        </View>
      ))}
    </ScreenScroll>
  );
}

export default MeScreen;
