import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BOARD_REPOST_QUOTE_MAX,
  COMMUNITY_BOARD_COPY,
  boardQuoteSnippet,
} from '@lantern/shared/network';
import { useTheme } from '../../theme';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../chat/composerKeyboardBehavior';
import { AppIcon } from '../ui/AppIcon';

/**
 * Repost, with an optional comment (§6).
 *
 * A repost is a BUMP: the post comes back to the top of the SAME board with
 * the reposter's name above it and the original author preserved. There is no
 * follow graph here and every board member already sees every post, so
 * "repost into my feed" has no meaning — but "this exam-week timetable from
 * three weeks ago is still the one" does.
 *
 * The preview is `boardQuoteSnippet`, the same strip web uses, so a signed
 * media URL from the original body can never appear in this sheet.
 */
export function BoardRepostSheet({
  visible,
  authorName,
  subject,
  body,
  reposted,
  busy,
  onRepost,
  onUndo,
  onClose,
}: {
  visible: boolean;
  authorName: string;
  subject?: string | null;
  body?: string | null;
  /** Already reposted by the viewer: the sheet offers Undo instead. */
  reposted: boolean;
  busy: boolean;
  onRepost: (quote: string) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [quote, setQuote] = useState('');

  // A quote typed for one post must never arrive on the next one.
  useEffect(() => {
    if (!visible) setQuote('');
  }, [visible]);

  const snippet = boardQuoteSnippet(body);
  const remaining = BOARD_REPOST_QUOTE_MAX - quote.length;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <KeyboardAvoidingView behavior={COMPOSER_KEYBOARD_BEHAVIOR}>
          <Pressable
            accessibilityViewIsModal
            accessibilityLabel={COMMUNITY_BOARD_COPY.repost}
            onPress={(e) => e.stopPropagation?.()}
            className="rounded-t-3xl bg-lantern-surface px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 20 }}
          >
            <View className="flex-row items-center">
              <Text
                accessibilityRole="header"
                className="flex-1 text-lg font-bold text-lantern-text"
              >
                {reposted ? COMMUNITY_BOARD_COPY.undoRepost : COMMUNITY_BOARD_COPY.repost}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2"
              >
                <AppIcon name="close" size={20} color="#94a3b8" />
              </Pressable>
            </View>

            <View className="mt-3 rounded-xl border border-lantern-border px-3 py-2">
              <Text className="text-[12px] font-semibold text-lantern-text" numberOfLines={1}>
                {authorName}
              </Text>
              {subject ? (
                <Text className="mt-0.5 text-[13px] font-bold text-lantern-text" numberOfLines={2}>
                  {subject}
                </Text>
              ) : null}
              {snippet ? (
                <Text className="mt-0.5 text-[13px] text-lantern-text-secondary" numberOfLines={3}>
                  {snippet}
                </Text>
              ) : null}
            </View>

            {reposted ? (
              <Pressable
                onPress={onUndo}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={COMMUNITY_BOARD_COPY.undoRepost}
                accessibilityState={{ disabled: busy, busy }}
                className="mt-4 min-h-[44px] items-center justify-center rounded-2xl border border-lantern-border"
              >
                {busy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text className="text-sm font-semibold text-lantern-error">
                    {COMMUNITY_BOARD_COPY.undoRepost}
                  </Text>
                )}
              </Pressable>
            ) : (
              <>
                <TextInput
                  value={quote}
                  onChangeText={setQuote}
                  placeholder={COMMUNITY_BOARD_COPY.repostQuotePlaceholder}
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  maxLength={BOARD_REPOST_QUOTE_MAX}
                  accessibilityLabel={COMMUNITY_BOARD_COPY.repostQuotePlaceholder}
                  className="mt-3 min-h-[44px] rounded-2xl border border-lantern-border px-3 py-2 text-sm text-lantern-text"
                  style={{
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                {/* Announced as text, not as a colour change on the counter. */}
                <Text className="mt-1 text-[11px] text-lantern-text-tertiary">
                  {`${remaining} characters left`}
                </Text>
                <Pressable
                  onPress={() => onRepost(quote)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={COMMUNITY_BOARD_COPY.repost}
                  accessibilityState={{ disabled: busy, busy }}
                  className="mt-3 min-h-[44px] items-center justify-center rounded-2xl bg-lantern-primary"
                  style={{ opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">
                      {COMMUNITY_BOARD_COPY.repost}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

export default BoardRepostSheet;
