/**
 * Report… sheet shared by every mobile entry point (Phase 1 · E, contract §5):
 * listing detail, seller profile, DM header, group message long-press, group
 * info, shared notes. Reasons come from `reasonsForTarget` so the picker and
 * the API's validation can never disagree; a 409 (already reported by this
 * user) is shown as a friendly notice instead of an error.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../chat/composerKeyboardBehavior';
import React, { useEffect, useMemo, useState } from 'react';
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
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASON_LABELS,
  reasonsForTarget,
} from '@lantern/shared/moderation';
import type { ContentReportReason, ContentReportTargetType } from '@lantern/shared/types';
import { reportContent } from '../../services/api';
import { Button } from '../ui';
import { useTheme } from '../../theme';
import { describeReportError, isAlreadyReportedError } from './reportErrors';

export interface ReportContentSheetProps {
  visible: boolean;
  targetType: ContentReportTargetType;
  targetId: string;
  /** Shown under the title so the reporter knows what they are reporting. */
  targetLabel?: string;
  onClose: () => void;
  /** Called after a successful submission (the sheet closes itself). */
  onSubmitted?: (result: { id: string }) => void;
}

const TITLE_BY_TARGET: Record<ContentReportTargetType, string> = {
  listing: 'Report listing',
  question_bank: 'Report question bank',
  note: 'Report note',
  deck: 'Report deck',
  user: 'Report user',
  group: 'Report group',
  message: 'Report message',
  dm_message: 'Report message',
  job_posting: 'Report job posting',
};

export function ReportContentSheet({
  visible,
  targetType,
  targetId,
  targetLabel,
  onClose,
  onSubmitted,
}: ReportContentSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reasons = useMemo(() => reasonsForTarget(targetType), [targetType]);
  const [reason, setReason] = useState<ContentReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'submitted' | 'duplicate' | null>(null);

  // Fresh form every time the sheet opens (or the target changes).
  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setBusy(false);
    setError(null);
    setDone(null);
  }, [visible, targetType, targetId]);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reportContent({
        targetType,
        targetId,
        reason,
        details: details.trim() ? details.trim().slice(0, REPORT_DETAILS_MAX_LENGTH) : undefined,
      });
      setDone('submitted');
      onSubmitted?.({ id: result.id });
    } catch (e: unknown) {
      if (isAlreadyReportedError(e)) {
        setDone('duplicate');
      } else {
        setError(describeReportError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
          <Pressable
            accessibilityViewIsModal
            onPress={(e) => e.stopPropagation?.()}
            className="bg-lantern-surface rounded-t-3xl pt-4 max-h-[88%]"
            style={{ paddingBottom: insets.bottom + 32 }}
          >
            <View className="flex-row items-center px-5 mb-1">
              <Ionicons name="flag-outline" size={18} color={colors.warning} />
              <Text className="text-lg font-bold text-lantern-text ml-2 flex-1" accessibilityRole="header">
                {TITLE_BY_TARGET[targetType]}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            {targetLabel ? (
              <Text className="px-5 text-xs text-lantern-text-secondary mb-2" numberOfLines={2}>
                {targetLabel}
              </Text>
            ) : null}

            {done ? (
              <View className="px-5 pt-3">
                <View
                  className={`rounded-xl p-4 ${
                    done === 'submitted'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40'
                      : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700'
                  }`}
                >
                  <Text className="text-sm font-semibold text-lantern-text">
                    {done === 'submitted' ? 'Report submitted' : 'You already reported this'}
                  </Text>
                  <Text className="text-sm text-lantern-text-secondary mt-1">
                    {done === 'submitted'
                      ? 'Thank you. Our team will review it and take action if it breaks the rules.'
                      : 'We already have your report on this. Our team will review it.'}
                  </Text>
                </View>
                <Button fullWidth className="mt-4" onPress={onClose}>
                  Done
                </Button>
              </View>
            ) : (
              <ScrollView
                className="px-5"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary mt-2 mb-2">
                  Why are you reporting this?
                </Text>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {reasons.map((r) => {
                    const selected = reason === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => setReason(r)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        className={`px-3 py-1.5 rounded-full border ${
                          selected ? 'bg-red-600 border-red-600' : 'border-lantern-border'
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            selected ? 'text-white' : 'text-lantern-text-secondary'
                          }`}
                        >
                          {REPORT_REASON_LABELS[r]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-2">
                  Details (optional)
                </Text>
                <TextInput
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Anything that helps our team understand the problem"
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  maxLength={REPORT_DETAILS_MAX_LENGTH}
                  textAlignVertical="top"
                  className="min-h-[84px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-1"
                />
                <Text className="text-[11px] text-lantern-text-tertiary text-right mb-3">
                  {details.length}/{REPORT_DETAILS_MAX_LENGTH}
                </Text>
                {error ? <Text className="text-sm text-red-500 mb-3">{error}</Text> : null}
                <View className="flex-row gap-3 mb-2">
                  <Button variant="secondary" className="flex-1" onPress={onClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1"
                    loading={busy}
                    disabled={!reason}
                    onPress={() => void submit()}
                  >
                    Submit report
                  </Button>
                </View>
                <Text className="text-[11px] text-lantern-text-tertiary mb-2">
                  Reports are confidential. False reports may count against your account.
                </Text>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default ReportContentSheet;
