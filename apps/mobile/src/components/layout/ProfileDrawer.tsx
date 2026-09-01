import React, { useEffect, useRef } from 'react';
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeScope, useTheme } from '../../theme';
import { ResolvedAvatar } from '../ResolvedAvatar';

interface Props {
  open: boolean;
  onClose: () => void;
  name: string;
  subtitle: string | null;
  avatarUri: string | null;
  onEditProfile: () => void;
  onJobs: () => void;
  /** False hides Jobs for accounts outside the private pilot. */
  showJobs: boolean;
  onSettings: () => void;
  onLogout: () => void;
  lowDataMode: boolean;
  onToggleLowData: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

/**
 * Left-side profile drawer, replacing the old More sheet. Opened by tapping
 * the avatar in the top bar or swiping right from the left screen edge
 * (DrawerEdgeSwipe below); closed by the backdrop, a left swipe on the panel,
 * or the hardware back handled by the caller.
 *
 * A plain animated overlay rather than a Modal so the edge-swipe gesture and
 * the drawer share one coordinate space inside MainTabs.
 */
export function ProfileDrawer({
  open,
  onClose,
  name,
  subtitle,
  avatarUri,
  onEditProfile,
  onJobs,
  showJobs,
  onSettings,
  onLogout,
  lowDataMode,
  onToggleLowData,
  theme,
  onToggleTheme,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(320, Math.round(windowWidth * 0.8));

  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  // Mounted only while open (or animating shut) so the overlay never eats taps.
  const [rendered, setRendered] = React.useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      Animated.timing(translateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateX, {
        toValue: -drawerWidth,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [open, drawerWidth, translateX]);

  // Android hardware back must close the open drawer, not navigate under it.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        translateX.setValue(Math.min(0, g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -drawerWidth / 3 || g.vx < -0.4) {
          onClose();
        } else {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 160,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!rendered) return null;

  const backdropOpacity = translateX.interpolate({
    inputRange: [-drawerWidth, 0],
    outputRange: [0, 1],
  });

  const row = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
    options?: { destructive?: boolean }
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3 px-4 py-3.5 rounded-xl active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
    >
      <Ionicons
        name={icon}
        size={22}
        color={options?.destructive ? colors.error : colors.primary}
      />
      <Text
        className={`flex-1 text-base font-medium ${
          options?.destructive ? 'text-red-500' : 'text-lantern-text'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    // zIndex/elevation must beat the TopBar's (zIndex 20 / elevation 4) or, on
    // Android, the bar paints over the drawer's profile header and stays
    // undimmed above the backdrop.
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 40, elevation: 24 }]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close profile menu"
        />
      </Animated.View>
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: drawerWidth,
          transform: [{ translateX }],
          backgroundColor: colors.surface,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: colors.border,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
          elevation: 24,
        }}
      >
        <ThemeScope className="flex-1">
          <Pressable
            onPress={onEditProfile}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            className="flex-row items-center gap-3 px-4 pb-4 border-b border-lantern-border"
          >
            <ResolvedAvatar name={name} uri={avatarUri} size={52} decorative />
            <View className="flex-1">
              <Text className="text-base font-bold text-lantern-text" numberOfLines={1}>
                {name}
              </Text>
              {subtitle ? (
                <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>

          <View className="flex-1 pt-2 px-1">
            {/* Jobs moved off the bottom bar to here: it is a private-pilot
                surface, so it is listed only for accounts that can open it. */}
            {showJobs ? row('briefcase-outline', 'Jobs', onJobs) : null}
            {row('settings-outline', 'Settings', onSettings)}
            {row(
              lowDataMode ? 'cellular-outline' : 'wifi-outline',
              lowDataMode ? 'Low-data mode: ON' : 'Low-data mode: OFF',
              onToggleLowData
            )}
            {row(
              theme === 'dark' ? 'sunny-outline' : 'moon-outline',
              theme === 'dark' ? 'Light mode' : 'Dark mode',
              onToggleTheme
            )}
          </View>

          <View className="px-1 border-t border-lantern-border pt-2">
            {row('log-out-outline', 'Log out', onLogout, { destructive: true })}
          </View>
        </ThemeScope>
      </Animated.View>
    </View>
  );
}

/**
 * Invisible strip along the left screen edge that opens the drawer on a
 * rightward swipe. On gesture-navigation Androids the system back gesture can
 * claim the very edge first — the avatar button in the top bar is the always-
 * available path; this is the shortcut for the devices where it works.
 */
export function DrawerEdgeSwipe({
  enabled,
  onOpen,
}: {
  enabled: boolean;
  onOpen: () => void;
}) {
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => onOpen(),
    })
  ).current;

  if (!enabled) return null;

  return (
    <View
      {...panResponder.panHandlers}
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 20 }}
      pointerEvents="box-only"
    />
  );
}

export default ProfileDrawer;
