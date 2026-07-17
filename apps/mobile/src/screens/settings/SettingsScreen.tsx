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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuthStore } from '../../stores/authStore';
import { 
  useSettingsStore, 
  DEFAULT_SETTINGS,
  NotificationSettings,
  StudySettings,
  PrivacySettings,
  AccessibilitySettings,
  SyncSettings,
} from '../../stores/settingsStore';
import { useTheme } from '../../theme';
import { supabase } from '../../services/supabase';
import { exportUserData, fetchMarketplaceCampuses } from '../../services/api';
import type { AccountLifecycleInfo } from '@lantern/shared';
import { MARKETPLACE_COMPLIANCE_BANNER } from '@lantern/shared';
import { AccountLifecycleModals, AccountPausedBannerMobile } from '../../components/AccountLifecycleModals';
import { reactivateUserAccount } from '../../services/accountLifecycle';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { ContactSupportModal } from '../../components/ContactSupportModal';
import { checkAndApplyOtaUpdate, getOtaDiagnostics } from '../../services/otaUpdates';

const ACCENT_PRESETS = ['#6569EE', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'] as const;
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

const FAQ_ITEMS = [
  {
    q: 'How do flashcard reviews work?',
    a: 'Open a deck and tap Review. Rate each card Again, Hard, Good, or Easy — Lantern Study schedules the next review using spaced repetition.',
  },
  {
    q: 'How do group tests and study sessions work?',
    a: 'In a group chat, tap Test or Study to pick question types, tags, and how many questions to include. Shared questions from the group become your session.',
  },
  {
    q: 'What is the difference between JSON and CSV export?',
    a: 'JSON is a full deck backup including images, card types, and SRS progress. CSV is front/back text only for spreadsheets.',
  },
  {
    q: 'How do duel challenges work?',
    a: 'Challenge a group member from the group menu or Challenges inbox. When they accept, both players answer the same questions and results appear when finished.',
  },
  {
    q: 'Can I use Lantern Study offline?',
    a: 'Download decks and bundles from Settings > Offline. Changes sync automatically when you reconnect.',
  },
];

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, signOut, profileName } = useAuthStore();
  const { 
    settings, 
    isLoading, 
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
  const [checkingOta, setCheckingOta] = useState(false);
  const otaDiagnostics = useMemo(() => getOtaDiagnostics(), []);
  const [accountLifecycle, setAccountLifecycle] = useState<AccountLifecycleInfo | null>(null);
  const [reactivatingAccount, setReactivatingAccount] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [campuses, setCampuses] = useState<Array<{ id: string; name: string; city: string }>>([]);
  const [campusesLoading, setCampusesLoading] = useState(false);
  
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
    return match ? `${match.name} (${match.city})` : 'Campus selected';
  }, [campuses, settings.marketplace?.campus_id]);

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

  const handleExportData = useCallback(async () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      const res = await exportUserData(userId);
      const payload = (res as any)?.data ?? res;
      const FileSystem = await import('expo-file-system/legacy');
      const path = `${FileSystem.documentDirectory}lantern-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2));
      Alert.alert('Export saved', `Your data was saved to:\n${path}`);
    } catch {
      Alert.alert('Export failed', 'You may only export once every 24 hours.');
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
    if (user?.id) {
      await syncSettings(user.id);
      Alert.alert('Synced', 'Settings synced successfully!');
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
            if (user?.id) {
              await syncSettings(user.id);
            }
            Alert.alert('Reset', 'Settings have been reset to defaults.');
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
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
          <View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.profileInitials}>
              {user?.user_metadata?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
            </Text>
          </View>
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
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <SettingItem
              colors={colors}
              icon="notifications-outline"
              iconColor="#8b5cf6"
              title="Push Notifications"
              subtitle="Enable all push notifications"
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
              icon="notifications-outline"
              iconColor="#6366f1"
              title="Email Notifications"
              subtitle="Receive email updates"
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
            <SettingItem
              colors={colors}
              icon="mail-outline"
              iconColor="#8b5cf6"
              title="Weekly Digest"
              subtitle="Summary of your study week"
              rightElement={
                <Switch
                  value={settings.notifications.weeklyDigest}
                  onValueChange={(val) => updateSingleSetting('notifications', 'weeklyDigest', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.notifications.weeklyDigest ? colors.switchThumbOn : colors.switchThumbOff}
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
              title="SRS Reminders"
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
              icon="alarm-outline"
              iconColor="#ef4444"
              title="Reminder Time"
              subtitle={formatTime(settings.notifications.reminderTime)}
              onPress={() => setShowTimePicker(true)}
            />
            <SettingItem
              colors={colors}
              icon="flash-outline"
              iconColor="#fbbf24"
              title="SRS Settings"
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
              icon="contract-outline"
              iconColor="#0ea5e9"
              title="Compact Mode"
              subtitle="Tighter spacing across the app"
              rightElement={
                <Switch
                  value={settings.appearance.compactMode}
                  onValueChange={(val) => updateSingleSetting('appearance', 'compactMode', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.appearance.compactMode ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
            <SettingItem
              colors={colors}
              icon="sparkles-outline"
              iconColor="#fbbf24"
              title="Show Animations"
              subtitle="Enable UI animations"
              rightElement={
                <Switch
                  value={settings.appearance.showAnimations}
                  onValueChange={(val) => updateSingleSetting('appearance', 'showAnimations', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={settings.appearance.showAnimations ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
            />
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

        {/* Marketplace Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Marketplace</Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.card }]}>
            <View style={[styles.complianceBanner, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              <Text style={[styles.complianceText, { color: colors.textSecondary }]}>
                {MARKETPLACE_COMPLIANCE_BANNER}
              </Text>
            </View>
            <SettingItem
              colors={colors}
              icon="flag-outline"
              iconColor="#10b981"
              title="Country"
              subtitle="Nigeria"
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
              subtitle={settings.privacy.profileVisibility === 'public' ? 'Visible to everyone' : 
                       settings.privacy.profileVisibility === 'groups' ? 'Visible to group members' : 'Private'}
              onPress={() => setShowPrivacyModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="chatbubble-ellipses-outline"
              iconColor="#8b5cf6"
              title="Direct Messages"
              subtitle={
                settings.privacy.allowDirectMessages === 'everyone'
                  ? 'Anyone can message you'
                  : settings.privacy.allowDirectMessages === 'groups'
                    ? 'Group members only'
                    : 'No direct messages'
              }
              onPress={() => setShowDirectMessagesModal(true)}
            />
            <SettingItem
              colors={colors}
              icon="search-outline"
              iconColor="#6366f1"
              title="Discoverable for Invites"
              subtitle="Let others find you by name or @username when adding group or deck members"
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
            <SettingItem
              colors={colors}
              icon="accessibility-outline"
              iconColor="#6366f1"
              title="Screen Reader Optimized"
              subtitle="Stronger focus and readable layout"
              rightElement={
                <Switch
                  value={settings.accessibility.screenReaderOptimized}
                  onValueChange={(val) => updateSingleSetting('accessibility', 'screenReaderOptimized', val)}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={
                    settings.accessibility.screenReaderOptimized
                      ? colors.switchThumbOn
                      : colors.switchThumbOff
                  }
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
              icon="cookie-outline"
              iconColor="#8b5cf6"
              title="Cookie Notice"
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
          Lantern Study v{otaDiagnostics.runtimeVersion || '1.0.2'}
        </Text>

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showHelpModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, modalTheme.content, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Help & FAQ</Text>
              <TouchableOpacity onPress={() => setShowHelpModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {FAQ_ITEMS.map(item => (
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
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, modalTheme.content, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>Your campus</Text>
              <TouchableOpacity onPress={() => setShowCampusModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
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
                  });
                  setShowCampusModal(false);
                }}
              >
                <Text style={[styles.optionTitle, modalTheme.optionTitle]}>All campuses</Text>
                <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                  No default campus filter
                </Text>
              </TouchableOpacity>
              {campuses.map((campus) => {
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
                      void updateSettings('marketplace', {
                        country_code: settings.marketplace?.country_code || 'NG',
                        campus_id: campus.id,
                      });
                      setShowCampusModal(false);
                    }}
                  >
                    <Text style={[styles.optionTitle, modalTheme.optionTitle]}>{campus.name}</Text>
                    <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                      {campus.city}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
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

      {/* Daily Goal Modal */}
      <Modal
        visible={showDailyGoalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDailyGoalModal(false)}
      >
        <View style={[styles.modalOverlay, modalTheme.overlay]}>
          <View style={[styles.modalContent, modalTheme.content]}>
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
          <View style={[styles.modalContent, modalTheme.content]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, modalTheme.title]}>SRS Settings</Text>
              <TouchableOpacity onPress={() => setShowSRSSettingsModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.goalSection}>
              <Text style={[styles.goalLabel, modalTheme.label]}>New Cards Per Day</Text>
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
              <Text style={[styles.goalLabel, modalTheme.label]}>Max Interval (Days)</Text>
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
          <View style={[styles.modalContent, modalTheme.content]}>
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
                    {option === 'public' ? 'Anyone can see your profile' : 
                     option === 'groups' ? 'Only members of your groups can see' : 
                     'Only you can see your profile'}
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
          <View style={[styles.modalContent, modalTheme.content]}>
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
                    {option === 'everyone' ? 'Everyone' : option === 'groups' ? 'Group Members Only' : 'No One'}
                  </Text>
                  <Text style={[styles.optionDescription, modalTheme.optionDescription]}>
                    {option === 'everyone'
                      ? 'Any signed-in user can message you'
                      : option === 'groups'
                        ? 'Only people in your shared groups'
                        : 'Block all new direct messages'}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
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
    backgroundColor: '#1e293b',
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
  sectionContent: {
    backgroundColor: '#1e293b',
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
    width: 32,
    height: 32,
    borderRadius: 16,
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

