/**
 * Sync Status Indicator
 * Shows sync status and pending changes in the UI
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConnectionStatus, featureAccents } from '@lantern/shared/design';
import { useSyncStatus, useNetworkStatus } from '../hooks';
import { useSettingsStore } from '../stores/settingsStore';
import { useTheme } from '../theme';

interface SyncStatusIndicatorProps {
  compact?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
}

function statusColor(state: string): string {
  switch (state) {
    case 'offline':
      return featureAccents.offline;
    case 'syncing':
    case 'lowData':
      return featureAccents.offline;
    case 'stale':
      return '#94a3b8';
    default:
      return '#22c55e';
  }
}

function statusIcon(
  icon: 'wifi' | 'wifi-off' | 'sync' | 'signal' | 'clock',
  isSyncing: boolean
): keyof typeof Ionicons.glyphMap {
  if (isSyncing) return 'sync';
  switch (icon) {
    case 'wifi-off':
      return 'cloud-offline';
    case 'sync':
      return 'cloud-upload';
    case 'signal':
      return 'cellular';
    case 'clock':
      return 'time';
    default:
      return 'cloud-done';
  }
}

export function SyncStatusIndicator({
  compact = false,
  showLabel = true,
  onPress,
}: SyncStatusIndicatorProps) {
  const network = useNetworkStatus();
  const sync = useSyncStatus();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const { colors } = useTheme();

  const status = useMemo(
    () =>
      getConnectionStatus({
        isOnline: network.isConnected,
        lowDataMode,
        pendingSyncCount: sync.pendingCount,
        isSyncing: sync.isSyncing,
      }),
    [network.isConnected, lowDataMode, sync.pendingCount, sync.isSyncing]
  );

  const color = statusColor(status.state);
  const hasPending = sync.pendingCount > 0;

  const content = (
    <View style={[styles.container, compact && styles.containerCompact, { backgroundColor: `${color}15` }]}>
      {sync.isSyncing ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons
          name={statusIcon(status.icon, sync.isSyncing)}
          size={compact ? 16 : 20}
          color={color}
        />
      )}
      {showLabel && !compact && (
        <Text style={[styles.label, { color: compact ? colors.textSecondary : color }]}>
          {status.shortLabel}
        </Text>
      )}
      {hasPending && !sync.isSyncing && !compact && (
        <View style={[styles.badge, { backgroundColor: color }]}>
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

export function SyncDot() {
  const network = useNetworkStatus();
  const sync = useSyncStatus();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);

  const status = getConnectionStatus({
    isOnline: network.isConnected,
    lowDataMode,
    pendingSyncCount: sync.pendingCount,
    isSyncing: sync.isSyncing,
  });

  if (status.state === 'online') {
    return null;
  }

  const color = statusColor(status.state);

  return (
    <View style={[styles.dot, { backgroundColor: color }]}>
      {sync.isSyncing && <ActivityIndicator size={8} color="#fff" />}
    </View>
  );
}

export function SyncBanner({
  onSyncPress,
}: {
  onSyncPress?: () => void;
}) {
  const network = useNetworkStatus();
  const sync = useSyncStatus();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);

  const status = getConnectionStatus({
    isOnline: network.isConnected,
    lowDataMode,
    pendingSyncCount: sync.pendingCount,
    isSyncing: sync.isSyncing,
  });

  if (status.state === 'online') {
    return null;
  }

  const isOffline = status.state === 'offline';
  const bannerColor = isOffline ? featureAccents.offline : featureAccents.offline;

  return (
    <View style={[styles.banner, { backgroundColor: bannerColor }]}>
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
      {!isOffline && sync.pendingCount > 0 && onSyncPress && (
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
