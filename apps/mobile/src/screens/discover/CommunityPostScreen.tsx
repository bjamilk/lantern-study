import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  COMMUNITY_BOARD_COPY,
  boardRelativeTime,
  reactionAccessibilityLabel,
} from '@lantern/shared/network';
import { applyReactionLocally } from '@lantern/shared/chat';
import { resolveAvatarSrc, normalizeStorageUrl } from '@lantern/shared/utils';
import * as api from '../../services/api';
import { useAuthStore } from '../../stores';
import { useBoardStore } from '../../stores/boardStore';
import { useGroupStore, type Message } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { ChatImageThumbnail, MentionText } from '../../components/chat/ChatMessageBody';
import { MessageReactions, ReactionPickerRow } from '../../components/chat/MessageReactions';
import { VoiceNotePlayer } from '../../components/chat/VoiceNotePlayer';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { BackButton } from '../../components/ui';
import { useTheme } from '../../theme';
import { mergeComments, selectPostComments, splitBoardBody } from '../../utils/boardPosts';

type Params = {
  groupId: string;
  rootId: string;
  communitySlug?: string;
  communityName?: string;
};

type Navigation = { goBack: () => void };

/**
 * One board post and its comments (spec §4.1).
 *
 * This is where a post's media actually loads — the board list only ever
 * renders a `Photo · tap to load` chip, so 20 cards a page never cost 20
 * image downloads (§10).
 *
 * Comments are a flat, oldest-first list. There is deliberately no typing
 * indicator, no read receipts and no ticks: those stay in Chat.
 */
export function CommunityPostScreen({
  navigation,
  route,
}: {
  navigation: Navigation;
  route: { params: Params };
}) {
  const { groupId, rootId } = route.params;
  const { colors } = useTheme();
  const { lowDataMode } = useLowDataMode();
  const user = useAuthStore((s) => s.user);

  const messages = useGroupStore((s) => s.messagesCache[groupId]);
  const fetchThread = useGroupStore((s) => s.fetchThread);
  const patchMessageInState = useGroupStore((s) => s.patchMessageInState);
  const commentOnPost = useBoardStore((s) => s.commentOnPost);

  const [fetched, setFetched] = useState<Message[]>([]);
  /**
   * The post itself, from the thread fetch. `fetchThread` returns it but does
   * not write it into `messagesCache`, and the cache does not hold it at all
   * when the post is older than the board's loaded page (the pinned strip, and
   * every `discover/c/:slug/ch/:groupId/p/:rootId` deep link) — without this
   * the screen rendered comments under no post.
   */
  const [fetchedRoot, setFetchedRoot] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});

  const root = useMemo(
    () => (messages || []).find((m) => m.id === rootId) ?? fetchedRoot,
    [messages, rootId, fetchedRoot]
  );

  const comments = useMemo(
    () => mergeComments(fetched, selectPostComments(messages, rootId)),
    [fetched, messages, rootId]
  );

  const reload = useCallback(async () => {
    try {
      const thread = (await fetchThread(rootId, { groupId })) as Message[];
      // The root itself comes back inside the thread. Keep it: it is the only
      // copy when the post is off the board's loaded page.
      setFetchedRoot(thread.find((m) => m.id === rootId) ?? null);
      setFetched(thread.filter((m) => m.id !== rootId));
    } catch {
      // Whatever the cache already holds still renders.
    } finally {
      setLoading(false);
    }
  }, [fetchThread, rootId, groupId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void api
      .fetchUserReactionsForGroup(groupId)
      .then((map) => {
        if (!cancelled) setMyReactions(map || {});
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const toggleReaction = useCallback(
    async (message: Message, emoji: string, added: boolean) => {
      const previousMine = myReactions[message.id] ? [...myReactions[message.id]!] : [];
      const previousCounts = message.reactions;
      setMyReactions((prev) => {
        const mine = new Set(prev[message.id] || []);
        if (added) mine.add(emoji);
        else mine.delete(emoji);
        return { ...prev, [message.id]: [...mine] };
      });
      patchMessageInState(message.id, {
        reactions: applyReactionLocally(previousCounts, emoji, added),
      });
      try {
        const result = added
          ? await api.addMessageReaction(message.id, emoji)
          : await api.removeMessageReaction(message.id, emoji);
        patchMessageInState(message.id, { reactions: result?.reactions ?? {} });
      } catch (error) {
        setMyReactions((prev) => ({ ...prev, [message.id]: previousMine }));
        patchMessageInState(message.id, { reactions: previousCounts });
        useToastStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Could not save that reaction',
            'error'
          );
      }
    },
    [myReactions, patchMessageInState]
  );

  const submitComment = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || sending) return;
    setSending(true);
    try {
      await commentOnPost(groupId, { rootId, text: trimmed, senderId: user.id });
      setText('');
      setExpanded(false);
      await reload();
    } catch (error) {
      Alert.alert(
        'Comment failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  }, [text, user?.id, sending, commentOnPost, groupId, rootId, reload]);

  const rootMedia = splitBoardBody(root?.text);
  const rootImage = rootMedia.imageUrl
    ? normalizeStorageUrl(rootMedia.imageUrl)
    : root?.imageUrl
      ? normalizeStorageUrl(root.imageUrl)
      : null;

  const renderComment = ({ item }: { item: Message }) => {
    const media = splitBoardBody(item.text);
    const when = boardRelativeTime(item.createdAt);
    const isRemoved = !!item.isRemoved || !!item.removedAt;
    return (
      // NOT `accessible` on the row: it would collapse the comment into one
      // element and take the photo and the voice player's controls out of the
      // accessibility tree. The composed label sits on the text block instead.
      <View
        accessibilityRole="none"
        className="flex-row px-4 py-2.5 border-b border-lantern-border"
      >
        <ResolvedAvatar
          name={item.senderName}
          uri={resolveAvatarSrc(item.senderAvatar, lowDataMode)}
          size={24}
          decorative
        />
        <View className="ml-2 flex-1 min-w-0">
          <View
            accessible
            accessibilityLabel={`${item.senderName}${when ? `, ${when}` : ''}, ${
              isRemoved ? COMMUNITY_BOARD_COPY.postRemoved : media.body
            }`}
            className="flex-row items-center"
          >
            <Text className="text-[12px] font-semibold text-lantern-text shrink" numberOfLines={1}>
              {item.senderName}
            </Text>
            {when ? (
              <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{when}</Text>
            ) : null}
          </View>
          {isRemoved ? (
            <Text className="mt-0.5 text-[13px] italic text-lantern-text-tertiary">
              {COMMUNITY_BOARD_COPY.postRemoved}
            </Text>
          ) : (
            <>
              {media.imageUrl ? (
                <View className="mt-1">
                  <ChatImageThumbnail
                    uri={normalizeStorageUrl(media.imageUrl)}
                    accessibilityLabel="Comment photo"
                    maxWidth={200}
                  />
                </View>
              ) : null}
              {media.audioUrl ? (
                <View className="mt-1">
                  <VoiceNotePlayer url={normalizeStorageUrl(media.audioUrl)} isOwn={false} />
                </View>
              ) : null}
              {/* Already read by the composed label above. */}
              {media.body ? (
                <View
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  className="mt-0.5"
                >
                  <MentionText
                    text={media.body}
                    color={colors.text}
                    mentionColor={colors.primary}
                  />
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        <Text className="flex-1 ml-1 text-base font-semibold text-lantern-text" numberOfLines={1}>
          {COMMUNITY_BOARD_COPY.commentsTitle}
        </Text>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={COMPOSER_KEYBOARD_BEHAVIOR}>
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={renderComment}
          contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}
          ListHeaderComponent={
            root ? (
              <View className="border-b border-lantern-border px-4 py-3">
                <View className="flex-row items-center">
                  <ResolvedAvatar
                    name={root.senderName}
                    uri={resolveAvatarSrc(root.senderAvatar, lowDataMode)}
                    size={28}
                    decorative
                  />
                  <Text
                    className="ml-2 flex-1 text-[13px] font-semibold text-lantern-text"
                    numberOfLines={1}
                  >
                    {root.senderName}
                  </Text>
                  <Text className="text-[11px] text-lantern-text-tertiary">
                    {boardRelativeTime(root.createdAt)}
                  </Text>
                </View>

                {root.subject ? (
                  <Text className="mt-2 text-[16px] font-bold text-lantern-text">
                    {root.subject}
                  </Text>
                ) : null}

                {rootImage ? (
                  <View className="mt-2">
                    <ChatImageThumbnail uri={rootImage} accessibilityLabel="Post photo" />
                  </View>
                ) : null}

                {rootMedia.audioUrl ? (
                  <View className="mt-2">
                    <VoiceNotePlayer
                      url={normalizeStorageUrl(rootMedia.audioUrl)}
                      isOwn={root.senderId === user?.id}
                    />
                  </View>
                ) : null}

                {rootMedia.body ? (
                  <View className="mt-1">
                    <MentionText
                      text={rootMedia.body}
                      color={colors.text}
                      mentionColor={colors.primary}
                    />
                  </View>
                ) : null}

                <MessageReactions
                  reactions={root.reactions}
                  mine={myReactions[root.id]}
                  onToggle={(emoji, added) => void toggleReaction(root, emoji, added)}
                  size="touch"
                  labelFor={reactionAccessibilityLabel}
                />

                {pickerOpen ? (
                  <ReactionPickerRow
                    mine={myReactions[root.id]}
                    onPick={(emoji, added) => {
                      setPickerOpen(false);
                      void toggleReaction(root, emoji, added);
                    }}
                  />
                ) : null}

                <Pressable
                  onPress={() => setPickerOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={COMMUNITY_BOARD_COPY.react}
                  accessibilityState={{ expanded: pickerOpen }}
                  className="mt-2 self-start min-h-[44px] justify-center"
                >
                  <Text className="text-[12px] font-semibold text-lantern-primary">
                    {COMMUNITY_BOARD_COPY.react}
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : (
              <Text className="px-4 py-8 text-center text-sm text-lantern-text-tertiary">
                {COMMUNITY_BOARD_COPY.comments(0)}
              </Text>
            )
          }
        />

        <View className="border-t border-lantern-border bg-lantern-background px-3 py-2">
          {expanded ? (
            <View className="flex-row items-end">
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={COMMUNITY_BOARD_COPY.commentPlaceholder}
                placeholderTextColor={colors.inputPlaceholder}
                autoFocus
                multiline
                accessibilityLabel={COMMUNITY_BOARD_COPY.commentPlaceholder}
                className="flex-1 min-h-[44px] rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
                style={{ borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }}
              />
              <Pressable
                onPress={() => void submitComment()}
                disabled={!text.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel={COMMUNITY_BOARD_COPY.comment}
                accessibilityState={{ disabled: !text.trim() || sending, busy: sending }}
                className="ml-2 min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl bg-lantern-primary px-3"
                style={{ opacity: !text.trim() || sending ? 0.5 : 1 }}
              >
                <Text className="text-xs font-semibold text-white">
                  {sending ? COMMUNITY_BOARD_COPY.posting : COMMUNITY_BOARD_COPY.comment}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.comment}
              accessibilityState={{ expanded: false }}
              className="min-h-[44px] flex-row items-center rounded-full border border-lantern-border bg-lantern-surface px-4"
            >
              <Text className="text-sm text-lantern-text-tertiary">
                {COMMUNITY_BOARD_COPY.commentPlaceholder}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default CommunityPostScreen;
