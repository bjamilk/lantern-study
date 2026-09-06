import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import {
  BOARD_BOOKMARKS_PAGE_SIZE,
  COMMUNITY_BOARD_COPY,
  boardQuoteSnippet,
  boardRelativeTime,
  type BoardBookmarkEntry,
} from '@lantern/shared/network';
import * as boardApi from '../../services/boardActions';
import { BackButton } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

type Navigation = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

/**
 * "Saved posts" — every board, newest saved first (§7.5).
 *
 * Rows are TEXT ONLY: author, board, title or snippet, relative time, and a
 * media CHIP. The list never downloads a photo, so opening it on a metered
 * connection costs the JSON and nothing else.
 *
 * There is deliberately NO `canAccessDiscoverHub` gate: the board screen
 * itself carries none (membership is the authorisation), so gating this would
 * hide the list from exactly the pilot cohort that has bookmarks.
 *
 * Server-side, the list inner-joins `group_members` for the viewer — a
 * bookmark outlives membership, so leaving a board must take its posts out of
 * here rather than leave a private reader for a members-only board.
 */
export function SavedPostsScreen({ navigation }: { navigation: Navigation }) {
  // `SavedPosts` is NOT immersive, so `edges={['bottom']}` was the wrong tool:
  // it paid the ~20-48px system inset while the absolute tab bar over this
  // route is ~86-114px tall. This list also wires no scroll handler, so the bar
  // never slides away — the clearance has to be paid in full.
  const listBottomPadding = useScreenBottomPadding();
  const [entries, setEntries] = useState<BoardBookmarkEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * `false` = `message_bookmarks` is not applied yet. The screen then says so
   * on one line instead of showing an empty list that looks like "you have
   * saved nothing" — and today's device-local "Save for me" keeps working
   * untouched until Phase 2 deletes it.
   */
  const [serverBacked, setServerBacked] = useState(true);

  const load = useCallback(async (before?: string | null) => {
    const page = await boardApi
      .fetchBookmarkedPosts({ limit: BOARD_BOOKMARKS_PAGE_SIZE, before })
      .catch(() => null);
    if (!page) {
      setServerBacked(false);
      return;
    }
    setServerBacked(page.serverBacked !== false);
    setCursor(page.nextCursor ?? null);
    setEntries((prev) => {
      if (!before) return page.entries ?? [];
      const seen = new Set(prev.map((e) => e.post.id));
      return [...prev, ...(page.entries ?? []).filter((e) => !seen.has(e.post.id))];
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void load(cursor).finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, load]);

  const openPost = useCallback(
    (entry: BoardBookmarkEntry) => {
      navigation.navigate('CommunityPost', {
        groupId: entry.groupId,
        rootId: entry.post.id,
        communitySlug: entry.communitySlug ?? undefined,
        communityName: entry.communityName ?? undefined,
      });
    },
    [navigation]
  );

  const renderEntry = ({ item }: { item: BoardBookmarkEntry }) => {
    const { post } = item;
    const snippet = post.subject?.trim() || boardQuoteSnippet(post.text);
    const when = boardRelativeTime(post.timestamp);
    const mediaLabel = post.imageUrl
      ? COMMUNITY_BOARD_COPY.photoTapToLoad
      : /\[audio\]\(/i.test(post.text || '')
        ? COMMUNITY_BOARD_COPY.voiceNote
        : null;
    return (
      <Pressable
        onPress={() => openPost(item)}
        accessibilityRole="button"
        accessibilityLabel={[
          post.senderName,
          item.boardName,
          when,
          snippet || COMMUNITY_BOARD_COPY.post,
          mediaLabel,
        ]
          .filter(Boolean)
          .join(', ')}
        className="min-h-[44px] justify-center border-b border-lantern-border px-4 py-3"
      >
        <View className="flex-row items-center">
          <Text className="text-[12px] font-semibold text-lantern-text shrink" numberOfLines={1}>
            {post.senderName}
          </Text>
          <Text className="ml-2 text-[11px] text-lantern-primary-text shrink" numberOfLines={1}>
            {`# ${item.boardName}`}
          </Text>
          {when ? (
            <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{when}</Text>
          ) : null}
        </View>
        {snippet ? (
          <Text className="mt-0.5 text-[14px] text-lantern-text" numberOfLines={2}>
            {snippet}
          </Text>
        ) : null}
        {mediaLabel ? (
          <View className="mt-1 flex-row items-center">
            <AppIcon
              name={post.imageUrl ? 'image' : 'mic'}
              size={13}
              color="#94a3b8"
            />
            <Text className="ml-1 text-[11px] text-lantern-text-tertiary">{mediaLabel}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen bottom="none">
      <View className="h-[56px] flex-row items-center border-b border-lantern-border pr-2">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        <Text
          accessibilityRole="header"
          className="ml-1 flex-1 text-base font-semibold text-lantern-text"
          numberOfLines={1}
        >
          {COMMUNITY_BOARD_COPY.savedPosts}
        </Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.post.id}
        renderItem={renderEntry}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: listBottomPadding }}
        ListEmptyComponent={
          loading ? (
            <View className="items-center py-10">
              <ActivityIndicator color="#6366f1" />
            </View>
          ) : (
            <View className="px-6 py-10">
              <Text className="text-center text-sm text-lantern-text-secondary">
                {serverBacked
                  ? COMMUNITY_BOARD_COPY.savedPostsEmpty
                  : COMMUNITY_BOARD_COPY.bookmarksUnavailable}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="items-center py-4">
              <ActivityIndicator color="#6366f1" />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

export default SavedPostsScreen;
