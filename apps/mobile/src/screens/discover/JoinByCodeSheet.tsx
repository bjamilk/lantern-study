/**
 * "Join with a code" — the sheet.
 *
 * Reachable from the Communities segment and from the deep link
 * `lanternstudy://discover/join/<code>`; this is what a student types into
 * when they have the code but not the link.
 *
 * It now REDEEMS a real one-time code (`POST /communities/join-by-code`),
 * which joins the community — including a private one, which no other door on
 * the phone can open. A pasted community LINK still resolves instead of
 * joining: opening a public room the reader has not agreed to join is the
 * community page's decision, not this sheet's.
 *
 * The order is code → link, and the reasons are in `joinByCodeModel.ts`. Every
 * refused code answers ONE sentence (`INVITE_REFUSAL_COPY`) so this sheet
 * cannot become an oracle for which codes are real, and a pre-migration API's
 * 503 reads "Not switched on for this campus yet" rather than a raw error.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { AppIcon } from '../../components/ui/AppIcon';
import { isNotEnabledError } from '@lantern/shared/api';
import { useCommunityStore } from '../../stores/communityStore';
import { joinCommunityByCode } from '../../services/api';
import {
  JOIN_BY_CODE_HINT,
  JOIN_BY_CODE_TITLE,
  joinByCodeFailureCopy,
  planJoinByCode,
} from './joinByCodeModel';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * The community the code named. `joined` is true when the code was redeemed
   * — the caller refreshes its membership list before opening the room.
   */
  onResolved: (slug: string, joined: boolean) => void;
  /** Prefilled by the deep link when it could not resolve on its own. */
  initialCode?: string;
}

export function JoinByCodeSheet({ visible, onClose, onResolved, initialCode }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const invalidate = useCommunityStore((s) => s.invalidate);
  const [value, setValue] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A second deep link while the sheet is open must replace what is in the
  // box, not sit behind it.
  useEffect(() => {
    if (visible) {
      setValue(initialCode ?? '');
      setError(null);
    }
  }, [visible, initialCode]);

  const submit = useCallback(async () => {
    const plan = planJoinByCode(value);
    if (plan.error) {
      setError(plan.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /**
       * What the CODE path answered, kept across the slug fallback. Every
       * bare 8-character code lowercases into a legal slug, so `plan.slug` is
       * set for every code a student types — which means the fallback always
       * runs, and without this the pre-migration 503 ("not switched on yet")
       * would be overwritten by the slug lookup's 404 and read as "that
       * invite is not valid", blaming the code for a database that has not
       * been migrated.
       */
      let codeError: unknown = null;
      // 1. A one-time code, redeemed. This is the only door into a private
      //    community, so it is tried first whenever the input could be one.
      if (plan.code) {
        try {
          const joined = await joinCommunityByCode(plan.code);
          // The membership the redemption just created invalidates whatever
          // this device holds for the room.
          invalidate(joined.communityId);
          onResolved(joined.slug, true);
          return;
        } catch (err) {
          codeError = err;
          // An ambiguous string (`abcd2345` is a legal code AND a legal slug)
          // still deserves the link lookup before the student is refused.
          if (!plan.slug) {
            setError(joinByCodeFailureCopy(codeError, true));
            return;
          }
        }
      }
      // 2. A community link, resolved — never joined.
      if (plan.slug) {
        try {
          const community = await loadCommunity(plan.slug);
          onResolved(community.slug, false);
          return;
        } catch (slugError) {
          // Unknown and private answer identically: the sheet must not confirm
          // that a private room exists. A NOT_ENABLED answer from the code
          // path wins over the slug 404, because it is the truer sentence.
          setError(
            joinByCodeFailureCopy(
              isNotEnabledError(codeError) ? codeError : slugError,
              !!plan.code
            )
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }, [value, loadCommunity, invalidate, onResolved]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/40"
      />
      <View
        style={{ paddingBottom: insets.bottom + 16, backgroundColor: colors.surface }}
        className="rounded-t-3xl px-4 pt-4"
      >
        <View className="flex-row items-center gap-3 mb-2">
          <AppIcon name="link" size={20} color={colors.textSecondary} />
          <Text className="flex-1 text-title font-bold text-lantern-text">{JOIN_BY_CODE_TITLE}</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ minHeight: 44, minWidth: 44 }}
            className="items-end justify-center"
          >
            <AppIcon name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Text className="text-body text-lantern-text-secondary mb-3">{JOIN_BY_CODE_HINT}</Text>
        <TextInput
          value={value}
          onChangeText={(text) => {
            setValue(text);
            if (error) setError(null);
          }}
          onSubmitEditing={() => void submit()}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          placeholder="ABCD2345"
          placeholderTextColor={colors.inputPlaceholder}
          accessibilityLabel="Invite code or community link"
          style={{ minHeight: 48 }}
          className="rounded-2xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
        />
        {error ? (
          <Text className="mt-2 text-caption text-lantern-error" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void submit()}
          disabled={busy || !value.trim()}
          accessibilityRole="button"
          accessibilityLabel="Join"
          accessibilityState={{ disabled: busy || !value.trim(), busy }}
          style={{ minHeight: 48, backgroundColor: colors.primaryFill }}
          className={`mt-4 flex-row items-center justify-center rounded-2xl px-4 ${
            busy || !value.trim() ? 'opacity-50' : ''
          }`}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text className="text-body font-semibold text-white">Join</Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

export default JoinByCodeSheet;
