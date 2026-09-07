/**
 * The one question asked between stopping and transcribing.
 *
 * A lecture recorded from the Record door lands in the library as
 * "Lecture — 6 Sep", which is fine for one and useless for twelve. The cheapest
 * moment to fix that is the moment the student just put the phone down and
 * still remembers what the lecture was, and it costs one tap to skip: the
 * field is prefilled and the button keeps whatever is in it.
 *
 * It renders from the sticky banner rather than from the editor, because the
 * student may have stopped the recording from any screen in the app.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { useTheme } from '../../theme';
import { Body, Caption, Heading } from '../ui/Text';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { MAX_LECTURE_TITLE_LENGTH } from './lecturePreflight';

export function LectureTitleSheet() {
  const { colors } = useTheme();
  const status = useLectureRecordingStore((s) => s.status);
  const suggestion = useLectureRecordingStore((s) => s.pendingTitleSuggestion);
  const confirm = useLectureRecordingStore((s) => s.confirmTitleAndTranscribe);
  const discard = useLectureRecordingStore((s) => s.discard);
  const [value, setValue] = useState('');

  const open = status === 'naming';

  // Refill each time the sheet opens; the suggestion is computed at stop.
  useEffect(() => {
    if (open) setValue(suggestion || '');
  }, [open, suggestion]);

  if (!open) return null;

  // The only two ways out are the two buttons. A back press must neither
  // spend an AI use nor drop the file, so it leaves the sheet where it is.
  const keepSheetOpen = () => {};

  const confirmDiscard = () => {
    Alert.alert('Discard this recording?', 'The audio will be deleted. Nothing has been spent.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discard() },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={keepSheetOpen}>
      <View className="flex-1 justify-end" style={{ backgroundColor: colors.modalOverlay }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            className="rounded-t-lantern-xl p-5 gap-3"
            style={{ backgroundColor: colors.modalBackground }}
          >
            <Heading>Name this lecture</Heading>
            <Caption tone="secondary">
              Keep the date, or type what it was. Transcribing starts next.
            </Caption>
            <TextInput
              value={value}
              onChangeText={setValue}
              maxLength={MAX_LECTURE_TITLE_LENGTH}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={() => void confirm(value)}
              placeholder={suggestion || 'Lecture'}
              placeholderTextColor={colors.inputPlaceholder}
              className="rounded-lantern-md px-3 py-3"
              style={{
                backgroundColor: colors.inputBackground,
                borderWidth: 1,
                borderColor: colors.inputBorder,
                color: colors.inputText,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void confirm(value)}
              className="rounded-lantern-md py-3 items-center active:opacity-80"
              style={{ backgroundColor: colors.primaryFill }}
            >
              {/* The price on the button, through the one helper every
                  other button uses — never a hand-typed number. */}
              <Body style={{ color: colors.textInverse, fontWeight: '700' }}>
                {`Save and transcribe · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
              </Body>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={confirmDiscard}
              className="py-2 items-center active:opacity-70"
            >
              <Caption tone="secondary">Discard this recording</Caption>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default LectureTitleSheet;
