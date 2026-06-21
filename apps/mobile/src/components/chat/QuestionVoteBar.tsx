import React, { useMemo } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface QuestionVoteBarProps {
  upvotes: number;
  downvotes: number;
  userVote?: 'up' | 'down';
  questionStatus?: string;
  memberCount: number;
  isOwn: boolean;
  onVote?: (vote: 'up' | 'down') => void;
  flagCount?: number;
  userFlagged?: boolean;
  onFlag?: () => void;
  canFlag?: boolean;
}

type ActionTone = 'up' | 'down' | 'flag' | 'neutral';

export function QuestionVoteBar({
  upvotes,
  downvotes,
  userVote,
  questionStatus,
  memberCount,
  isOwn,
  onVote,
  flagCount = 0,
  userFlagged = false,
  onFlag,
  canFlag = true,
}: QuestionVoteBarProps) {
  const { colors } = useTheme();
  const isVerified = questionStatus === 'VERIFIED';
  const isRejected = questionStatus === 'REJECTED';
  const isPending = !isVerified && !isRejected && (questionStatus === 'PENDING' || !questionStatus);
  const threshold = Math.max(1, Math.ceil(memberCount * 0.2));
  const progress = Math.min(100, Math.round((upvotes / threshold) * 100));

  const styles = useMemo(() => {
    const pill = (tone: ActionTone, active: boolean): ViewStyle => {
      if (active) {
        if (tone === 'up') return { backgroundColor: colors.successBackground };
        if (tone === 'down') return { backgroundColor: colors.errorBackground };
        if (tone === 'flag') return { backgroundColor: colors.warningBackground };
      }
      return {
        backgroundColor: isOwn ? colors.backgroundSecondary : colors.cardSecondary,
        borderWidth: 1,
        borderColor: colors.border,
      };
    };

    const iconColor = (tone: ActionTone, active: boolean) => {
      if (active) {
        if (tone === 'up') return colors.success;
        if (tone === 'down') return colors.error;
        if (tone === 'flag') return colors.warning;
      }
      return colors.textSecondary;
    };

    const countColor = (tone: ActionTone, active: boolean) => {
      if (active) {
        if (tone === 'up') return colors.success;
        if (tone === 'down') return colors.error;
        if (tone === 'flag') return colors.warning;
      }
      return colors.text;
    };

    const statusChip = (
      bg: string,
      fg: string
    ): { container: ViewStyle; text: { color: string } } => ({
      container: { backgroundColor: bg },
      text: { color: fg },
    });

    return {
      divider: { borderTopColor: colors.border },
      metaText: { color: colors.textSecondary },
      pill,
      iconColor,
      countColor,
      pendingChip: statusChip(colors.warningBackground, colors.warning),
      verifiedChip: statusChip(colors.successBackground, colors.success),
      rejectedChip: statusChip(colors.errorBackground, colors.error),
      progressTrack: { backgroundColor: colors.border },
      progressFill: { backgroundColor: colors.success },
    };
  }, [colors, isOwn]);

  if (!onVote && !onFlag) return null;

  const upActive = userVote === 'up';
  const downActive = userVote === 'down';

  const renderActionPill = (
    tone: ActionTone,
    active: boolean,
    icon: keyof typeof Ionicons.glyphMap,
    iconActive: keyof typeof Ionicons.glyphMap,
    count: number,
    onPress: () => void,
    label: string,
    disabled = false
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      style={[
        styles.pill(tone, active),
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Ionicons
        name={active ? iconActive : icon}
        size={14}
        color={styles.iconColor(tone, active)}
      />
      <Text style={{ fontSize: 12, fontWeight: '500', color: styles.countColor(tone, active) }}>
        {count}
      </Text>
    </Pressable>
  );

  return (
    <View className="mt-2 pt-2 gap-2" style={[styles.divider, { borderTopWidth: 1 }]}>
      <View className="flex-row items-center flex-wrap gap-1.5">
        {isPending ? (
          <View
            className="flex-row items-center gap-1 px-2 py-0.5 rounded-md"
            style={styles.pendingChip.container}
          >
            <Ionicons name="time-outline" size={11} color={colors.warning} />
            <Text className="text-[11px] font-medium" style={styles.pendingChip.text}>
              Pending
            </Text>
          </View>
        ) : null}
        {isVerified ? (
          <View
            className="flex-row items-center gap-1 px-2 py-0.5 rounded-md"
            style={styles.verifiedChip.container}
          >
            <Ionicons name="checkmark-circle" size={12} color={colors.success} />
            <Text className="text-[11px] font-semibold" style={styles.verifiedChip.text}>
              Verified
            </Text>
          </View>
        ) : null}
        {isRejected ? (
          <View
            className="flex-row items-center gap-1 px-2 py-0.5 rounded-md"
            style={styles.rejectedChip.container}
          >
            <Ionicons name="close-circle-outline" size={11} color={colors.error} />
            <Text className="text-[11px] font-medium" style={styles.rejectedChip.text}>
              Rejected
            </Text>
          </View>
        ) : null}
      </View>

      {onVote ? (
        <View className="flex-row items-center flex-wrap gap-2">
          {renderActionPill(
            'up',
            upActive,
            'thumbs-up-outline',
            'thumbs-up',
            upvotes,
            () => onVote('up'),
            `Approve question, ${upvotes} upvotes`
          )}
          {renderActionPill(
            'down',
            downActive,
            'thumbs-down-outline',
            'thumbs-down',
            downvotes,
            () => onVote('down'),
            `Reject signal, ${downvotes} downvotes`
          )}
          {onFlag
            ? renderActionPill(
                'flag',
                userFlagged,
                'flag-outline',
                'flag',
                flagCount,
                onFlag,
                `Flag as similar, current flags: ${flagCount}`,
                !canFlag
              )
            : null}
        </View>
      ) : null}

      {isPending && memberCount > 0 ? (
        <View className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-[10px]" style={styles.metaText}>
              {upvotes} / {threshold} approvals needed
            </Text>
            <Text className="text-[10px] font-medium" style={styles.metaText}>
              {progress}%
            </Text>
          </View>
          <View className="h-1 rounded-full overflow-hidden" style={styles.progressTrack}>
            <View
              className="h-full rounded-full"
              style={{
                ...styles.progressFill,
                width: `${progress}%`,
                minWidth: progress > 0 ? 4 : 0,
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
