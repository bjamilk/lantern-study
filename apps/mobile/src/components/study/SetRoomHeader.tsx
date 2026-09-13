/**
 * The set room's header, in two lines instead of one.
 *
 * WHY. `Client Centre Care` wrapped to two lines and collided with
 * `25:00 · All sets · Ask Lantern · More` on the same row (SF2 mobile evidence
 * §6 item 7): five things in 1080 px does not fit, and the thing that loses is
 * the set's own name. So the title gets the line, and the actions get the next
 * one — a timer chip, `All sets` as a text link back to the set list, and a
 * kebab. `Ask Lantern` is gone from here: the shell's bar carries the Ask
 * door, and the room still has its own `Ask Lantern` tile, which made this the
 * third of three doors to one place (evidence §2).
 *
 * The title is `T.Title` — the serif h1 step — capped at two lines with an
 * ellipsis rather than allowed to grow, because the row below it is laid out
 * against a header of known height.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { AppIcon, T } from '../ui';

export interface SetRoomHeaderProps {
  /** The set's name. Two lines, then ellipsis. */
  title: string;
  /** Shown under the title on a course room, where counts are the subtitle. */
  subtitle?: string;
  /** The study timer chip, rendered by the screen that owns the set id. */
  timer?: React.ReactNode;
  /** Back to the set list. Omitted on a course room, which has no set list. */
  onAllSets?: () => void;
  /** Opens the set's overflow menu. Omitted where there is no menu. */
  onMore?: () => void;
  /** Drives the kebab's expanded state for a screen reader. */
  moreExpanded?: boolean;
}

export function SetRoomHeader({
  title,
  subtitle,
  timer,
  onAllSets,
  onMore,
  moreExpanded = false,
}: SetRoomHeaderProps) {
  return (
    <View className="pt-2 pb-3">
      <T.Title numberOfLines={2} ellipsizeMode="tail">
        {title}
      </T.Title>
      {subtitle ? (
        <T.Caption tone="secondary" className="mt-0.5">
          {subtitle}
        </T.Caption>
      ) : null}
      <View className="flex-row items-center gap-4 mt-2">
        {timer}
        {onAllSets ? (
          <Pressable
            onPress={onAllSets}
            accessibilityRole="button"
            accessibilityLabel="All study sets"
            hitSlop={8}
          >
            <T.Caption>All sets</T.Caption>
          </Pressable>
        ) : null}
        <View className="flex-1" />
        {onMore ? (
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel="More set actions"
            accessibilityState={{ expanded: moreExpanded }}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center -mr-2"
          >
            <AppIcon name="ellipsis-vertical" size={20} importantForAccessibility="no" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default SetRoomHeader;
