import React from 'react';
import { Text, View } from 'react-native';
import {
  COMMUNITY_BOARD_COPY,
  boardRelativeTime,
  type BoardQuotedPost as QuotedPost,
} from '@lantern/shared/network';
import { AppIcon } from '../ui/AppIcon';

/**
 * The original a repost points at (§6.5).
 *
 * TEXT ONLY, by construction — the server's `toQuotedPost` never puts a media
 * URL in this payload, and this component has no way to render one even if it
 * arrived. A repost card therefore downloads exactly 0 bytes of media, the
 * same as every other card in the list: `hasImage` / `hasAudio` become a chip
 * that says the media exists, and the reader opens the post to see it.
 *
 * Three states, and all three are honest:
 *  - a resolved post → author, title, snippet, media chip;
 *  - `removedAt` set → `quotedRemoved`, so a takedown of the original
 *    propagates to every repost of it with zero writes to the repost rows;
 *  - `null` → `quotedUnavailable`, which is what an unresolvable id means
 *    (the author's account was deleted and `ON DELETE SET NULL` fired).
 */
export function BoardQuotedPost({
  quoted,
  now,
}: {
  quoted: QuotedPost | null;
  now?: number;
}) {
  const frame = 'mt-2 rounded-xl border border-lantern-border px-3 py-2';

  if (!quoted) {
    return (
      <View accessible accessibilityLabel={COMMUNITY_BOARD_COPY.quotedUnavailable} className={frame}>
        <Text className="text-[13px] italic text-lantern-text-tertiary">
          {COMMUNITY_BOARD_COPY.quotedUnavailable}
        </Text>
      </View>
    );
  }

  if (quoted.removedAt) {
    return (
      <View accessible accessibilityLabel={COMMUNITY_BOARD_COPY.quotedRemoved} className={frame}>
        <Text className="text-[13px] italic text-lantern-text-tertiary">
          {COMMUNITY_BOARD_COPY.quotedRemoved}
        </Text>
      </View>
    );
  }

  const when = boardRelativeTime(quoted.timestamp, now);
  const mediaLabel = quoted.hasImage
    ? COMMUNITY_BOARD_COPY.photoTapToLoad
    : quoted.hasAudio
      ? COMMUNITY_BOARD_COPY.voiceNote
      : null;

  return (
    <View
      accessible
      accessibilityLabel={[
        quoted.senderName,
        when,
        quoted.subject,
        quoted.snippet,
        mediaLabel,
      ]
        .filter(Boolean)
        .join(', ')}
      className={frame}
    >
      <View className="flex-row items-center">
        <Text className="text-[12px] font-semibold text-lantern-text shrink" numberOfLines={1}>
          {quoted.senderName}
        </Text>
        {when ? <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{when}</Text> : null}
      </View>
      {quoted.subject ? (
        <Text className="mt-0.5 text-[13px] font-bold text-lantern-text" numberOfLines={2}>
          {quoted.subject}
        </Text>
      ) : null}
      {quoted.snippet ? (
        <Text className="mt-0.5 text-[13px] text-lantern-text-secondary" numberOfLines={3}>
          {quoted.snippet}
        </Text>
      ) : null}
      {mediaLabel ? (
        <View className="mt-1 flex-row items-center">
          <AppIcon
            name={quoted.hasImage ? 'image' : 'mic'}
            size={13}
            color="#94a3b8"
          />
          <Text className="ml-1 text-[11px] text-lantern-text-tertiary">{mediaLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default BoardQuotedPost;
