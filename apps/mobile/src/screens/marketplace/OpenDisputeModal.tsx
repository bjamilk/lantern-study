import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_REASON_MAX,
  type DisputeCategory,
} from '@lantern/shared/network';

/**
 * Open a dispute on an order (Phase 3 · N) — the mobile counterpart of the web
 * OpenDisputeModal.
 *
 * This replaces an `Alert.prompt` flow that was iOS-only. Android is the ONLY
 * platform currently shipping a build, so that flow meant no Android user could
 * ever type a dispute reason — they got the category label echoed back as the
 * "reason", making the free-text field useless for support triage and making
 * dispute_reason a duplicate of dispute_category.
 *
 * Both clients now collect the same thing: a category (so support can triage
 * without reading every note) and free text, with the payout warning stated up
 * front rather than discovered afterwards.
 */
export interface OpenDisputeModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: { disputeCategory: DisputeCategory; disputeReason: string }) => Promise<void>;
  listingTitle?: string;
  /**
   * The category labels are buyer-voiced ("I never received it"). A seller
   * opening a dispute must not be pre-filled with a claim they are not making,
   * so they start on "Something else" and choose deliberately.
   */
  viewerIsSeller?: boolean;
}

export function OpenDisputeModal({
  visible,
  onClose,
  onSubmit,
  listingTitle,
  viewerIsSeller = false,
}: OpenDisputeModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const defaultCategory: DisputeCategory = viewerIsSeller ? 'other' : 'not_received';
  const [category, setCategory] = useState<DisputeCategory>(defaultCategory);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCategory(defaultCategory);
    setReason('');
    setError(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Tell us what went wrong so we can help.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        disputeCategory: category,
        disputeReason: trimmed.slice(0, DISPUTE_REASON_MAX),
      });
      reset();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open the dispute');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && reason.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '88%',
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Ionicons name="warning-outline" size={20} color="#f59e0b" />
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.text }}>
              Report a problem
            </Text>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>
              {listingTitle ? `For “${listingTitle}”. ` : ''}
              Our team will review it. The seller&apos;s payout is held until it&apos;s resolved.
            </Text>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                What went wrong?
              </Text>
              <View style={{ gap: 8 }}>
                {DISPUTE_CATEGORIES.map((value) => {
                  const selected = category === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setCategory(value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={DISPUTE_CATEGORY_LABELS[value]}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary + '14' : 'transparent',
                      }}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={selected ? colors.primary : colors.textTertiary}
                      />
                      <Text
                        style={{
                          flex: 1,
                          fontSize: 14,
                          fontWeight: selected ? '600' : '400',
                          color: colors.text,
                        }}
                      >
                        {DISPUTE_CATEGORY_LABELS[value]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Tell us more</Text>
              <TextInput
                value={reason}
                onChangeText={(t) => setReason(t.slice(0, DISPUTE_REASON_MAX))}
                multiline
                numberOfLines={4}
                maxLength={DISPUTE_REASON_MAX}
                placeholder="What happened, and what would resolve it?"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Describe what went wrong"
                style={{
                  borderWidth: 1,
                  borderColor: error && !reason.trim() ? '#ef4444' : colors.border,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.text,
                  minHeight: 96,
                  textAlignVertical: 'top',
                }}
              />
              <Text style={{ fontSize: 11, color: colors.textTertiary, textAlign: 'right' }}>
                {reason.length}/{DISPUTE_REASON_MAX}
              </Text>
            </View>

            {error ? (
              <Text style={{ fontSize: 13, color: '#ef4444' }} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </ScrollView>

          <View
            style={{
              flexDirection: 'row',
              gap: 10,
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              onPress={close}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void submit()}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Open dispute"
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: canSubmit ? '#f59e0b' : '#f59e0b66',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                {busy ? 'Opening…' : 'Open dispute'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default OpenDisputeModal;
