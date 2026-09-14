import React, { useCallback } from 'react';
import { Linking, Pressable, Switch, Text, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  Screen,
  useChrome,
  useScreenBottomPadding,
} from '../../components/layout';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';
import { buildMeSections, type MeRow, type MeRowId } from './meRows';
import { AppIcon } from '../../components/ui/AppIcon';
import { FeatureDisc } from '../../components/ui';
import { studyLevelLabel } from '@lantern/shared';
import { MeWorkspaceBar } from './MeWorkspaceBar';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

const ROW_MIN_HEIGHT = 56;
const TEACH_URL = 'https://lanternstudy.com/teach';

/**
 * Profile — the fifth destination's account half. Progress is the peer screen.
 */
export function MeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { profileName, profileAvatarUri, profileEmail } = useChrome();
  const academicProfile = useAuthStore((s) => s.academicProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const bottomPadding = useScreenBottomPadding({ bottom: 'auto' });

  const academicLine = [
    academicProfile?.institution?.name || null,
    academicProfile?.programme || null,
    academicProfile?.studyLevel != null ? studyLevelLabel(academicProfile.studyLevel) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const onRow = useCallback(
    (id: MeRowId) => {
      switch (id) {
        case 'credits':
          navigateFromRoot('UsageLimits');
          return;
        case 'academic':
          navigateFromRoot('AcademicSettings');
          return;
        case 'joinClass':
          navigateFromRoot('JoinClass');
          return;
        case 'budget':
          navigation.navigate('BudgetHome');
          return;
        case 'downloads':
          navigateFromRoot('Offline');
          return;
        case 'teach':
          void Linking.openURL(TEACH_URL);
          return;
        case 'invite':
          navigateFromRoot('InviteFriends');
          return;
        case 'settings':
          navigateFromRoot('Settings');
          return;
        case 'admin':
          return;
        case 'logout':
          void signOut();
          return;
      }
    },
    [navigation, signOut]
  );

  const sections = buildMeSections();

  const renderRow = (row: MeRow) => {
    const destructive = row.kind === 'destructive';
    const isSwitch = row.kind === 'switch';
    return (
      <Pressable
        key={row.id}
        onPress={() => onRow(row.id)}
        accessibilityRole={isSwitch ? ('switch' as const) : ('button' as const)}
        accessibilityState={isSwitch ? { checked: row.value === true } : undefined}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        accessibilityLabel={row.accessibilityLabel}
        className="flex-row items-center gap-3 px-4 py-3 active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
      >
        {row.feature ? (
          <FeatureDisc feature={row.feature} icon={row.icon} size={32} />
        ) : (
          <View className="w-8 items-center">
            <AppIcon
              name={row.icon}
              size={22}
              color={destructive ? colors.error : colors.textSecondary}
            />
          </View>
        )}
        <View className="flex-1 min-w-0">
          <Text
            className={`text-body font-medium ${destructive ? 'text-red-500' : 'text-lantern-text'}`}
          >
            {row.label}
          </Text>
          {row.hint ? (
            <Text className="text-caption text-lantern-text-secondary mt-0.5">{row.hint}</Text>
          ) : null}
        </View>
        {isSwitch ? (
          <Switch
            value={row.value === true}
            onValueChange={() => onRow(row.id)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
            thumbColor={row.value === true ? colors.switchThumbOn : colors.switchThumbOff}
            ios_backgroundColor={colors.switchTrackOff}
          />
        ) : destructive ? null : (
          <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
      </Pressable>
    );
  };

  return (
    <Screen bottom="none">
      <MeWorkspaceBar
        active="profile"
        onSelect={(section) => {
          if (section === 'progress') navigation.navigate('MeProgress');
        }}
      />
      <KeyboardAwareScrollView bottomPadding={bottomPadding}>
        <Pressable
          onPress={() => navigateFromRoot('EditProfile')}
          accessibilityRole="button"
          accessibilityLabel={`Edit profile, ${profileName}`}
          style={{ minHeight: ROW_MIN_HEIGHT }}
          className="flex-row items-center gap-3 px-4 py-4"
        >
          <ResolvedAvatar name={profileName} uri={profileAvatarUri} size={56} decorative />
          <View className="flex-1 min-w-0">
            <Text className="text-heading font-bold text-lantern-text" numberOfLines={1}>
              {profileName}
            </Text>
            {profileEmail ? (
              <Text className="text-caption text-lantern-text-secondary" numberOfLines={1}>
                {profileEmail}
              </Text>
            ) : null}
            {academicLine ? (
              <Text className="text-caption text-lantern-text-secondary" numberOfLines={1}>
                {academicLine}
              </Text>
            ) : null}
            <Text className="text-caption font-medium text-lantern-primary-text mt-0.5">Edit profile</Text>
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
      </KeyboardAwareScrollView>
    </Screen>
  );
}

export default MeScreen;
