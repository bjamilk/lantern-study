/**
 * Sync Status Indicator
 * Shows sync status and pending changes in the UI
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getConnectionStatus, featureAccents } from '@lantern/shared/design';
import { useSyncStatus, useNetworkStatus, usePendingWork } from '../hooks';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { retryAuthRefresh } from '../services/api';
import { useTheme } from '../theme';
import { AppIcon, type AppIconName } from './ui/AppIcon';

/**
 * Copy for the auth-offline state. NetInfo says the radio is up; this says we
 * still could not reach the auth server. The second half is the part that
 * matters to a student who has just lost a session before: nothing was lost.
 */
const AUTH_OFFLINE_LABEL = 'Offline — your session is saved';
const AUTH_OFFLINE_SHORT = 'Session saved';

interface SyncStatusIndicatorProps {
  compact?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
}

/**
 * Shared wiring for the auth-offline state.
 *
 * `authOffline` is set by services/api.ts when a refresh could not reach the
 * auth server, and cleared by the next successful refresh or request. The
 * effect here is the automatic half of the recovery: the moment NetInfo says
 * the link is back, drop the exponential backoff and try once, so a student
 * who walks out of a dead spot does not have to wait out a 60 s window or find
 * the button. It fires once per reconnection — a failed retry leaves
 * `authOffline` true and the deps unchanged, so it cannot loop.
 */
function useAuthOffline(isConnected: boolean) {
  // Primitive selectors only: an object built in a selector is a fresh object
  // every render and froze production once.
  const authOffline = useUIStore((s) => s.authOffline);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await retryAuthRefresh();
    } catch {
      // retryAuthRefresh already classified the failure; the banner stays.
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    if (!authOffline || !isConnected) return;
    const timer = setTimeout(() => {
      void retry();
    }, 1500);
    return () => clearTimeout(timer);
  }, [authOffline, isConnected, retry]);

  return { authOffline, retrying, retry };
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
): AppIconName {
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
  // The whole queue, not just the SyncQueue: offline test results and queued
  // question-bank scores are work waiting to upload too, and counting only one
  // of the three told students "synced" while their work sat unsent.
  const pending = usePendingWork();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const { authOffline, retrying, retry } = useAuthOffline(network.isConnected);
  const { colors } = useTheme();

  const status = useMemo(
    () =>
      getConnectionStatus({
        // A refresh that cannot reach the auth server is an outage the radio
        // cannot see: a captive portal or a DNS failure leaves NetInfo saying
        // "connected" while nothing gets through.
        isOnline: network.isConnected && !authOffline,
        lowDataMode,
        pendingSyncCount: pending.total,
        isSyncing: sync.isSyncing,
      }),
    [network.isConnected, authOffline, lowDataMode, pending.total, sync.isSyncing]
  );

  const color = statusColor(status.state);
  const hasPending = pending.total > 0;
  // Only speak for auth while the radio itself is fine; a genuinely offline
  // phone should keep saying "Offline".
  const showAuthOffline = authOffline && network.isConnected;
  const label = showAuthOffline ? AUTH_OFFLINE_SHORT : status.shortLabel;
  // Screen readers get the breakdown, not a bare number: "Offline · 1" alone
  // never says what the 1 is.
  const a11yLabel = showAuthOffline
    ? AUTH_OFFLINE_LABEL
    : hasPending
      ? `${status.label}. ${pending.label}`
      : status.label;

  // The compact chip is a floating overlay on every screen. When everything is
  // online and synced it states the default and only covers content, so it
  // renders nothing — same rule SyncDot already follows.
  if (compact && status.state === 'online' && !hasPending && !sync.isSyncing) {
    return null;
  }

  const content = (
    <View
      accessible
      accessibilityLabel={a11yLabel}
      style={[styles.container, compact && styles.containerCompact, { backgroundColor: `${color}15` }]}
    >
      {sync.isSyncing || retrying ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <AppIcon
          name={showAuthOffline ? 'cloud-offline' : statusIcon(status.icon, sync.isSyncing)}
          size={compact ? 16 : 20}
          color={color}
        />
      )}
      {showLabel && !compact && (
        <Text style={[styles.label, { color: compact ? colors.textSecondary : color }]}>
          {label}
        </Text>
      )}
      {hasPending && !sync.isSyncing && !compact && (
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{pending.total}</Text>
        </View>
      )}
      {showAuthOffline && !compact && (
        <TouchableOpacity
          onPress={() => void retry()}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel="Retry now"
          accessibilityState={{ disabled: retrying }}
          style={styles.inlineRetry}
        >
          <Text style={[styles.inlineRetryText, { color }]}>Retry now</Text>
        </TouchableOpacity>
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
  const pending = usePendingWork();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const authOffline = useUIStore((s) => s.authOffline);

  const status = getConnectionStatus({
    isOnline: network.isConnected && !authOffline,
    lowDataMode,
    pendingSyncCount: pending.total,
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
  const pending = usePendingWork();
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const { authOffline, retrying, retry } = useAuthOffline(network.isConnected);

  const status = getConnectionStatus({
    isOnline: network.isConnected && !authOffline,
    lowDataMode,
    pendingSyncCount: pending.total,
    isSyncing: sync.isSyncing,
  });

  if (status.state === 'online') {
    return null;
  }

  const isOffline = status.state === 'offline';
  const showAuthOffline = authOffline && network.isConnected;
  const bannerColor = featureAccents.offline;

  const message = showAuthOffline
    ? AUTH_OFFLINE_LABEL
    : isOffline
      ? 'You are offline. Study progress will sync when you reconnect.'
      // Name the work, don't just count it.
      : pending.label;

  return (
    <View style={[styles.banner, { backgroundColor: bannerColor }]}>
      <View style={styles.bannerContent}>
        <AppIcon
          name={isOffline ? 'cloud-offline' : 'cloud-upload'}
          size={18}
          color="#fff"
        />
        <Text style={styles.bannerText}>{message}</Text>
      </View>
      {showAuthOffline ? (
        <TouchableOpacity
          onPress={() => void retry()}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel="Retry now"
          accessibilityState={{ disabled: retrying }}
          style={[styles.bannerButton, retrying && styles.bannerButtonDisabled]}
        >
          <Text style={styles.bannerButtonText}>{retrying ? 'Retrying…' : 'Retry now'}</Text>
        </TouchableOpacity>
      ) : (
        !isOffline &&
        pending.total > 0 &&
        onSyncPress && (
          <TouchableOpacity
            onPress={onSyncPress}
            accessibilityRole="button"
            accessibilityLabel="Sync now"
            style={styles.bannerButton}
          >
            <Text style={styles.bannerButtonText}>Sync Now</Text>
          </TouchableOpacity>
        )
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
  bannerButtonDisabled: {
    opacity: 0.6,
  },
  inlineRetry: {
    marginLeft: 8,
    // px literal, not a Tailwind h-*: NativeWind inlines rem at 14 here, so
    // h-11 would be 38.5px and miss the 44px touch target.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  inlineRetryText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});

export default SyncStatusIndicator;
