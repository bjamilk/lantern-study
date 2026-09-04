import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BOARD_ACTION_ROW_ORDER,
  boardBookmarkAccessibilityLabel,
  boardCommentAccessibilityLabel,
  boardFavoriteAccessibilityLabel,
  boardRepostAccessibilityLabel,
  boardShareAccessibilityLabel,
  type BoardAction,
} from '@lantern/shared/network';
import { useTheme } from '../../theme';

/**
 * The five-control board action row (§9.1).
 *
 * Rendered from the shared `BOARD_ACTION_ROW_ORDER` array, not from a literal
 * list written twice — that array is the only thing keeping web and Android
 * from drifting into two different orders.
 *
 * Rules this file exists to hold in one place:
 *
 *  - **44×44 minimum, always.** NativeWind inlines `rem` at 14 here, so `h-9`
 *    is 31.5px and `h-11` is 38.5px — neither is a touch target. The literal
 *    `min-h-[44px] min-w-[44px]` is deliberate. Five × 44 = 220dp inside a
 *    320dp screen's ~296dp usable width, so it fits; when it is tight the
 *    COUNT LABEL goes first, never the target.
 *  - **Counts are hidden at zero**, which is both Twitter's behaviour and what
 *    buys the room for five controls.
 *  - **State is never colour alone.** Every stateful control switches between
 *    an outline and a solid icon AND says the state in words in its
 *    accessibility label ("Favorite, 12, favorited"), so it survives a
 *    grayscale filter and a screen reader alike.
 */

type ActionSpec = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon?: React.ComponentProps<typeof Ionicons>['name'];
  count?: number;
  active?: boolean;
  activeColor?: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Absent, not disabled, when the server cannot back it (§2 degrade). */
  hidden?: boolean;
};

const ICON_COLOR = '#94a3b8';
const ICON_SIZE = 17;

export function BoardActionRow({
  favoriteCount,
  favorited,
  onFavorite,
  repostCount,
  repostedByMe,
  onRepost,
  canRepost = true,
  replyCount,
  onComment,
  bookmarked,
  onBookmark,
  bookmarksSupported = true,
  onShare,
}: {
  favoriteCount: number;
  favorited: boolean;
  onFavorite: () => void;
  repostCount: number;
  repostedByMe: boolean;
  onRepost: () => void;
  /** False on a repost of a repost, a removed post, or your own fresh post. */
  canRepost?: boolean;
  replyCount: number;
  onComment: () => void;
  bookmarked: boolean;
  onBookmark: () => void;
  /** False when `message_bookmarks` is not applied: hide, do not disable. */
  bookmarksSupported?: boolean;
  onShare: () => void;
}) {
  const { colors } = useTheme();

  const specs: Record<BoardAction, ActionSpec> = {
    comment: {
      icon: 'chatbubble-outline',
      count: replyCount,
      label: boardCommentAccessibilityLabel(replyCount),
      onPress: onComment,
    },
    repost: {
      icon: 'repeat-outline',
      activeIcon: 'repeat',
      count: repostCount,
      active: repostedByMe,
      activeColor: colors.success,
      label: boardRepostAccessibilityLabel(repostCount, repostedByMe),
      onPress: onRepost,
      // A repost you already made stays tappable — that tap is the undo.
      disabled: !canRepost && !repostedByMe,
    },
    favorite: {
      icon: 'heart-outline',
      activeIcon: 'heart',
      count: favoriteCount,
      active: favorited,
      activeColor: colors.error,
      label: boardFavoriteAccessibilityLabel(favoriteCount, favorited),
      onPress: onFavorite,
    },
    bookmark: {
      icon: 'bookmark-outline',
      activeIcon: 'bookmark',
      active: bookmarked,
      activeColor: colors.primary,
      label: boardBookmarkAccessibilityLabel(bookmarked),
      onPress: onBookmark,
      hidden: !bookmarksSupported,
    },
    share: {
      icon: 'share-outline',
      label: boardShareAccessibilityLabel(),
      onPress: onShare,
    },
  };

  return (
    <View className="mt-1 flex-row items-center">
      {BOARD_ACTION_ROW_ORDER.map((action) => {
        const spec = specs[action];
        if (spec.hidden) return null;
        const showCount = typeof spec.count === 'number' && spec.count > 0;
        const iconName = spec.active && spec.activeIcon ? spec.activeIcon : spec.icon;
        return (
          <Pressable
            key={action}
            onPress={spec.onPress}
            disabled={spec.disabled}
            accessibilityRole="button"
            accessibilityLabel={spec.label}
            accessibilityState={{
              selected: !!spec.active,
              disabled: !!spec.disabled,
            }}
            // 44px is the floor on BOTH axes. `flex-1` spreads the five evenly
            // and lets a long count grow into its own slot instead of pushing
            // a neighbour's target under the minimum.
            className="min-h-[44px] min-w-[44px] flex-1 flex-row items-center justify-start"
            style={{ opacity: spec.disabled ? 0.4 : 1 }}
          >
            <Ionicons
              name={iconName}
              size={ICON_SIZE}
              color={spec.active ? (spec.activeColor ?? colors.primary) : ICON_COLOR}
            />
            {showCount ? (
              <Text className="ml-1 text-[12px] font-medium text-lantern-text-secondary">
                {spec.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default BoardActionRow;
