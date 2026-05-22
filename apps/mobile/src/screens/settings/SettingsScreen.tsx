// ===========================================
// Lantern Study Mobile - Settings Screen
// Synced with backend (shared with web app)
// ===========================================

import React, { useState, useCallback, useEffect } from 'react';
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

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, signOut } = useAuthStore();
  const { 
    settings, 
    isLoading, 
    isSyncing,
    hasUnsyncedChanges,
    loadSettings, 
    updateSingleSetting,
    syncSettings,
    resetToDefaults,
  } = useSettingsStore();
  
  // Theme
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  
  // Modal states
  const [showDailyGoalModal, setShowDailyGoalModal] = useState(false);
  const [showReminderTimeModal, setShowReminderTimeModal] = useState(false);
  const [showSRSSettingsModal, setShowSRSSettingsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showAccessibilityModal, setShowAccessibilityModal] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  
  // Temp values for modals
  const [tempDailyCardGoal, setTempDailyCardGoal] = useState(settings.study.dailyCardGoal);
  const [tempDailyTestGoal, setTempDailyTestGoal] = useState(settings.study.dailyTestGoal);
  
  // Load settings on mount
  useEffect(() => {
    if (user?.id) {
      loadSettings(user.id);
    }
  }, [user?.id]);

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
            <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
            <SyncIndicator />
          </View>
          {settings.sync.lastSyncTime && (
            <Text style={[styles.lastSyncText, { color: colors.textTertiary }]}>
              Last synced: {new Date(settings.sync.lastSyncTime).toLocaleString()}
            </Text>
          )}
        </View>

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
            onPress={() => navigation.navigate('EditProfile')}
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
            <SettingItem
              colors={colors}
              icon={isDark ? "moon" : "sunny"}
              iconColor="#f59e0b"
              title="Theme"
              subtitle={themeMode === 'system' ? 'System default' : themeMode === 'dark' ? 'Dark mode' : 'Light mode'}
              rightElement={
                <Switch
                  value={isDark}
                  onValueChange={(value) => {
                    const newTheme = value ? 'dark' : 'light';
                    setThemeMode(newTheme);
                    updateSingleSetting('appearance', 'theme', newTheme);
                  }}
                  trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
                  thumbColor={isDark ? colors.switchThumbOn : colors.switchThumbOff}
                />
              }
              showChevron={false}
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
              onPress={() => Alert.alert('Coming Soon', 'Help center will be available soon!')}
            />
            <SettingItem
              colors={colors}
              icon="chatbubble-outline"
              iconColor="#10b981"
              title="Contact Support"
              onPress={() => Alert.alert('Coming Soon', 'Contact support will be available soon!')}
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

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Version Info */}
        <Text style={[styles.versionText, { color: colors.textTertiary }]}>Lantern Study v1.0.0</Text>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Daily Goal Modal */}
      <Modal
        visible={showDailyGoalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDailyGoalModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Daily Goal</Text>
              <TouchableOpacity onPress={() => setShowDailyGoalModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.goalSection}>
              <Text style={styles.goalLabel}>Daily Card Goal</Text>
              <Text style={styles.goalValue}>{tempDailyCardGoal} cards</Text>
              <Slider
                style={styles.slider}
                minimumValue={5}
                maximumValue={100}
                step={5}
                value={tempDailyCardGoal}
                onValueChange={setTempDailyCardGoal}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#334155"
                thumbTintColor="#6366f1"
              />
            </View>

            <View style={styles.goalSection}>
              <Text style={styles.goalLabel}>Daily Test Goal</Text>
              <Text style={styles.goalValue}>{tempDailyTestGoal} test(s)</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={10}
                step={1}
                value={tempDailyTestGoal}
                onValueChange={setTempDailyTestGoal}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#334155"
                thumbTintColor="#6366f1"
              />
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={saveDailyGoals}>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SRS Settings</Text>
              <TouchableOpacity onPress={() => setShowSRSSettingsModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.goalSection}>
              <Text style={styles.goalLabel}>New Cards Per Day</Text>
              <Text style={styles.goalValue}>{settings.study.srsNewCardsPerDay} cards</Text>
              <Slider
                style={styles.slider}
                minimumValue={5}
                maximumValue={50}
                step={5}
                value={settings.study.srsNewCardsPerDay}
                onValueChange={(val) => updateSingleSetting('study', 'srsNewCardsPerDay', val)}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#334155"
                thumbTintColor="#6366f1"
              />
            </View>

            <View style={styles.goalSection}>
              <Text style={styles.goalLabel}>Max Interval (Days)</Text>
              <Text style={styles.goalValue}>{settings.study.srsMaxInterval} days</Text>
              <Slider
                style={styles.slider}
                minimumValue={30}
                maximumValue={365}
                step={30}
                value={settings.study.srsMaxInterval}
                onValueChange={(val) => updateSingleSetting('study', 'srsMaxInterval', val)}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#334155"
                thumbTintColor="#6366f1"
              />
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={() => setShowSRSSettingsModal(false)}>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Profile Visibility</Text>
              <TouchableOpacity onPress={() => setShowPrivacyModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            
            {(['public', 'groups', 'private'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.optionItem,
                  settings.privacy.profileVisibility === option && styles.optionItemActive
                ]}
                onPress={() => {
                  updateSingleSetting('privacy', 'profileVisibility', option);
                  setShowPrivacyModal(false);
                }}
              >
                <View>
                  <Text style={styles.optionTitle}>
                    {option === 'public' ? 'Public' : option === 'groups' ? 'Group Members Only' : 'Private'}
                  </Text>
                  <Text style={styles.optionDescription}>
                    {option === 'public' ? 'Anyone can see your profile' : 
                     option === 'groups' ? 'Only members of your groups can see' : 
                     'Only you can see your profile'}
                  </Text>
                </View>
                {settings.privacy.profileVisibility === option && (
                  <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1e293b',
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
    color: '#ffffff',
  },
  goalSection: {
    marginBottom: 24,
  },
  goalLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
    marginBottom: 8,
  },
  goalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6366f1',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  saveButton: {
    backgroundColor: '#6366f1',
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
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionItemActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
    color: '#9ca3af',
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
});

