/**
 * AI Usage Badge Component
 * Shows remaining AI uses (e.g., "7/10") with optional tap-to-detail modal.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { getAIResetLabel, formatAIResetTime } from '@lantern/shared/utils';
import { formatCreditCost } from '@lantern/shared/utils/aiCredits';
import {
  subscribeToAIUsage,
  fetchAIUsage,
  getLatestAIUsage,
  type AIUsageInfo,
} from '../services/ai';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../theme';
import { AppIcon } from './ui/AppIcon';

interface AIUsageBadgeProps {
  /**
   * `docked` is the top bar's variant: a bare count pill sized to ride on the
   * Lantern AI sparkle, the way an unread count rides on a bell. It replaced
   * the floating draggable credit pill, which was anchored to nothing, had to
   * be dragged out of the way per screen, and was a second door to the same
   * information the sparkle already carries.
   */
  variant?: 'badge' | 'inline' | 'card' | 'docked';
  showLoading?: boolean;
  /** When true, tapping the badge opens a detail modal with reset timing */
  interactive?: boolean;
  /** Credits the adjacent action costs; shown inline, and remaining < cost renders as exhausted. */
  cost?: number;
}

/**
 * The live AI-credit figures.
 *
 * Exported so a host that draws its own control — the top bar's sparkle —
 * can put the count into its own accessibility label instead of leaving a
 * screen reader to stumble over a decorative pill.
 */
export function useAIUsage(): AIUsageInfo {
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());
  useEffect(() => subscribeToAIUsage(setUsage), []);
  return usage;
}

function useAIUsageTick(hasQuota: boolean, detailOpen: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasQuota) return;
    const intervalMs = detailOpen ? 1_000 : 60_000;
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [hasQuota, detailOpen]);

  return nowMs;
}

export default function AIUsageBadge({
  variant = 'badge',
  showLoading = false,
  interactive = false,
  cost,
}: AIUsageBadgeProps) {
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const usage = useAIUsage();
  const [detailOpen, setDetailOpen] = useState(false);
  const nowMs = useAIUsageTick(usage.limit > 0, detailOpen);

  const closeDetail = useCallback(() => setDetailOpen(false), []);

  const openDetail = useCallback(() => {
    if (user?.id) {
      void fetchAIUsage(user.id);
    }
    setDetailOpen(true);
  }, [user?.id]);

  if (!usage.limit && !showLoading) return null;

  const ratio = usage.limit > 0 ? usage.remaining / usage.limit : 1;
  const shortOfCredits = cost != null && usage.remaining < cost;
  const isLow = usage.remaining <= 2;
  const isExhausted = usage.remaining <= 0 || shortOfCredits;

  const statusColor = isExhausted
    ? colors.error
    : isLow
    ? colors.warning
    : colors.success;

  const resetLabel = getAIResetLabel(usage.resetsAt, {
    used: usage.used,
    limit: usage.limit,
    nowMs,
  });
  const resetTime = formatAIResetTime(usage.resetsAt);

  const detailModal = (
    <Modal
      visible={detailOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeDetail}
    >
      <Pressable style={styles.modalBackdrop} onPress={closeDetail}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.modalHeader}>
            <View style={styles.cardHeader}>
              <AppIcon name="sparkles" size={20} color={colors.primaryText} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>AI uses</Text>
            </View>
            <TouchableOpacity onPress={closeDetail} hitSlop={12} accessibilityLabel="Close">
              <AppIcon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalCountBlock}>
            <Text style={[styles.modalCountLarge, { color: colors.text }]}>
              {usage.remaining} / {usage.limit}
            </Text>
            <Text style={[styles.modalCountSubtitle, { color: colors.textSecondary }]}>
              AI uses left today
            </Text>
          </View>

          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: statusColor, width: `${ratio * 100}%` },
                ]}
              />
            </View>
          </View>

          <View style={styles.modalResetBlock}>
            <Text style={[styles.modalResetCountdown, { color: colors.text }]}>
              {resetLabel}
            </Text>
            {resetTime ? (
              <Text style={[styles.modalResetAbsolute, { color: colors.textSecondary }]}>
                Resets {resetTime}
              </Text>
            ) : null}
          </View>

          {isExhausted ? (
            <Text style={[styles.exhaustedText, { color: colors.error }]}>
              Daily limit reached
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (variant === 'docked') {
    // Hidden from assistive tech on purpose: the control this rides on (the
    // top bar's Lantern AI button) speaks the count itself, via useAIUsage,
    // so exposing the pill as well would announce the number twice.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.docked, { backgroundColor: statusColor }]}
      >
        <Text style={styles.dockedText} numberOfLines={1}>
          {usage.remaining > 99 ? '99+' : usage.remaining}
        </Text>
      </View>
    );
  }

  if (variant === 'inline') {
    return (
      <Text style={[styles.inlineText, { color: statusColor }]}>
        {usage.remaining}/{usage.limit} AI uses left
        {/* The price goes through formatCreditCost like every other button's
            does — a local pluralisation here is how "credit" and "AI use"
            became two names for one unit. */}
        {cost != null
          ? ` · costs ${formatCreditCost(cost)}${shortOfCredits ? ' — not enough' : ''}`
          : ''}{' '}
        · {resetLabel}
      </Text>
    );
  }

  if (variant === 'card') {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <AppIcon name="sparkles" size={20} color={colors.primaryText} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>AI uses</Text>
        </View>

        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: statusColor, width: `${ratio * 100}%` },
              ]}
            />
          </View>
        </View>

        <Text style={[styles.cardUsageText, { color: colors.textSecondary }]}>
          {usage.remaining} of {usage.limit} AI uses left today
        </Text>

        <Text style={[styles.cardResetText, { color: colors.textSecondary }]}>
          {resetLabel}
        </Text>

        {isExhausted ? (
          <Text style={[styles.exhaustedText, { color: colors.error }]}>
            Daily limit reached
          </Text>
        ) : null}
      </View>
    );
  }

  const badge = (
    <View
      style={[
        styles.badge,
        interactive && styles.badgeInteractive,
        { backgroundColor: `${statusColor}20`, borderColor: statusColor },
      ]}
    >
      <AppIcon name="sparkles" size={12} color={statusColor} />
      <Text style={[styles.badgeText, { color: statusColor }]}>
        {usage.remaining}/{usage.limit}
      </Text>
    </View>
  );

  if (!interactive) {
    return badge;
  }

  return (
    <>
      <Pressable
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={`AI requests, ${usage.remaining} of ${usage.limit} remaining, ${resetLabel}`}
        hitSlop={4}
      >
        {badge}
      </Pressable>
      {detailModal}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeInteractive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Same geometry as ui/Badge, so the credit count on the sparkle and the
  // unread count on the bell sit at identical offsets in the same row.
  docked: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  inlineText: {
    fontSize: 12,
    fontWeight: '500',
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  progressBarContainer: {
    marginTop: 4,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  cardUsageText: {
    fontSize: 13,
  },
  cardResetText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  exhaustedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCountBlock: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  modalCountLarge: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  modalCountSubtitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  modalResetBlock: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 4,
  },
  modalResetCountdown: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalResetAbsolute: {
    fontSize: 12,
    textAlign: 'center',
  },
});
