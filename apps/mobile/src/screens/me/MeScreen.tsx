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
import { FeatureDisc } from '../../components/ui';
import { useAIUsage } from '../../components/AIUsageBadge';
import { getAIResetLabel } from '@lantern/shared/utils';
import { typeScale, tabularNums } from '../../design/typeScale';

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
  // The credits row is a READOUT: the same figures the top bar's sparkle
  // carries, printed where a student goes looking for what is theirs.
  const aiUsage = useAIUsage();

  const darkMode = theme === 'dark';

  const toggleTheme = useCallback(() => {
    // The quick switch is light/dark only; Settings keeps the System option.
    void updateSettings('appearance', { theme: darkMode ? 'light' : 'dark' });
  }, [darkMode, updateSettings]);

  const onRow = useCallback(
    (id: MeRowId) => {
      switch (id) {
        case 'credits':
          // A readout, not a door. Nothing to navigate to.
          return;
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

  const creditsHint =
    aiUsage.limit > 0
      ? getAIResetLabel(aiUsage.resetsAt, { used: aiUsage.used, limit: aiUsage.limit })
      : '';

  const renderRow = (row: MeRow) => {
    const destructive = row.kind === 'destructive';
    const isSwitch = row.kind === 'switch';
    const isReadout = row.kind === 'readout';
    // A readout is not pressable, so it must not be a Pressable: RN would
    // still announce it as a button and a reader would tap it expecting a
    // screen. `View` is the honest element.
    const Row = isReadout ? View : Pressable;
    const hint = row.id === 'credits' ? creditsHint || row.hint : row.hint;
    return (
      <Row
        key={row.id}
        {...(isReadout
          ? // A plain View speaks its accessibilityLabel only when it is an
            // accessible element; without this the counter (hidden below) is
            // silent to a screen reader.
            { accessible: true }
          : {
              onPress: () => onRow(row.id),
              accessibilityRole: isSwitch ? ('switch' as const) : ('button' as const),
              accessibilityState: isSwitch ? { checked: row.value === true } : undefined,
            })}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        accessibilityLabel={
          isReadout && row.id === 'credits' && aiUsage.limit > 0
            ? `${row.accessibilityLabel}, ${aiUsage.remaining} of ${aiUsage.limit} left${creditsHint ? `. ${creditsHint}` : ''}`
            : row.accessibilityLabel
        }
        className={`flex-row items-center gap-3 px-4 py-3 ${
          isReadout ? '' : 'active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary'
        }`}
      >
        {/* Neutral everywhere except the two rows §5.7 accents: Downloads on
            amber, Credits on indigo. Everything else is a plain glyph in the
            secondary ink — the whole row list used to be primary indigo, which
            made nine equally loud rows and so highlighted nothing. */}
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
          {hint ? (
            <Text className="text-caption text-lantern-text-secondary mt-0.5">{hint}</Text>
          ) : null}
        </View>
        {isReadout ? (
          // Tabular numerals so the counter does not jitter as it ticks down.
          <Text
            style={[typeScale.body, tabularNums, { color: colors.text, fontWeight: '700' }]}
            importantForAccessibility="no"
          >
            {aiUsage.limit > 0 ? `${aiUsage.remaining}/${aiUsage.limit}` : '—'}
          </Text>
        ) : isSwitch ? (
          <Switch
            value={row.value === true}
            onValueChange={() => onRow(row.id)}
            // The row already announces itself as a switch with its state;
            // a second focusable control would announce the same thing twice.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            // The theme's four switch tokens, the same ones Settings uses.
            // Without an explicit thumb, Android paints its own accent — which
            // on this device was a green thumb riding a purple track.
            trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
            thumbColor={row.value === true ? colors.switchThumbOn : colors.switchThumbOff}
            ios_backgroundColor={colors.switchTrackOff}
          />
        ) : destructive ? null : (
          <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
      </Row>
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
          <Text className="text-heading font-bold text-lantern-text" numberOfLines={1}>
            {profileName}
          </Text>
          {profileEmail ? (
            <Text className="text-caption text-lantern-text-secondary" numberOfLines={1}>
              {profileEmail}
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
    </ScreenScroll>
  );
}

export default MeScreen;
