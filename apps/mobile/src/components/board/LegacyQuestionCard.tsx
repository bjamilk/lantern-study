import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COMMUNITY_BOARD_COPY } from '@lantern/shared/network';

/**
 * A `type='QUESTION'` row posted before this channel became a board (§4.2).
 *
 * Read-only by design: no vote bar, no VERIFIED chip, no flag-as-duplicate —
 * those live in a study group now. Its one action is the destination for
 * everything the board removed. Channels created since 2026-09-02 already hold
 * question rows, and without this card they render blank.
 */
export function LegacyQuestionCard({
  stem,
  authorName,
  relativeTime,
  hasImage,
  onStartStudyGroup,
}: {
  stem: string;
  authorName: string;
  relativeTime: string | null;
  hasImage: boolean;
  onStartStudyGroup: () => void;
}) {
  return (
    // NOT `accessible` on the container: that collapses the card into one
    // element and takes `Start a study group about this` — its only action —
    // out of the accessibility tree entirely (§9). The composed label sits on
    // the read-only block instead.
    <View
      accessibilityRole="none"
      className="mx-3 my-1.5 rounded-2xl border border-lantern-border bg-lantern-surface p-3"
    >
      <View
        accessible
        accessibilityLabel={`${authorName}${relativeTime ? `, ${relativeTime}` : ''}, ${
          COMMUNITY_BOARD_COPY.legacyQuestion
        }, ${stem}`}
      >
        <View className="flex-row items-center">
          <Ionicons name="help-circle-outline" size={14} color="#94a3b8" />
          <Text className="ml-1 flex-1 text-[11px] text-lantern-text-tertiary" numberOfLines={2}>
            {COMMUNITY_BOARD_COPY.legacyQuestion}
          </Text>
        </View>

        <Text className="mt-2 text-[15px] text-lantern-text">{stem}</Text>
      </View>

      {hasImage ? (
        <View className="mt-2 self-start flex-row items-center rounded-full border border-lantern-border px-2 py-1">
          <Ionicons name="image-outline" size={12} color="#94a3b8" />
          <Text className="ml-1 text-[11px] text-lantern-text-secondary">
            {COMMUNITY_BOARD_COPY.photoTapToLoad}
          </Text>
        </View>
      ) : null}

      <View className="mt-2 flex-row items-center">
        <Text className="flex-1 text-[11px] text-lantern-text-tertiary" numberOfLines={1}>
          {authorName}
          {relativeTime ? ` · ${relativeTime}` : ''}
        </Text>
      </View>

      <Pressable
        onPress={onStartStudyGroup}
        accessibilityRole="button"
        accessibilityLabel={COMMUNITY_BOARD_COPY.openStudyGroup}
        className="mt-2 min-h-[44px] justify-center rounded-xl bg-lantern-background-secondary px-3 active:opacity-90"
      >
        <Text className="text-[13px] font-semibold text-lantern-primary">
          {COMMUNITY_BOARD_COPY.openStudyGroup}
        </Text>
      </Pressable>
    </View>
  );
}

export default LegacyQuestionCard;
