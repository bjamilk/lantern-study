import React, { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, TextInput, View, findNodeHandle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BOARD_POST_SUBJECT_MAX,
  COMMUNITY_BOARD_COPY,
  validateBoardSubject,
} from '@lantern/shared/network';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { ChatComposer, type MentionCandidate } from '../chat/ChatComposer';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useTheme } from '../../theme';

/**
 * The board's docked composer (§4.1 region 6).
 *
 * Collapsed it is a pill — avatar, `Write a post`, camera glyph — because that
 * is where a thumb goes on a cheap Android. Expanded it adds the optional
 * title and then reuses `ChatComposer` verbatim, so @mention autocomplete, the
 * photo attach and the ≤120s voice note are the same code paths the Chat tab
 * uses rather than a second, slowly diverging implementation.
 */
export function BoardComposer({
  groupId,
  avatarUrl,
  authorName,
  text,
  onChangeText,
  subject,
  onChangeSubject,
  sending,
  lowDataMode,
  mentionCandidates,
  onPost,
  onAttachImage,
  onSendAudioMarkdown,
  editing,
  onCancelEdit,
}: {
  groupId: string;
  avatarUrl?: string | null;
  authorName: string;
  text: string;
  onChangeText: (value: string) => void;
  subject: string;
  onChangeSubject: (value: string) => void;
  sending: boolean;
  lowDataMode: boolean;
  mentionCandidates: MentionCandidate[];
  /** Resolves true when the post left the composer, so it can collapse. */
  onPost: () => Promise<boolean>;
  onAttachImage?: (uri: string, mimeType?: string | null) => Promise<void>;
  onSendAudioMarkdown?: (markdown: string) => Promise<void>;
  /** Editing an existing post keeps the composer open and swaps the action. */
  editing?: { id: string; text: string } | null;
  onCancelEdit?: () => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  // "Edit post" from a card's ⋯ opens the composer with the body loaded.
  const isOpen = expanded || !!editing;
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const pillRef = useRef<View>(null);

  // §9: collapsing returns screen-reader focus to the pill it came from.
  const collapse = useCallback(() => {
    setExpanded(false);
    setSubjectError(null);
    onCancelEdit?.();
    requestAnimationFrame(() => {
      const node = findNodeHandle(pillRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, [onCancelEdit]);

  const handlePost = useCallback(async () => {
    const validated = validateBoardSubject(subject);
    if (validated.error) {
      setSubjectError(validated.error);
      return;
    }
    setSubjectError(null);
    const posted = await onPost();
    if (posted) collapse();
  }, [subject, onPost, collapse]);

  if (!isOpen) {
    return (
      <View className="flex-row items-center border-t border-lantern-border bg-lantern-background px-3 py-2">
        <Pressable
          ref={pillRef}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={COMMUNITY_BOARD_COPY.composerPlaceholder}
          accessibilityState={{ expanded: false }}
          className="flex-1 min-h-[44px] flex-row items-center rounded-full border border-lantern-border bg-lantern-surface px-3 active:opacity-90"
        >
          <ResolvedAvatar
            name={authorName}
            uri={resolveAvatarSrc(avatarUrl, lowDataMode)}
            size={24}
            decorative
          />
          <Text className="ml-2 flex-1 text-sm text-lantern-text-tertiary" numberOfLines={1}>
            {COMMUNITY_BOARD_COPY.composerPlaceholder}
          </Text>
          <Ionicons name="camera-outline" size={18} color="#94a3b8" />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="border-t border-lantern-border bg-lantern-background">
      <View className="flex-row items-center px-3 pt-2">
        {editing ? null : (
        <TextInput
          value={subject}
          onChangeText={(next) => {
            setSubjectError(null);
            onChangeSubject(next);
          }}
          placeholder={COMMUNITY_BOARD_COPY.subjectPlaceholder}
          placeholderTextColor={colors.inputPlaceholder}
          maxLength={BOARD_POST_SUBJECT_MAX}
          accessibilityLabel={COMMUNITY_BOARD_COPY.subjectPlaceholder}
          className="flex-1 min-h-[44px] rounded-2xl border border-lantern-border bg-lantern-surface px-3 text-sm font-semibold text-lantern-text"
          style={{ borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }}
        />
        )}
        {editing ? (
          <Text className="flex-1 text-xs font-semibold text-lantern-text-secondary">
            {COMMUNITY_BOARD_COPY.editPost}
          </Text>
        ) : null}
        <Pressable
          onPress={collapse}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close the composer"
          className="ml-1 min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Ionicons name="close" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      {subjectError ? (
        <Text className="px-4 pt-1 text-xs text-lantern-error">{subjectError}</Text>
      ) : null}

      <ChatComposer
        value={text}
        onChangeText={onChangeText}
        onSend={() => void handlePost()}
        sending={sending}
        placeholder={COMMUNITY_BOARD_COPY.composerPlaceholder}
        groupId={groupId}
        editingMessage={editing ?? null}
        onCancelEdit={collapse}
        mentionCandidates={mentionCandidates}
        onAttachImage={onAttachImage}
        onSendAudioMarkdown={onSendAudioMarkdown}
      />
    </View>
  );
}

export default BoardComposer;
