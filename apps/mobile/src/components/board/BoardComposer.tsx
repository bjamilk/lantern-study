import React, { useCallback, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native';
import {
  BOARD_POST_SUBJECT_MAX,
  COMMUNITY_BOARD_COPY,
  validateBoardSubject,
} from '@lantern/shared/network';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { ChatComposer, type MentionCandidate } from '../chat/ChatComposer';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';

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
  attachedImageUrl,
  attachingImage,
  onRemoveAttachedImage,
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
  /**
   * Picks and UPLOADS one photo, then parks its url in composer state — it
   * does NOT send anything. That is the whole point of §5: attaching used to
   * post the photo as its own separate message
   * (`useChatImageAttach` -> `sendMediaMarkdown` -> `postToBoard`), so a title,
   * a body and a photo could never be one row.
   */
  onAttachImage?: (uri: string, mimeType?: string | null) => Promise<void>;
  /** The uploaded photo waiting to be posted with the text. One slot, never four. */
  attachedImageUrl?: string | null;
  /** The upload is in flight; it overlaps with typing rather than blocking it. */
  attachingImage?: boolean;
  onRemoveAttachedImage?: () => void;
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

  /**
   * A photo alone is a post. `ChatComposer` disables Send on empty text
   * (correct for a chat bubble), so the attachment gets its own Post control
   * rather than leaving the student with an attached photo and no way to send
   * it. It is also the visible confirmation that the upload finished.
   */
  const canPostPhotoOnly = !!attachedImageUrl && !text.trim() && !editing;

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
          <AppIcon name="camera" size={18} color="#94a3b8" />
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
          <AppIcon name="close" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      {subjectError ? (
        <Text className="px-4 pt-1 text-xs text-lantern-error">{subjectError}</Text>
      ) : null}

      {/* ONE attachment slot. Multi-image is deliberately out of scope:
          `messages.image_url` is one column and `IMAGE_MARKDOWN_RE` is
          non-global, so a second photo is a migration, not a prop. */}
      {attachingImage || attachedImageUrl ? (
        <View className="mx-3 mt-2 flex-row items-center rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-1.5">
          {attachingImage ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <AppIcon name="image" size={16} color={colors.primary} />
          )}
          <Text
            accessibilityLiveRegion="polite"
            className="ml-2 flex-1 text-[12px] text-lantern-text-secondary"
            numberOfLines={1}
          >
            {attachingImage ? COMMUNITY_BOARD_COPY.posting : COMMUNITY_BOARD_COPY.photoAttached}
          </Text>
          {attachedImageUrl && onRemoveAttachedImage ? (
            <Pressable
              onPress={onRemoveAttachedImage}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.removePhoto}
              className="ml-1 min-h-[44px] min-w-[44px] items-center justify-center -mr-2"
            >
              <AppIcon name="close-circle" size={20} color="#94a3b8" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {canPostPhotoOnly ? (
        <Pressable
          onPress={() => void handlePost()}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={COMMUNITY_BOARD_COPY.post}
          accessibilityState={{ disabled: sending, busy: sending }}
          className="mx-3 mt-2 min-h-[44px] items-center justify-center rounded-2xl bg-lantern-primary"
          style={{ opacity: sending ? 0.6 : 1 }}
        >
          <Text className="text-sm font-semibold text-white">
            {sending ? COMMUNITY_BOARD_COPY.posting : COMMUNITY_BOARD_COPY.post}
          </Text>
        </Pressable>
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
        // Editing a post must not offer a second photo: the edit endpoint
        // updates `text` and `edited_at` only and never touches `image_url`,
        // so an attachment picked here would be silently discarded.
        onAttachImage={editing ? undefined : onAttachImage}
        onSendAudioMarkdown={onSendAudioMarkdown}
      />
    </View>
  );
}

export default BoardComposer;
