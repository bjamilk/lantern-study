/**
 * Sync Status Indicator
 * Shows sync status and pending changes in the UI
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStatus, useNetworkStatus } from '../hooks';
import { useTheme } from '../theme';

interface SyncStatusIndicatorProps {
  compact?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
}

export function SyncStatusIndicator({
  compact = false,
  showLabel = true,
  onPress,
}: SyncStatusIndicatorProps) {
  const network = useNetworkStatus();
  const sync = useSyncStatus();
  const { colors } = useTheme();

  // Determine status
  const isOffline = !network.isConnected;
  const hasPending = sync.pendingCount > 0;
  const isSyncing = sync.isSyncing;

  // Status color
  const getStatusColor = () => {
    if (isOffline) return '#ef4444'; // red
    if (isSyncing) return '#f59e0b'; // amber
    if (hasPending) return '#f59e0b'; // amber
    return '#22c55e'; // green
  };

  // Status icon
  const getStatusIcon = () => {
    if (isOffline) return 'cloud-offline';
    if (isSyncing) return 'sync';
    if (hasPending) return 'cloud-upload';
    return 'cloud-done';
  };

  // Status text
  const getStatusText = () => {
    if (isOffline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (hasPending) return `${sync.pendingCount} pending`;
    return 'Synced';
  };

  const content = (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {isSyncing ? (
        <ActivityIndicator size="small" color={getStatusColor()} />
      ) : (
        <Ionicons
          name={getStatusIcon() as any}
          size={compact ? 16 : 20}
          color={getStatusColor()}
        />
      )}
      {showLabel && !compact && (
        <Text style={[styles.label, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>
      )}
      {hasPending && !isSyncing && !compact && (
        <View style={[styles.badge, { backgroundColor: getStatusColor() }]}>
          <Text style={styles.badgeText}>{sync.pendingCount}</Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

// Mini indicator for header/tab bar
export function SyncDot() {
  const network = useNetworkStatus();
  const sync = useSyncStatus();

  const isOffline = !network.isConnected;
  const hasPending = sync.pendingCount > 0;
  const isSyncing = sync.isSyncing;

  if (!isOffline && !hasPending && !isSyncing) {
    return null;
  }

  const getColor = () => {
    if (isOffline) return '#ef4444';
    if (isSyncing) return '#f59e0b';
    return '#f59e0b';
  };

  return (
    <View style={[styles.dot, { backgroundColor: getColor() }]}>
      {isSyncing && (
        <ActivityIndicator size={8} color="#fff" />
      )}
    </View>
  );
}

// Full sync status banner
export function SyncBanner({
  onSyncPress,
}: {
  onSyncPress?: () => void;
}) {
  const network = useNetworkStatus();
  const sync = useSyncStatus();

  const isOffline = !network.isConnected;
  const hasPending = sync.pendingCount > 0;

  if (!isOffline && !hasPending) {
    return null;
  }

  return (
    <View style={[
      styles.banner,
      isOffline ? styles.bannerOffline : styles.bannerPending
    ]}>
      <View style={styles.bannerContent}>
        <Ionicons
          name={isOffline ? 'cloud-offline' : 'cloud-upload'}
          size={18}
          color="#fff"
        />
        <Text style={styles.bannerText}>
          {isOffline
            ? 'You are offline. Changes will sync when connected.'
            : `${sync.pendingCount} changes waiting to sync`}
        </Text>
      </View>
      {!isOffline && hasPending && onSyncPress && (
        <TouchableOpacity onPress={onSyncPress} style={styles.bannerButton}>
          <Text style={styles.bannerButtonText}>Sync Now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  containerCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  label: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '500',
  },
  badge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    top: -2,
    right: -2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerOffline: {
    backgroundColor: '#ef4444',
  },
  bannerPending: {
    backgroundColor: '#f59e0b',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  bannerText: {
    marginLeft: 8,
    color: '#fff',
    fontSize: 13,
    flex: 1,
  },
  bannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    marginLeft: 8,
  },
  bannerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default SyncStatusIndicator;
