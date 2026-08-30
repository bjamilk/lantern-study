import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  CHAT_REACTION_EMOJI,
  sortedReactionEntries,
  totalReactionCount,
} from '@lantern/shared/chat';
import { useTheme, withAlpha } from '../../theme';

interface Props {
  reactions?: Record<string, number> | null;
  /** Emoji the viewer has personally added to this message. */
  mine?: string[];
  onToggle?: (emoji: string, added: boolean) => void;
  align?: 'start' | 'end';
}

/**
 * Reaction chips under a message bubble. Tapping a chip toggles the viewer's
 * own reaction; the picker itself lives in the long-press action bar so the
 * bubble stays uncluttered.
 *
 * Colours come from `style`, never Tailwind opacity-modifier classes on a
 * lantern colour — those compile to nothing here (var()-backed palette; see
 * theme/withAlpha).
 */
export function MessageReactions({ reactions, mine = [], onToggle, align = 'start' }: Props) {
  const { colors } = useTheme();
  if (totalReactionCount(reactions) === 0) return null;
  const mineSet = new Set(mine);

  return (
    <View
      className={`mt-1 flex-row flex-wrap items-center gap-1 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      {sortedReactionEntries(reactions).map(([emoji, count]) => {
        const isMine = mineSet.has(emoji);
        return (
          <Pressable
            key={emoji}
            onPress={onToggle ? () => onToggle(emoji, !isMine) : undefined}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: isMine }}
            accessibilityLabel={`${emoji} ${count} ${count === 1 ? 'reaction' : 'reactions'}${
              isMine ? ', including yours' : ''
            }`}
            className="flex-row items-center rounded-full border px-2 py-0.5"
            style={{
              borderColor: isMine ? colors.primary : colors.border,
              backgroundColor: isMine
                ? withAlpha(colors.primary, 0.15)
                : colors.backgroundSecondary,
            }}
          >
            <Text className="text-[12px]">{emoji}</Text>
            <Text
              className="ml-1 text-[11px] font-semibold"
              style={{ color: isMine ? colors.primary : colors.textSecondary }}
            >
              {count}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The emoji row shown inside the long-press action bar. */
export function ReactionPickerRow({
  mine = [],
  onPick,
}: {
  mine?: string[];
  onPick: (emoji: string, added: boolean) => void;
}) {
  const { colors } = useTheme();
  const mineSet = new Set(mine);
  return (
    <View
      className="flex-row items-center justify-around px-2 py-1.5 border-b border-lantern-border bg-lantern-surface"
      accessibilityLabel="React to this message"
    >
      {CHAT_REACTION_EMOJI.map((emoji) => {
        const isMine = mineSet.has(emoji);
        return (
          <Pressable
            key={emoji}
            onPress={() => onPick(emoji, !isMine)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: isMine }}
            accessibilityLabel={isMine ? `Remove ${emoji} reaction` : `React with ${emoji}`}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={isMine ? { backgroundColor: withAlpha(colors.primary, 0.18) } : undefined}
          >
            <Text className="text-[22px]">{emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default MessageReactions;
