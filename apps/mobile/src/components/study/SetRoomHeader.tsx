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
import { SetCoverSquare } from './SetCoverSquare';

export interface SetRoomHeaderProps {
  /** The set's name. Two lines, then ellipsis. */
  title: string;
  /**
   * The set's picture, when it has one.
   *
   * Drawn ONLY when a cover exists: this header has never carried an identity
   * tile, so inventing a pastel square for every set would be a layout change
   * dressed up as a cover feature. A set with a picture gets the picture; a
   * set without one looks exactly as it does today.
   */
  coverPath?: string | null;
  /** Shown under the title on a course room, where counts are the subtitle. */
  subtitle?: string;
  /** The study timer chip, rendered by the screen that owns the set id. */
  timer?: React.ReactNode;
  /** Back to the set list. Omitted on a course room, which has no set list. */
  onAllSets?: () => void;
  /**
   * Opens the OS share sheet for this set. Omitted where there is nothing to
   * share (a course room has no set link).
   *
   * A GLYPH, not an overflow row: the reference puts share in the set's top
   * bar, and on a phone the room's overflow is already a two-row card that
   * costs a tap to open. The screen passes the handler because only it knows
   * the set id — see `components/study/shareStudySet.ts`.
   */
  onShare?: () => void;
  /** Opens the set's overflow menu. Omitted where there is no menu. */
  onMore?: () => void;
  /** Drives the kebab's expanded state for a screen reader. */
  moreExpanded?: boolean;
}

export function SetRoomHeader({
  title,
  coverPath,
  subtitle,
  timer,
  onAllSets,
  onShare,
  onMore,
  moreExpanded = false,
}: SetRoomHeaderProps) {
  return (
    <View className="pt-2 pb-3">
      <View className="flex-row items-center gap-3">
        <SetCoverSquare
          coverPath={coverPath}
          size={44}
          radius={14}
          accessibilityLabel={`${title} picture`}
          fallback={null}
        />
        <View className="flex-1">
          <T.Title numberOfLines={2} ellipsizeMode="tail">
            {title}
          </T.Title>
        </View>
      </View>
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
        {onShare ? (
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share this set"
            hitSlop={8}
            className="h-9 w-9 items-center justify-center"
          >
            <AppIcon name="share" size={20} importantForAccessibility="no" />
          </Pressable>
        ) : null}
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
