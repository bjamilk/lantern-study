// ===========================================
// Lantern Study Mobile - Notification Modal
// In-app notification history display
// ===========================================

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types
interface AppNotification {
  id: string;
  message: string;
  date: string;
  read: boolean;
  type?: 'info' | 'success' | 'warning' | 'error' | 'group_invite' | 'badge' | 'message';
  link?: string;
}

interface NotificationModalProps {
  visible: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
  onNotificationPress?: (notification: AppNotification) => void;
}

// Format relative time
const formatRelativeTime = (dateString: string): string => {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) return `${Math.floor(interval)}y ago`;
  interval = seconds / 2592000;
  if (interval > 1) return `${Math.floor(interval)}mo ago`;
  interval = seconds / 86400;
  if (interval > 1) return `${Math.floor(interval)}d ago`;
  interval = seconds / 3600;
  if (interval > 1) return `${Math.floor(interval)}h ago`;
  interval = seconds / 60;
  if (interval > 1) return `${Math.floor(interval)}m ago`;
  return 'Just now';
};

// Get icon for notification type
const getNotificationIcon = (type?: string): { name: string; color: string } => {
  switch (type) {
    case 'success':
      return { name: 'checkmark-circle', color: '#10b981' };
    case 'warning':
      return { name: 'warning', color: '#f59e0b' };
    case 'error':
      return { name: 'alert-circle', color: '#ef4444' };
    case 'group_invite':
      return { name: 'people', color: '#6366f1' };
    case 'badge':
      return { name: 'ribbon', color: '#f59e0b' };
    case 'message':
      return { name: 'chatbubble', color: '#3b82f6' };
    case 'challenge_invite':
    case 'challenge_accepted':
    case 'challenge_declined':
    case 'challenge_result':
    case 'challenge_opponent_finished':
      return { name: 'flash', color: '#ef4444' };
    default:
      return { name: 'notifications', color: '#6366f1' };
  }
};

export default function NotificationModal({
  visible,
  onClose,
  notifications,
  onMarkAllAsRead,
  onClearAll,
  onNotificationPress,
}: NotificationModalProps) {
  const { colors } = useTheme();

  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const unreadCount = notifications.filter(n => !n.read).length;

  const renderNotification = useCallback(
    ({ item }: { item: AppNotification }) => {
      const icon = getNotificationIcon(item.type);
      return (
        <TouchableOpacity
          style={[
            styles.notificationItem,
            {
              backgroundColor: item.read ? colors.card : colors.primary + '10',
              borderBottomColor: colors.border,
            },
          ]}
          onPress={() => onNotificationPress?.(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconContainer, { backgroundColor: icon.color + '20' }]}>
            <Ionicons name={icon.name as any} size={20} color={icon.color} />
          </View>
          <View style={styles.notificationContent}>
            <Text
              style={[
                styles.notificationMessage,
                { color: colors.text, fontWeight: item.read ? 'normal' : '600' },
              ]}
              numberOfLines={3}
            >
              {item.message}
            </Text>
            <Text style={[styles.notificationTime, { color: colors.textTertiary }]}>
              {formatRelativeTime(item.date)}
            </Text>
          </View>
          {!item.read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      );
    },
    [colors, onNotificationPress]
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="notifications-off-outline" size={64} color={colors.textTertiary} />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        No notifications yet
      </Text>
      <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
        When you receive notifications, they'll appear here
      </Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <Ionicons name="notifications" size={24} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Actions */}
        {notifications.length > 0 && (
          <View style={[styles.actionsRow, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onMarkAllAsRead} style={styles.actionButton}>
              <Ionicons name="mail-open-outline" size={16} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Mark all read</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClearAll} style={styles.actionButton}>
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
              <Text style={[styles.actionText, { color: '#ef4444' }]}>Clear all</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Notifications List */}
        <FlatList
          data={sortedNotifications}
          renderItem={renderNotification}
          keyExtractor={item => item.id}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={notifications.length === 0 ? styles.emptyListContent : undefined}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginLeft: 10,
  },
  unreadBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  notificationTime: {
    fontSize: 12,
    marginTop: 4,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#6366f1',
    marginLeft: 8,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
