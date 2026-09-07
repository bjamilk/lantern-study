/**
 * Import cards — the zero-credit door.
 *
 * Paste a Quizlet or Anki export, or pick the file. It is parsed on the phone
 * (no request, no AI use), the student sees what was read before anything is
 * written, names the deck, and saves. If there is no signal the deck is held
 * on the device and queued whole — and the sheet says exactly that rather than
 * "Saved!".
 *
 * Every decision in here is in importCardsMachine.ts; this file is the
 * rendering and the two side effects (pick a file, save).
 */
import React, { useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { saveImportedDeck } from '../../services/importedDeck';
import { Button, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc, smallTextInk, useFeatureAccent } from '../ui/FeatureDisc';
import { planBottomSheetKeyboard } from '../ui/bottomSheetKeyboard';
import { useKeyboardOverlap } from '../ui/useKeyboardOverlap';
import { planImportSheetLayout } from './importSheetLayout';
import {
  INITIAL_IMPORT_STATE,
  canSave,
  cardsToSave,
  importCardsReducer,
  outcomeMessage,
  overflowNotice,
  previewCards,
  summaryLine,
} from './importCardsMachine';

export interface ImportCardsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the deck the import produced, so the caller can open it. */
  onImported?: (result: { deckId: string; deckName: string; queued: boolean }) => void;
}

const PLACEHOLDER =
  'Paste your export here.\n\nTerm\tDefinition\nTerm\tDefinition\n\nOne card per line, with a tab or a comma between the two sides.';

export default function ImportCardsSheet({ visible, onClose, onImported }: ImportCardsSheetProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // A DEFINITE height, not a percentage max-height. A percentage leaves the
  // wrapper's main size indefinite, the body ScrollView's flex:1 resolves to
  // zero, and overflow-hidden clips the whole sheet down to its header — which
  // is what the device measured (163px, header only). Arithmetic in
  // importSheetLayout.ts so it is tested.
  const sheet = planImportSheetLayout({
    windowHeight,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  // What the keyboard does to that resting height — and, the point of the
  // rule, what it gives back. A KeyboardAvoidingView used to own this, and on
  // Android it never released its padding: RN feeds `keyboardDidHide` through
  // the same handler as the show event and recomputes the padding from the hide
  // frame, which inside a transparent statusBarTranslucent Modal under
  // edge-to-edge is the window minus the gesture bar. The sibling generate sheet
  // was left pinned under the status bar with an untappable close X that way
  // (build 171). `frame` is the resting geometry whenever the overlap is 0, and
  // the overlap is 0 on every hide path — BACK, tap-away, the done key.
  const keyboardOverlap = useKeyboardOverlap(visible);
  const frame = planBottomSheetKeyboard({
    windowHeight,
    restingHeight: sheet.height,
    keyboardOverlap,
    topInset: insets.top,
  });
  const accent = useFeatureAccent('flashcards');
  const eyebrowInk = smallTextInk('flashcards', accent, isDark);
  const user = useAuthStore((s) => s.user);

  const [state, dispatch] = useReducer(importCardsReducer, INITIAL_IMPORT_STATE);
  const [picking, setPicking] = useState(false);

  const summary = useMemo(() => summaryLine(state), [state]);
  const overflow = useMemo(() => overflowNotice(state), [state]);
  const preview = useMemo(() => previewCards(state), [state]);
  const saving = state.stage === 'saving';
  const finished = state.stage === 'saved' || state.stage === 'queued';

  const close = () => {
    dispatch({ type: 'reset' });
    setPicking(false);
    onClose();
  };

  const handlePickFile = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['text/plain', 'text/csv', 'text/tab-separated-values', 'text/*', '*/*'],
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const text = await FileSystem.readAsStringAsync(asset.uri);
      dispatch({ type: 'file_picked', text, fileName: asset.name ?? 'Imported cards' });
      dispatch({ type: 'parse' });
    } catch {
      // The picker's or file system's own wording is no use to a student, so
      // it is not repeated here.
      dispatch({
        type: 'save_failed',
        message: "We couldn't read that file. Try a .txt, .csv or .tsv export.",
      });
    } finally {
      setPicking(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) {
      dispatch({ type: 'save_failed', message: 'Sign in to save an imported deck.' });
      return;
    }
    dispatch({ type: 'save_started' });
    try {
      const result = await saveImportedDeck({
        userId: user.id,
        deckName: state.deckName.trim(),
        cards: cardsToSave(state),
        description: 'Imported from a Quizlet or Anki export',
      });
      dispatch({
        type: 'save_succeeded',
        outcome: { kind: result.kind, count: result.count, deckName: result.deckName },
      });
      onImported?.({
        deckId: result.deckId,
        deckName: result.deckName,
        queued: result.kind === 'queued',
      });
    } catch (error) {
      dispatch({
        type: 'save_failed',
        message:
          error instanceof Error ? error.message : "We couldn't save these cards. Please try again.",
      });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/50" style={{ paddingBottom: frame.liftBy }}>
        <View
          className="rounded-t-3xl bg-lantern-surface overflow-hidden"
          style={{ height: frame.height }}
        >
          <View className="shrink-0 flex-row items-center gap-3 px-4 py-3 border-b border-lantern-border">
            <FeatureDisc feature="flashcards" icon="layers" size={32} />
            <View className="flex-1">
              <T.Heading>Import cards</T.Heading>
              <T.Label style={{ color: eyebrowInk }}>FREE — QUIZLET OR ANKI EXPORT</T.Label>
            </View>
            {/* The hit area is part of the header, so it moves with the sheet
                and never has to be aimed at where the sheet used to be. */}
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <AppIcon name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              padding: 16,
              // With the sheet lifted, the gesture bar is behind the keyboard:
              // paying its inset too would strand the last control in a gap.
              paddingBottom: frame.liftBy > 0 ? 24 : sheet.contentPaddingBottom,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {finished && state.outcome ? (
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <AppIcon
                    name={state.outcome.kind === 'saved' ? 'checkmark-circle' : 'cloud-offline'}
                    size={20}
                    color={state.outcome.kind === 'saved' ? colors.success : colors.textSecondary}
                  />
                  <T.Heading>
                    {state.outcome.kind === 'saved' ? 'Imported' : 'Saved on this phone'}
                  </T.Heading>
                </View>
                <T.Body tone="secondary">{outcomeMessage(state.outcome)}</T.Body>
                <Button className="mt-4" fullWidth onPress={close}>
                  Done
                </Button>
              </View>
            ) : (
              <>
                <T.Body tone="secondary">
                  Cards you already have, brought in as they are. No AI, nothing spent, works offline.
                </T.Body>

                <View className="flex-row gap-2 mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={picking}
                    onPress={() => void handlePickFile()}
                  >
                    Choose a file
                  </Button>
                  <View className="flex-1 justify-center">
                    <T.Caption tone="tertiary">.txt, .csv or .tsv</T.Caption>
                  </View>
                </View>

                <T.Label tone="secondary" className="mt-4 mb-1">
                  YOUR EXPORT
                </T.Label>
                <TextInput
                  value={state.text}
                  onChangeText={(text) => dispatch({ type: 'text_changed', text })}
                  placeholder={PLACEHOLDER}
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  textAlignVertical="top"
                  editable={!saving}
                  className="rounded-2xl border border-lantern-border bg-lantern-background px-3 py-3 text-lantern-text"
                  style={{ minHeight: 140 }}
                />

                {state.stage === 'input' ? (
                  <Button
                    className="mt-3"
                    fullWidth
                    disabled={!state.text.trim()}
                    onPress={() => dispatch({ type: 'parse' })}
                  >
                    Read my cards
                  </Button>
                ) : null}

                {state.parsed ? (
                  <View className="mt-4">
                    <T.Heading>{summary}</T.Heading>
                    {overflow ? (
                      <T.Caption tone="secondary" className="mt-1">
                        {overflow}
                      </T.Caption>
                    ) : null}

                    {preview.map((card, index) => (
                      <View
                        key={`${card.front}-${index}`}
                        className="mt-2 rounded-2xl border border-lantern-border bg-lantern-background px-3 py-2"
                      >
                        <T.Body numberOfLines={2}>{card.front}</T.Body>
                        <T.Caption tone="secondary" numberOfLines={2}>
                          {card.back}
                        </T.Caption>
                      </View>
                    ))}

                    {cardsToSave(state).length > preview.length ? (
                      <T.Caption tone="tertiary" className="mt-2">
                        …and {cardsToSave(state).length - preview.length} more.
                      </T.Caption>
                    ) : null}

                    <T.Label tone="secondary" className="mt-4 mb-1">
                      DECK NAME
                    </T.Label>
                    <TextInput
                      value={state.deckName}
                      onChangeText={(name) => dispatch({ type: 'deck_name_changed', name })}
                      placeholder="Name this deck"
                      placeholderTextColor={colors.inputPlaceholder}
                      editable={!saving}
                      maxLength={100}
                      className="rounded-2xl border border-lantern-border bg-lantern-background px-3 py-3 text-lantern-text"
                    />
                  </View>
                ) : null}

                {state.error ? (
                  <View className="mt-3 rounded-2xl px-3 py-2" style={{ backgroundColor: colors.errorBackground }}>
                    <T.Caption style={{ color: colors.error }}>{state.error}</T.Caption>
                  </View>
                ) : null}

                {state.parsed ? (
                  <View className="flex-row gap-2 mt-4">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      disabled={saving}
                      onPress={() => dispatch({ type: 'edit_source' })}
                    >
                      Edit
                    </Button>
                    <Button
                      className="flex-1"
                      loading={saving}
                      disabled={!canSave(state)}
                      onPress={() => void handleSave()}
                    >
                      {state.stage === 'failed' ? 'Try again' : 'Add to my library'}
                    </Button>
                  </View>
                ) : null}

                {saving ? (
                  <View className="flex-row items-center gap-2 mt-3">
                    <ActivityIndicator size="small" color={colors.primaryText} />
                    <T.Caption tone="secondary">Saving {cardsToSave(state).length} cards…</T.Caption>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
