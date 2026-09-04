// ===========================================
// Lantern Study Mobile - Settings Screen
// Synced with backend (shared with web app)
// ===========================================

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import Constants from 'expo-constants';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTheme } from '../../theme';
import { SCREEN_KEYBOARD_BEHAVIOR, Screen, useScreenBottomPadding } from '../../components/layout';
import { exportUserData, fetchMarketplaceCampuses, fetchUserProfile } from '../../services/api';
import type { AccountLifecycleInfo } from '@lantern/shared';
import { marketplaceComplianceBanner } from '@lantern/shared';
import { SETTINGS_FAQ } from '@lantern/shared/settings';
import { studyLevelLabel } from '@lantern/shared/academic';
import { usePaystackEnabled } from '../../hooks/usePaystackEnabled';
import { filterCampusesByQuery, isOtherCityCampus } from '@lantern/shared/marketplace';
import { AccountLifecycleModals, AccountPausedBannerMobile } from '../../components/AccountLifecycleModals';
import { reactivateUserAccount } from '../../services/accountLifecycle';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { ContactSupportModal } from '../../components/ContactSupportModal';
import { LEGAL_DOCUMENT_TITLES } from '@lantern/shared/legal';
import { checkAndApplyOtaUpdate, getOtaDiagnostics } from '../../services/otaUpdates';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { ChatWallpaperSheet } from '../../components/chat/ChatWallpaperSheet';
import { useChatWallpaperStore } from '../../stores/chatWallpaperStore';
import { openCookiePreferenceCenter } from '../../components/CookieNoticeBanner';
import { shareTextFile, SharingUnavailableError } from '../../utils/shareFile';
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';

// First entry must match DEFAULT_USER_SETTINGS.appearance.accentColor so a fresh
// account shows a selected swatch (and matches the web default primary).
const ACCENT_PRESETS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'] as const;
const THEME_OPTIONS = [
  { value: 'system' as const, label: 'System', icon: 'phone-portrait-outline' as const },
  { value: 'light' as const, label: 'Light', icon: 'sunny-outline' as const },
  { value: 'dark' as const, label: 'Dark', icon: 'moon-outline' as const },
];

interface SettingItemProps {
  icon: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  colors: any;
}

const SettingItem = ({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  rightElement,
  showChevron = true,
  colors,
}: SettingItemProps) => (
  <TouchableOpacity
    style={[styles.settingItem, { borderBottomColor: colors.border }]}
    onPress={onPress}
    disabled={!onPress && !rightElement}
    activeOpacity={onPress ? 0.7 : 1}
    accessibilityRole={onPress ? 'button' : undefined}
    accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
  >
    <View style={[styles.settingIcon, { backgroundColor: iconColor + '20' }]}>
      <Ionicons name={icon as any} size={22} color={iconColor} />
    </View>
    <View style={styles.settingContent}>
      <Text style={[styles.settingTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
    {rightElement || (showChevron && onPress && (
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    ))}
  </TouchableOpacity>
);

// Time formatter helper
const formatTime = (timeString: string) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, signOut, profileName, academicProfile } = useAuthStore();
  const {
    settings,
    isSyncing,
    hasUnsyncedChanges,
    loadSettings, 
    updateSingleSetting,
    updateSettings,
    syncSettings,
    resetToDefaults,
  } = useSettingsStore();
  
  // Theme
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  // Edge-to-edge: bottom-sheet buttons must clear the system nav bar.
  const sheetInsetPad = { paddingBottom: insets.bottom + 40 };
  // Replaces the hand-typed `<View style={{ height: 100 }} />` tail spacer.
  const bottomPadding = useScreenBottomPadding();
  const paystackEnabled = usePaystackEnabled();

  const modalTheme = useMemo(
    () => ({
      overlay: { backgroundColor: colors.modalOverlay },
      content: { backgroundColor: colors.modalBackground },
      title: { color: colors.text },
      label: { color: colors.textSecondary },
      value: { color: colors.primary },
      optionItem: {
        backgroundColor: colors.backgroundSecondary,
        borderColor: 'transparent' as const,
      },
      optionItemActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primaryBackground,
      },
      optionTitle: { color: colors.text },
      optionDescription: { color: colors.textSecondary },
    }),
    [colors]
  );
  
  // Modal states
  const [showDailyGoalModal, setShowDailyGoalModal] = useState(false);
  const [showReminderTimeModal, setShowReminderTimeModal] = useState(false);
  const [showSRSSettingsModal, setShowSRSSettingsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showDirectMessagesModal, setShowDirectMessagesModal] = useState(false);
  const [showAccessibilityModal, setShowAccessibilityModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showImportAccountModal, setShowImportAccountModal] = useState(false);
  const [showCampusModal, setShowCampusModal] = useState(false);
  const [wallpaperSheetOpen, setWallpaperSheetOpen] = useState(false);
  const defaultWallpaper = useChatWallpaperStore((s) => s.manifest.default);
  const hydrateWallpapers = useChatWallpaperStore((s) => s.hydrate);
  // Settings has no transcript to overlay, so the row itself carries the
  // progress: preparing a large photo takes seconds on a cheap Android.
  const wallpaperBusy = useChatWallpaperStore((s) => s.busy);
  // Settings can be the first screen to touch the wallpaper store in a session
  // (a student who has not opened a chat yet), and pickAndApply needs the
  // user id the hydrate call installs.
  useEffect(() => {
    void hydrateWallpapers(user?.id ?? null);
  }, [hydrateWallpapers, user?.id]);
  const [checkingOta, setCheckingOta] = useState(false);
  const otaDiagnostics = useMemo(() => getOtaDiagnostics(), []);
  const [accountLifecycle, setAccountLifecycle] = useState<AccountLifecycleInfo | null>(null);
  const [reactivatingAccount, setReactivatingAccount] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [campuses, setCampuses] = useState<Array<{ id: string; name: string; city: string; state?: string; slug?: string }>>([]);
  const [campusesLoading, setCampusesLoading] = useState(false);
  const [campusSearch, setCampusSearch] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  
  // Temp values for modals
  const [tempDailyCardGoal, setTempDailyCardGoal] = useState(settings.study.dailyCardGoal);
  const [tempDailyTestGoal, setTempDailyTestGoal] = useState(settings.study.dailyTestGoal);
  
  // Load settings on mount
  useEffect(() => {
    if (user?.id) {
      loadSettings(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void fetchUserProfile(user.id)
      .then((profile) => {
        if (cancelled) return;
        const url =
          (profile as { avatar_url?: string; avatarUrl?: string }).avatar_url ||
          (profile as { avatarUrl?: string }).avatarUrl ||
          (user.user_metadata?.avatar_url as string | undefined) ||
          null;
        setProfileAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setProfileAvatarUrl((user.user_metadata?.avatar_url as string | undefined) || null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.user_metadata?.avatar_url]);

  useEffect(() => {
    let cancelled = false;
    const country = settings.marketplace?.country_code || 'NG';
    setCampusesLoading(true);
    void fetchMarketplaceCampuses(country)
      .then((rows) => {
        if (!cancelled) setCampuses(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setCampuses([]);
      })
      .finally(() => {
        if (!cancelled) setCampusesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.marketplace?.country_code]);

  const selectedCampusLabel = useMemo(() => {
    const campusId = settings.marketplace?.campus_id;
    if (!campusId) return 'All campuses (no default filter)';
    const match = campuses.find((c) => c.id === campusId);
    if (!match) return 'Campus selected';
    if (isOtherCityCampus(match) && settings.marketplace?.campus_other) {
      return `Other — ${settings.marketplace.campus_other}`;
    }
    return `${match.name} (${match.city})`;
  }, [campuses, settings.marketplace?.campus_id, settings.marketplace?.campus_other]);

  const filteredCampuses = useMemo(
    () => filterCampusesByQuery(campuses, campusSearch),
    [campuses, campusSearch]
  );

  const selectedCampus = useMemo(
    () => campuses.find((c) => c.id === settings.marketplace?.campus_id) || null,
    [campuses, settings.marketplace?.campus_id]
  );

  // Sync indicator
  const SyncIndicator = () => {
    if (isSyncing) {
      return <ActivityIndicator size="small" color="#6366f1" style={{ marginRight: 8 }} />;
    }
    if (hasUnsyncedChanges) {
      return <View style={styles.unsyncedDot} />;
    }
    return null;
  };

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => {
            signOut();
          },
        },
      ]
    );
  }, [signOut]);

  /**
   * Hand the export to the share sheet so it can actually leave the phone.
   * It used to write the file and then only print the path in an alert — a
   * sandboxed path the user has no way to open, which for a GDPR data export
   * means the right to obtain your data stopped one step short of delivering it.
   */
  const handleExportData = useCallback(async () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    let payload: unknown;
    try {
      const res = await exportUserData(userId);
      payload = (res as any)?.data ?? res;
    } catch {
      Alert.alert('Export failed', 'You may only export once every 24 hours.');
      return;
    }

    // The export itself succeeded; a sharing problem must not be reported as a
    // rate limit, and must not lose the data.
    try {
      const stamp = toDateOnlyLocal(new Date());
      await shareTextFile({
        fileName: `lantern-export-${stamp}.json`,
        contents: JSON.stringify(payload, null, 2),
        dialogTitle: 'Export your Lantern Study data',
      });
    } catch (shareError) {
      if (shareError instanceof SharingUnavailableError) {
        Alert.alert(
          'Sharing unavailable',
          'This device cannot open a share sheet, so the export could not be sent anywhere.'
        );
        return;
      }
      Alert.alert(
        'Export failed',
        shareError instanceof Error ? shareError.message : 'Could not share your data.'
      );
    }
  }, []);

  const handleDeleteAccount = useCallback(() => {
    setShowDeleteAccountModal(true);
  }, []);

  const handleReactivateAccount = useCallback(async () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    setReactivatingAccount(true);
    try {
      await reactivateUserAccount(userId);
      setAccountLifecycle({ status: 'active' });
      Alert.alert('Account reactivated', 'Welcome back to Lantern Study.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reactivate account.');
    } finally {
      setReactivatingAccount(false);
    }
  }, []);

  const handleManualSync = useCallback(async () => {
    if (!user?.id) return;
    const result = await syncSettings(user.id, { force: true });
    if (result === 'synced') {
      Alert.alert('Synced', 'Settings synced successfully!');
    } else if (result === 'deferred') {
      Alert.alert('Waiting for Wi‑Fi', 'Sync on Wi‑Fi only is enabled. Connect to Wi‑Fi to sync.');
    } else if (result === 'conflict') {
      Alert.alert(
        'Updated elsewhere',
        'Settings were changed on another device. Latest values were reloaded; review and sync again if needed.'
      );
    } else if (result === 'skipped') {
      Alert.alert('Sync', 'Nothing to sync right now.');
    } else {
      Alert.alert(
        'Sync failed',
        'Could not reach the server. Your changes are saved on this device and will retry later.'
      );
    }
  }, [user?.id, syncSettings]);

  const handleResetSettings = useCallback(() => {
    Alert.alert(
      'Reset Settings',
      'This will reset all settings to defaults. Your study data will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetToDefaults();
            if (!user?.id) {
              Alert.alert('Reset', 'Settings reset on this device.');
              return;
            }
            const result = await syncSettings(user.id, { force: true });
            if (result === 'synced') {
              Alert.alert('Reset', 'Settings have been reset to defaults.');
            } else if (result === 'deferred') {
              Alert.alert(
                'Reset locally',
                'Defaults applied on this device. Connect to Wi‑Fi to sync.'
              );
            } else {
              Alert.alert(
                'Reset locally',
                'Defaults applied on this device, but sync failed. They will retry later.'
              );
            }
          },
        },
      ]
    );
  }, [resetToDefaults, syncSettings, user?.id]);

  const handleReminderTimeChange = useCallback((event: any, selectedDate?: Date) => {
    setShowTimePicker(false);
    if (selectedDate) {
      const hours = selectedDate.getHours().toString().padStart(2, '0');
      const minutes = selectedDate.getMinutes().toString().padStart(2, '0');
      updateSingleSetting('notifications', 'reminderTime', `${hours}:${minutes}`);
    }
  }, [updateSingleSetting]);

  const saveDailyGoals = useCallback(() => {
    updateSingleSetting('study', 'dailyCardGoal', tempDailyCardGoal);
    updateSingleSetting('study', 'dailyTestGoal', tempDailyTestGoal);
    setShowDailyGoalModal(false);
  }, [tempDailyCardGoal, tempDailyTestGoal, updateSingleSetting]);

  // Parse reminder time for picker
  const reminderTimeParts = settings.notifications.reminderTime.split(':');
  const reminderDate = new Date();
  reminderDate.setHours(parseInt(reminderTimeParts[0]), parseInt(reminderTimeParts[1]));

  // Never show loading screen - we always have default settings
  // The store will update in the background if needed

  return (
    <Screen bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12, padding: 4 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text, flex: 1 }]}>Settings</Text>
            <SyncIndicator />
          </View>
          {settings.sync.lastSyncTime && (
            <Text style={[styles.lastSyncText, { color: colors.textTertiary }]}>
              Last synced: {new Date(settings.sync.lastSyncTime).toLocaleString()}
            </Text>
          )}
        </View>

        {accountLifecycle?.status === 'deactivated' ? (
          <AccountPausedBannerMobile
            lifecycle={accountLifecycle}
            onReactivate={() => void handleReactivateAccount()}
            onExport={() => void handleExportData()}
            loading={reactivatingAccount}
          />
        ) : null}

        {/* Profile Section */}
        <View style={[styles.profileSection, { backgroundColor: colors.card }]}>
          <ResolvedAvatar
            name={user?.user_metadata?.name || user?.email || 'U'}
            uri={profileAvatarUrl}
            size={56}
          />
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>{user?.user_metadata?.name || 'User'}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email || 'user@example.com'}</Text>
          </View>
          <TouchableOpacity
            style={styles.editProfileButton}
            onPress={() => navigation.navigate('EditProfile' as never)}
          >
            <Ionicons name="pencil" size={18} color="#6366f1" />
          </TouchableOpacity>
        </View>

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Notifications</Text>
          <Text style={[styles.subGroupTitle, { color: colors.textTertiary }]}>Push & in-app</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="notifications-outline"
              iconColor="#8b5cf6"
              title="Push Notifications"
              subtitle="Device push alerts, synced across devices"
              rightElement={
                <Switch
                  value={settings.notifications.pushEnabled}
                  onValueChange={(val) => updateSingleSetting('notifications', 'pushEnabled', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.pushEnabled ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="calendar-outline"
              iconColor="#10b981"
              title="Daily Reminders"
              subtitle="Get reminded to study"
              rightElement={
                <Switch
                  value={settings.notifications.dailyReminder}
                  onValueChange={(val) => updateSingleSetting('notifications', 'dailyReminder', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.dailyReminder ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="alarm-outline"
              iconColor="#ef4444"
              title="Reminder Time"
              subtitle={
                settings.notifications.dailyReminder
                  ? formatTime(settings.notifications.reminderTime)
                  : 'Turn on Daily Reminders to set a time'
              }
              onPress={settings.notifications.dailyReminder ? () => setShowTimePicker(true) : undefined}
            />
            <SettingItem
              colors={colors}
              icon="people-outline"
              iconColor="#f97316"
              title="Group Activity"
              subtitle="Messages and questions in groups"
              rightElement={
                <Switch
                  value={settings.notifications.groupActivity}
                  onValueChange={(val) => updateSingleSetting('notifications', 'groupActivity', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.groupActivity ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="mail-unread-outline"
              iconColor="#6366f1"
              title="Group Invites"
              subtitle="When someone invites you to a group"
              rightElement={
                <Switch
                  value={settings.notifications.groupInvites !== false}
                  onValueChange={(val) => updateSingleSetting('notifications', 'groupInvites', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.groupInvites !== false ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="storefront-outline"
              iconColor="#a855f7"
              title="Marketplace Updates"
              subtitle="Listing and inquiry alerts"
              rightElement={
                <Switch
                  value={settings.notifications.marketplaceUpdates}
                  onValueChange={(val) => updateSingleSetting('notifications', 'marketplaceUpdates', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.marketplaceUpdates ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="trophy-outline"
              iconColor="#fbbf24"
              title="Badge Unlocks"
              subtitle="Achievement notifications"
              rightElement={
                <Switch
                  value={settings.notifications.badgeUnlocks}
                  onValueChange={(val) => updateSingleSetting('notifications', 'badgeUnlocks', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.badgeUnlocks ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="refresh-outline"
              iconColor="#0ea5e9"
              title="Review reminders"
              subtitle="Flashcard review reminders"
              rightElement={
                <Switch
                  value={settings.notifications.srsReminders}
                  onValueChange={(val) => updateSingleSetting('notifications', 'srsReminders', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.srsReminders ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="checkmark-done-outline"
              iconColor="#ec4899"
              title="Test Results"
              subtitle="Get notified of test completions"
              rightElement={
                <Switch
                  value={settings.notifications.testResults}
                  onValueChange={(val) => updateSingleSetting('notifications', 'testResults', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.testResults ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
          </View>
          <Text style={[styles.subGroupTitle, { color: colors.textTertiary }]}>Email</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="mail-outline"
              iconColor="#6366f1"
              title="Email Notifications"
              subtitle="Job alerts and important account updates"
              rightElement={
                <Switch
                  value={settings.notifications.emailEnabled}
                  onValueChange={(val) => updateSingleSetting('notifications', 'emailEnabled', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.emailEnabled ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
          </View>
        </View>

        {/* Study Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Study Settings</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="timer-outline"
              iconColor="#f97316"
              title="Daily Goal"
              subtitle={`${settings.study.dailyCardGoal} cards, ${settings.study.dailyTestGoal} test(s)`}
              onPress={() => {
                setTempDailyCardGoal(settings.study.dailyCardGoal);
                setTempDailyTestGoal(settings.study.dailyTestGoal);
                setShowDailyGoalModal(true);
              }}
            />
            <SettingItem
              colors={colors}
              icon="flash-outline"
              iconColor="#fbbf24"
              title="Review settings"
              subtitle={`${settings.study.srsNewCardsPerDay} new cards/day`}
              onPress={() => setShowSRSSettingsModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="school-outline"
              iconColor="#6366f1"
              title="Default Session Mode"
              subtitle={settings.study.defaultTestMode === 'exam' ? 'Timed test mode' : 'Study mode'}
              rightElement={
                <Switch
                  value={settings.study.defaultTestMode === 'exam'}
                  onValueChange={(val) =>
                    updateSingleSetting('study', 'defaultTestMode', val ? 'exam' : 'study')
                  }
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={
                    settings.study.defaultTestMode === 'exam'
                      ? colors.switchThumbOn
                      : colors.switchThumbOff
                  }
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="shuffle-outline"
              iconColor="#8b5cf6"
              title="Shuffle Questions"
              subtitle="Randomize question order in tests"
              rightElement={
                <Switch
                  value={settings.study.shuffleQuestions}
                  onValueChange={(val) => updateSingleSetting('study', 'shuffleQuestions', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.study.shuffleQuestions ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="options-outline"
              iconColor="#10b981"
              title="Shuffle Options"
              subtitle="Randomize answer choices"
              rightElement={
                <Switch
                  value={settings.study.shuffleOptions}
                  onValueChange={(val) => updateSingleSetting('study', 'shuffleOptions', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.study.shuffleOptions ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="eye-outline"
              iconColor="#0ea5e9"
              title="Show Explanations"
              subtitle="Show immediately after answer"
              rightElement={
                <Switch
                  value={settings.study.showExplanationsImmediately}
                  onValueChange={(val) => updateSingleSetting('study', 'showExplanationsImmediately', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.study.showExplanationsImmediately ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="lock-closed-outline"
              iconColor="#f59e0b"
              title="Lock answered questions"
              subtitle="Default tests to exam mode — no going back once answered"
              rightElement={
                <Switch
                  value={settings.study.lockAnsweredQuestions}
                  onValueChange={(val) => updateSingleSetting('study', 'lockAnsweredQuestions', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.study.lockAnsweredQuestions ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
          </View>
        </View>

        {/* Appearance Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Appearance</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <View style={[styles.settingItem, { borderBottomColor: colors.border, flexDirection: 'column', alignItems: 'stretch' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={[styles.settingIcon, { backgroundColor: '#f59e0b20' }]}>
                  <Ionicons name={isDark ? 'moon' : 'sunny'} size={22} color="#f59e0b" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Theme</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>
                    Synced with the web app
                  </Text>
                </View>
              </View>
              <View style={styles.themeChipRow}>
                {THEME_OPTIONS.map((option) => {
                  const selected = themeMode === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.themeChip,
                        {
                          backgroundColor: selected ? colors.primaryBackground : colors.backgroundSecondary,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => {
                        setThemeMode(option.value);
                        void updateSingleSetting('appearance', 'theme', option.value);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={option.icon}
                        size={16}
                        color={selected ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={{
                          color: selected ? colors.primary : colors.text,
                          fontSize: 13,
                          fontWeight: selected ? '600' : '500',
                        }}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <SettingItem
              colors={colors}
              icon="cellular-outline"
              iconColor="#0ea5e9"
              title="Low-Data Mode"
              subtitle="Lighter images, charts, and page loads"
              rightElement={
                <Switch
                  value={settings.appearance.lowDataMode}
                  onValueChange={(val) => updateSingleSetting('appearance', 'lowDataMode', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.appearance.lowDataMode ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="image-outline"
              iconColor="#10b981"
              title="Chat background"
              subtitle={
                wallpaperBusy
                  ? 'Saving background…'
                  : defaultWallpaper
                    ? 'Your photo — saved on this phone'
                    : 'Default chat colour'
              }
              onPress={() => setWallpaperSheetOpen(true)}
            />
            <View style={[styles.settingItem, { borderBottomColor: colors.border, flexDirection: 'column', alignItems: 'stretch' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={[styles.settingIcon, { backgroundColor: '#ec489920' }]}>
                  <Ionicons name="color-palette-outline" size={22} color="#ec4899" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Accent color</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>
                    Buttons and highlights
                  </Text>
                </View>
              </View>
              <View style={styles.accentRow}>
                {ACCENT_PRESETS.map((hex) => {
                  const selected = settings.appearance.accentColor?.toLowerCase() === hex.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={hex}
                      onPress={() => void updateSingleSetting('appearance', 'accentColor', hex)}
                      style={[
                        styles.accentSwatch,
                        {
                          backgroundColor: hex,
                          borderColor: selected ? colors.text : 'transparent',
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Accent ${hex}`}
                    />
                  );
                })}
              </View>
            </View>
            <SettingItem
              colors={colors}
              icon="text-outline"
              iconColor="#6366f1"
              title="Font Size"
              subtitle={
                settings.appearance.fontSize === 'small'
                  ? 'Small'
                  : settings.appearance.fontSize === 'large'
                    ? 'Large'
                    : 'Medium'
              }
              onPress={() => {
                const order = ['small', 'medium', 'large'] as const;
                const idx = order.indexOf(settings.appearance.fontSize);
                const next = order[(idx + 1) % order.length];
                updateSingleSetting('appearance', 'fontSize', next);
              }}
            />
          </View>
        </View>

        {/* Academic Section (university, programme, level, my courses) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Academic</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="school-outline"
              iconColor="#6366f1"
              title="University, programme & courses"
              subtitle={
                academicProfile?.institution?.name
                  ? [
                      academicProfile.institution.name,
                      academicProfile.programme,
                      academicProfile.studyLevel ? studyLevelLabel(academicProfile.studyLevel) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Set your university, level and this semester’s courses'
              }
              onPress={() => navigation.navigate('AcademicSettings' as never)}
            />
            <SettingItem
              colors={colors}
              icon="gift-outline"
              iconColor="#f59e0b"
              title="Invite friends"
              subtitle="Share Lantern with your campus"
              onPress={() => navigation.navigate('InviteFriends' as never)}
            />
          </View>
        </View>

        {/* Marketplace Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Marketplace</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <View style={[styles.complianceBanner, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <Text style={[styles.complianceText, { color: colors.textSecondary }]}>
                {marketplaceComplianceBanner(paystackEnabled)}
              </Text>
            </View>
            <SettingItem
              colors={colors}
              icon="flag-outline"
              iconColor="#10b981"
              title="Country"
              subtitle="Nigeria — more countries coming soon"
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="school-outline"
              iconColor="#6366f1"
              title="Your campus"
              subtitle={campusesLoading ? 'Loading campuses…' : selectedCampusLabel}
              onPress={() => setShowCampusModal(true)}
            />
          </View>
        </View>

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Privacy</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="eye-outline"
              iconColor="#6366f1"
              title="Profile Visibility"
              subtitle={
                settings.privacy.profileVisibility === 'public'
                  ? 'Visible to everyone'
                  : settings.privacy.profileVisibility === 'groups'
                    ? 'Visible to group members'
                    : 'Full profile only you — still findable in search'
              }
              onPress={() => setShowPrivacyModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="chatbubble-ellipses-outline"
              iconColor="#8b5cf6"
              title="Direct Messages"
              subtitle={
                settings.privacy.allowDirectMessages === 'everyone'
                  ? 'Anyone can message you directly'
                  : settings.privacy.allowDirectMessages === 'groups'
                    ? 'Group members open; others send requests'
                    : 'Message requests only'
              }
              onPress={() => setShowDirectMessagesModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="ban-outline"
              iconColor="#ef4444"
              title="Blocked Users"
              subtitle="Review and unblock people you have blocked"
              onPress={() => navigation.navigate('BlockedUsers' as never)}
            />
            <SettingItem
              colors={colors}
              icon="search-outline"
              iconColor="#6366f1"
              title="Discoverable for Invites"
              subtitle="Let others find you by name or @username in people search and invites"
              rightElement={
                <Switch
                  value={settings.privacy.discoverableForInvites !== false}
                  onValueChange={(val) => updateSingleSetting('privacy', 'discoverableForInvites', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.privacy.discoverableForInvites !== false ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="radio-button-on-outline"
              iconColor="#10b981"
              title="Online Status"
              subtitle="Show when you're active"
              rightElement={
                <Switch
                  value={settings.privacy.showOnlineStatus}
                  onValueChange={(val) => updateSingleSetting('privacy', 'showOnlineStatus', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.privacy.showOnlineStatus ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="bar-chart-outline"
              iconColor="#f97316"
              title="Study Activity"
              subtitle="Share your study stats"
              rightElement={
                <Switch
                  value={settings.privacy.showStudyActivity}
                  onValueChange={(val) => updateSingleSetting('privacy', 'showStudyActivity', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.privacy.showStudyActivity ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="cookie-outline"
              iconColor="#a16207"
              title="Manage cookie preferences"
              subtitle="Optional analytics and cookie categories"
              onPress={() => openCookiePreferenceCenter()}
            />
          </View>
        </View>

        {/* Sync & Data Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Sync & Data</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="sync-outline"
              iconColor="#0ea5e9"
              title="Auto Sync"
              subtitle="Sync changes automatically"
              rightElement={
                <Switch
                  value={settings.sync.autoSync}
                  onValueChange={(val) => updateSingleSetting('sync', 'autoSync', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.sync.autoSync ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="wifi-outline"
              iconColor="#10b981"
              title="Sync on Wi-Fi Only"
              subtitle="Save mobile data"
              rightElement={
                <Switch
                  value={settings.sync.syncOnWifiOnly}
                  onValueChange={(val) => updateSingleSetting('sync', 'syncOnWifiOnly', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.sync.syncOnWifiOnly ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="cloud-upload-outline"
              iconColor="#8b5cf6"
              title="Sync Now"
              subtitle={hasUnsyncedChanges ? 'You have unsynced changes' : 'All changes synced'}
              onPress={handleManualSync}
            />
            <SettingItem
              colors={colors}
              icon="cloud-download-outline"
              iconColor="#6366f1"
              title="Offline Mode"
              subtitle="Download tests for offline access"
              onPress={() => navigation.navigate('Offline')}
            />
          </View>
        </View>

        {/* Accessibility Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Accessibility</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="phone-portrait-outline"
              iconColor="#a855f7"
              title="Haptic Feedback"
              subtitle="Vibration on interactions"
              rightElement={
                <Switch
                  value={settings.accessibility.hapticFeedback}
                  onValueChange={(val) => updateSingleSetting('accessibility', 'hapticFeedback', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.accessibility.hapticFeedback ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="sparkles-outline"
              iconColor="#fbbf24"
              title="Reduce Motion"
              subtitle="Minimize animations"
              rightElement={
                <Switch
                  value={settings.accessibility.reduceMotion}
                  onValueChange={(val) => updateSingleSetting('accessibility', 'reduceMotion', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.accessibility.reduceMotion ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="contrast-outline"
              iconColor="#ef4444"
              title="High Contrast"
              subtitle="Increase color contrast"
              rightElement={
                <Switch
                  value={settings.accessibility.highContrast}
                  onValueChange={(val) => updateSingleSetting('accessibility', 'highContrast', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.accessibility.highContrast ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
          </View>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Support</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="help-circle-outline"
              iconColor="#6366f1"
              title="Help & FAQ"
              onPress={() => setShowHelpModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="chatbubble-outline"
              iconColor="#10b981"
              title="Contact Support"
              onPress={() => setShowContactModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="bulb-outline"
              iconColor="#8b5cf6"
              title="Replay feature tips"
              subtitle="Show the getting-started tips again"
              onPress={() => {
                useFeatureTipStore.getState().replay();
                Alert.alert('Feature tips reset', 'Explore the app to see navigation tips again.');
              }}
            />
            <SettingItem
              colors={colors}
              icon="refresh-circle-outline"
              iconColor="#f97316"
              title="Reset Settings"
              subtitle="Restore default settings"
              onPress={handleResetSettings}
            />
          </View>
        </View>

        {/* Account & Legal */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Account</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="download-outline"
              iconColor="#6366f1"
              title="Export my data"
              subtitle="Download a JSON copy (once per 24h)"
              onPress={() => void handleExportData()}
            />
            <SettingItem
              colors={colors}
              icon="document-text-outline"
              iconColor="#8b5cf6"
              title="Privacy Policy"
              onPress={() => navigation.navigate('LegalDocument' as never, { document: 'privacy' } as never)}
            />
            <SettingItem
              colors={colors}
              icon="document-outline"
              iconColor="#8b5cf6"
              title="Cookie Policy"
              onPress={() => navigation.navigate('LegalDocument' as never, { document: 'cookies' } as never)}
            />
            <SettingItem
              colors={colors}
              icon="shield-outline"
              iconColor="#8b5cf6"
              title="Terms of Service"
              onPress={() => navigation.navigate('LegalDocument' as never, { document: 'terms' } as never)}
            />
            <SettingItem
              colors={colors}
              icon="ban-outline"
              iconColor="#8b5cf6"
              title={LEGAL_DOCUMENT_TITLES.prohibited}
              subtitle="What may not be shared or sold, how to report it"
              onPress={() => navigation.navigate('LegalDocument' as never, { document: 'prohibited' } as never)}
            />
            <SettingItem
              colors={colors}
              icon="storefront-outline"
              iconColor="#8b5cf6"
              title={LEGAL_DOCUMENT_TITLES['seller-terms']}
              subtitle="Rights, takedowns, appeals, strikes and payouts"
              onPress={() => navigation.navigate('LegalDocument' as never, { document: 'seller-terms' } as never)}
            />
            <SettingItem
              colors={colors}
              icon="cloud-upload-outline"
              iconColor="#6366f1"
              title="Import backup"
              subtitle="Restore notes and flashcards from export"
              onPress={() => setShowImportAccountModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="trash-outline"
              iconColor="#ef4444"
              title="Delete or pause account"
              subtitle="Pause 30 days or delete with password"
              onPress={handleDeleteAccount}
            />
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* App update / version */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>App update</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
            <SettingItem
              colors={colors}
              icon="cloud-download-outline"
              iconColor="#6569EE"
              title="Check for update"
              subtitle={
                checkingOta
                  ? 'Checking…'
                  : otaDiagnostics.isEnabled
                    ? `Channel ${otaDiagnostics.channel || '—'} · ${otaDiagnostics.updateId ? otaDiagnostics.updateId.slice(0, 8) : 'embedded'}`
                    : 'OTA disabled on this build'
              }
              showChevron={false}
              onPress={() => {
                if (checkingOta) return;
                setCheckingOta(true);
                void checkAndApplyOtaUpdate()
                  .then((result) => {
                    if (result.updated) return;
                    if (!result.isEnabled) {
                      Alert.alert(
                        'Updates unavailable',
                        'This install has OTA disabled (Expo Go or a development build). Install the preview APK from Expo to receive updates.'
                      );
                      return;
                    }
                    Alert.alert(
                      result.reason === 'up-to-date' ? 'Up to date' : 'No update applied',
                      result.reason === 'up-to-date'
                        ? 'You already have the latest preview update.'
                        : result.reason || 'Could not apply an update.'
                    );
                  })
                  .finally(() => setCheckingOta(false));
              }}
              rightElement={
                checkingOta ? <ActivityIndicator size="small" color={colors.primary} /> : undefined
              }
            />
          </View>
        </View>

        <Text style={[styles.versionText, { color: colors.textTertiary }]}>
          Lantern Study v{Constants.expoConfig?.version || otaDiagnostics.runtimeVersion || '1.0.26'}
        </Text>

      </ScrollView>

      <Modal
        visible={showHelpModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Help & FAQ</Text>
              <TouchableOpacity onPress={() => setShowHelpModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {SETTINGS_FAQ.map(item => (
                <View key={item.q} style={{ marginBottom: 16 }}>
                  <Text style={[styles.goalLabel, modalTheme.label]}>{item.q}</Text>
                  <Text style={[styles.settingSubtitle, modalTheme.optionDescription, { marginTop: 4 }]}>
                    {item.a}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.saveButton, { marginTop: 8, backgroundColor: colors.primary }]}
              onPress={() => {
                setShowHelpModal(false);
                setShowContactModal(true);
              }}
            >
              <Text style={styles.saveButtonText}>Contact support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ContactSupportModal
        visible={showContactModal}
        onClose={() => setShowContactModal(false)}
        defaultName={profileName ?? user?.user_metadata?.name ?? ''}
        defaultEmail={user?.email ?? ''}
        colors={{
          background: colors.background,
          card: colors.card,
          text: colors.text,
          textSecondary: colors.textSecondary,
          border: colors.border,
          primary: colors.primary,
          primaryText: '#ffffff',
        }}
      />

      <Modal
        visible={showCampusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCampusModal(false)}
      >
        {/* The sheet is pinned to the bottom edge and holds a search field, a
            "Your city" field and the Done button — exactly where the keyboard
            lands. Android 15+ (this app targets SDK 36) no longer honours
            adjustResize, so without this the sheet does not move at all. */}
        <KeyboardAvoidingView
          behavior={SCREEN_KEYBOARD_BEHAVIOR}
          style={[styles.modalOverlay, modalTheme.overlay]}
        >
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content, { maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Your campus</Text>
              <TouchableOpacity onPress={() => setShowCampusModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={campusSearch}
              onChangeText={setCampusSearch}
              placeholder="Search universities, polytechnics, or cities…"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.textInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  marginBottom: 10,
                },
              ]}
            />
            {/* Without this the first tap on a campus row is swallowed
                dismissing the search keyboard instead of selecting. */}
            <ScrollView keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[
                  styles.optionItem,
                  modalTheme.optionItem,
                  !settings.marketplace?.campus_id && modalTheme.optionItemActive,
                ]}
                onPress={() => {
                  void updateSettings('marketplace', {
                    country_code: settings.marketplace?.country_code || 'NG',
                    campus_id: null,
                    campus_other: null,
                  });
                  setShowCampusModal(false);
                  setCampusSearch('');
                }}
              >
                <Text style={[styles.optionTitle, modalTheme.optionTitle]}>All campuses</Text>
                <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                  No default campus filter
                </Text>
              </TouchableOpacity>
              {filteredCampuses.map((campus) => {
                const selected = settings.marketplace?.campus_id === campus.id;
                return (
                  <TouchableOpacity
                    key={campus.id}
                    style={[
                      styles.optionItem,
                      modalTheme.optionItem,
                      selected && modalTheme.optionItemActive,
                    ]}
                    onPress={() => {
                      const keepOther = isOtherCityCampus(campus);
                      void updateSettings('marketplace', {
                        country_code: settings.marketplace?.country_code || 'NG',
                        campus_id: campus.id,
                        campus_other: keepOther ? settings.marketplace?.campus_other || null : null,
                      });
                      if (!keepOther) {
                        setShowCampusModal(false);
                        setCampusSearch('');
                      }
                    }}
                  >
                    <Text style={[styles.optionTitle, modalTheme.optionTitle]}>{campus.name}</Text>
                    <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                      {campus.city}{campus.state ? ` · ${campus.state}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {campusSearch.trim() && filteredCampuses.length === 0 ? (
                <Text style={[styles.optionDescription, modalTheme.optionDescription, { padding: 12 }]}>
                  No matches. Try another spelling, or choose Other (city in Nigeria).
                </Text>
              ) : null}
            </ScrollView>
            {isOtherCityCampus(selectedCampus || undefined) ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[styles.optionTitle, modalTheme.optionTitle, { marginBottom: 6 }]}>
                  Your city
                </Text>
                <TextInput
                  value={settings.marketplace?.campus_other || ''}
                  onChangeText={(text) => {
                    void updateSettings('marketplace', {
                      country_code: settings.marketplace?.country_code || 'NG',
                      campus_id: settings.marketplace?.campus_id || null,
                      campus_other: text || null,
                    });
                  }}
                  placeholder="e.g. Abeokuta, Nsukka, Warri"
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.textInput,
                    {
                      color: colors.text,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                />
                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 8, backgroundColor: colors.primary }]}
                  onPress={() => {
                    setShowCampusModal(false);
                    setCampusSearch('');
                  }}
                >
                  <Text style={styles.saveButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {user?.id ? (
        <AccountLifecycleModals
          userId={user.id}
          deleteOpen={showDeleteAccountModal}
          importOpen={showImportAccountModal}
          onCloseDelete={() => setShowDeleteAccountModal(false)}
          onCloseImport={() => setShowImportAccountModal(false)}
          onSignedOut={() => void signOut()}
          onExport={() => void handleExportData()}
          onLifecycleChange={setAccountLifecycle}
        />
      ) : null}

      <ChatWallpaperSheet
        visible={wallpaperSheetOpen}
        onClose={() => setWallpaperSheetOpen(false)}
        scope="default"
        scopeLabel="all your chats"
      />

      {/* Daily Goal Modal */}
      <Modal
        visible={showDailyGoalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDailyGoalModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Daily Goal</Text>
              <TouchableOpacity onPress={() => setShowDailyGoalModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.goalSection}>
              <Text style={[styles.goalLabel, modalTheme.label]}>Daily Card Goal</Text>
              <Text style={[styles.goalValue, modalTheme.value]}>{tempDailyCardGoal} cards</Text>
              <Slider
                style={styles.slider}
                minimumValue={5}
                maximumValue={100}
                step={5}
                value={tempDailyCardGoal}
                onValueChange={setTempDailyCardGoal}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.switchTrackOff}
                thumbTintColor={colors.primary}
              />
            </View>

            <View style={styles.goalSection}>
              <Text style={[styles.goalLabel, modalTheme.label]}>Daily Test Goal</Text>
              <Text style={[styles.goalValue, modalTheme.value]}>{tempDailyTestGoal} test(s)</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={10}
                step={1}
                value={tempDailyTestGoal}
                onValueChange={setTempDailyTestGoal}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.switchTrackOff}
                thumbTintColor={colors.primary}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={saveDailyGoals}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SRS Settings Modal */}
      <Modal
        visible={showSRSSettingsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSRSSettingsModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Review settings</Text>
              <TouchableOpacity onPress={() => setShowSRSSettingsModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.goalSection}>
              <Text style={[styles.goalLabel, modalTheme.label]}>New cards per day</Text>
              <Text style={[styles.goalValue, modalTheme.value]}>{settings.study.srsNewCardsPerDay} cards</Text>
              <Slider
                style={styles.slider}
                minimumValue={5}
                maximumValue={50}
                step={5}
                value={settings.study.srsNewCardsPerDay}
                onValueChange={(val) => updateSingleSetting('study', 'srsNewCardsPerDay', val)}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.switchTrackOff}
                thumbTintColor={colors.primary}
              />
            </View>

            <View style={styles.goalSection}>
              <Text style={[styles.goalLabel, modalTheme.label]}>Longest gap between reviews (days)</Text>
              <Text style={[styles.goalValue, modalTheme.value]}>{settings.study.srsMaxInterval} days</Text>
              <Slider
                style={styles.slider}
                minimumValue={30}
                maximumValue={365}
                step={30}
                value={settings.study.srsMaxInterval}
                onValueChange={(val) => updateSingleSetting('study', 'srsMaxInterval', val)}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.switchTrackOff}
                thumbTintColor={colors.primary}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowSRSSettingsModal(false)}
            >
              <Text style={styles.saveButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Privacy Modal */}
      <Modal
        visible={showPrivacyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPrivacyModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Profile Visibility</Text>
              <TouchableOpacity onPress={() => setShowPrivacyModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.optionDescription, modalTheme.optionDescription, { marginBottom: 12 }]}>
              New accounts are public by default so classmates can find you. Pick who can see your profile.
            </Text>
            
            {(['public', 'groups', 'private'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionItem,
                  modalTheme.optionItem,
                  settings.privacy.profileVisibility === option && styles.optionItemActive,
                  settings.privacy.profileVisibility === option && modalTheme.optionItemActive,
                ]}
                onPress={() => {
                  updateSingleSetting('privacy', 'profileVisibility', option);
                  setShowPrivacyModal(false);
                }}
              >
                <View>
                  <Text style={[styles.optionTitle, modalTheme.optionTitle]}>
                    {option === 'public' ? 'Public' : option === 'groups' ? 'Group Members Only' : 'Private'}
                  </Text>
                  <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                    {option === 'public'
                      ? 'Anyone can see your full profile'
                      : option === 'groups'
                        ? 'Only members of your groups can see your full profile'
                        : 'Only you can open your full profile. Others can still find you in search and send a message request.'}
                  </Text>
                </View>
                {settings.privacy.profileVisibility === option && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Direct Messages Modal */}
      <Modal
        visible={showDirectMessagesModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDirectMessagesModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, sheetInsetPad, modalTheme.content]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Direct Messages</Text>
              <TouchableOpacity onPress={() => setShowDirectMessagesModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {(['everyone', 'groups', 'none'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionItem,
                  modalTheme.optionItem,
                  settings.privacy.allowDirectMessages === option && styles.optionItemActive,
                  settings.privacy.allowDirectMessages === option && modalTheme.optionItemActive,
                ]}
                onPress={() => {
                  updateSingleSetting('privacy', 'allowDirectMessages', option);
                  setShowDirectMessagesModal(false);
                }}
              >
                <View>
                  <Text style={[styles.optionTitle, modalTheme.optionTitle]}>
                    {option === 'everyone'
                      ? 'Everyone'
                      : option === 'groups'
                        ? 'Group members open'
                        : 'Message requests only'}
                  </Text>
                  <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                    {option === 'everyone'
                      ? 'Any signed-in user can open a chat with you immediately'
                      : option === 'groups'
                        ? 'Shared group members open chats; others send a message request'
                        : 'Anyone can still message you — new chats arrive as requests you accept or decline'}
                  </Text>
                </View>
                {settings.privacy.allowDirectMessages === option && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Time Picker (Platform-specific) */}
      {showTimePicker && (
        <DateTimePicker
          value={reminderDate}
          mode="time"
          is24Hour={false}
          display="spinner"
          onChange={handleReminderTimeChange}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    paddingVertical: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  lastSyncText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  unsyncedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f97316',
    marginRight: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 12,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1d21',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInitials: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 14,
    color: '#9ca3af',
  },
  editProfileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  subGroupTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionContent: {
    backgroundColor: '#1a1d21',
    borderRadius: 16,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingContent: {
    flex: 1,
    marginLeft: 14,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef444420',
    padding: 16,
    borderRadius: 12,
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ef4444',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#64748b',
  },
  // Modal styles (colors applied via modalTheme from useTheme)
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  goalSection: {
    marginBottom: 24,
  },
  goalLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  goalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  optionItemActive: {
    borderWidth: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  themeOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  themeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  themeOptionText: {
    flex: 1,
  },
  themeChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  accentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accentSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
  },
  complianceBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  complianceText: {
    fontSize: 12,
    lineHeight: 18,
  },
});

