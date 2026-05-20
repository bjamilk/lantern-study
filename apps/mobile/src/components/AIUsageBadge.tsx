/**
 * AI Usage Badge Component
 * Shows remaining AI uses (e.g., "7/10 AI uses left")
 * Subscribes to real-time usage updates.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeToAIUsage,
  fetchAIUsage,
  getLatestAIUsage,
  type AIUsageInfo,
} from '../services/ai';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../theme';

interface AIUsageBadgeProps {
  /** Compact inline variant (just text) vs full card */
  variant?: 'badge' | 'inline' | 'card';
  /** Show even when usage data hasn't loaded yet */
  showLoading?: boolean;
}

export default function AIUsageBadge({ variant = 'badge', showLoading = false }: AIUsageBadgeProps) {
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());

  useEffect(() => {
    // Subscribe to usage updates
    const unsub = subscribeToAIUsage(setUsage);

    // Fetch fresh usage on mount
    if (user?.id) {
      fetchAIUsage(user.id);
    }

    return unsub;
  }, [user?.id]);

  const ratio = usage.limit > 0 ? usage.remaining / usage.limit : 1;
  const isLow = usage.remaining <= 2;
  const isExhausted = usage.remaining <= 0;

  const statusColor = isExhausted
    ? colors.error
    : isLow
    ? colors.warning
    : colors.success;

  // Inline variant — just text
  if (variant === 'inline') {
    return (
      <Text style={[styles.inlineText, { color: statusColor }]}>
        {usage.remaining}/{usage.limit} AI uses left
      </Text>
    );
  }

  // Card variant — full info card
  if (variant === 'card') {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="sparkles" size={20} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>AI Usage</Text>
        </View>

        <View style={styles.progressBarContainer}>
          <View
            style={[
              styles.progressBar,
              { backgroundColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: statusColor,
                  width: `${ratio * 100}%`,
                },
              ]}
            />
          </View>
        </View>

        <Text style={[styles.cardUsageText, { color: colors.textSecondary }]}>
          {usage.remaining} of {usage.limit} uses remaining today
        </Text>

        {isExhausted && (
          <Text style={[styles.cardResetText, { color: colors.error }]}>
            Resets at midnight
          </Text>
        )}
      </View>
    );
  }

  // Default badge variant
  return (
    <View style={[styles.badge, { backgroundColor: `${statusColor}20`, borderColor: statusColor }]}>
      <Ionicons name="sparkles" size={12} color={statusColor} />
      <Text style={[styles.badgeText, { color: statusColor }]}>
        {usage.remaining}/{usage.limit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Badge variant
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Inline variant
  inlineText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Card variant
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
});
