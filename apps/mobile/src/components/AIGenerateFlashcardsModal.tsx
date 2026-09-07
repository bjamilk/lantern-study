// ===========================================
// Lantern Study Mobile — Generate flashcards: the options sheet
// ===========================================
/**
 * Wave 5. The sheet a student sees BEFORE spending an AI use: how many cards,
 * what kind, what one of them will look like, and what it costs — one number,
 * printed from the same constant the server charges from.
 *
 * Every decision here comes from
 * `@lantern/shared/flashcards/generationOptions`: the presets, the mix rule,
 * the request body and the price. Nothing about what a run costs or produces
 * is re-derived on this screen, because a screen that computes its own price
 * is a screen that can disagree with the meter.
 *
 * The preview is a SHAPE, not a generation: it is built on the device from the
 * source's first heading or sentence, so nothing has been requested and
 * nothing has been spent when it appears.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../theme';
import { useAIHandlers } from '../hooks/useAIHandlers';
import AIUsageBadge from './AIUsageBadge';
import { AIDisclaimer } from './AIDisclaimer';
import { aiGenerateFlashcards, type AIGeneratedFlashcard } from '../services/ai';
import { trackAIToolUsed } from '../services/productAnalytics';
import { useAuthStore } from '../stores/authStore';
import { useJobsStore } from '../stores/jobsStore';
import { saveGeneratedDeck } from '../services/jobArtifacts';
import { AppIcon } from './ui/AppIcon';
import { T } from './ui';
import { planBottomSheetKeyboard } from './ui/bottomSheetKeyboard';
import { useKeyboardOverlap } from './ui/useKeyboardOverlap';
import {
  FLASHCARD_COUNT_PRESETS,
  describeGenerationPlan,
  planGenerationRequest,
  previewCard,
  type FlashcardGenerationOptions,
  type FlashcardTypeMix,
} from '@lantern/shared/flashcards/generationOptions';
import { previewSampleFromSource } from './flashcards/generationSample';
import {
  hydrateRememberedGeneration,
  readRememberedGeneration,
  rememberGeneration,
} from './flashcards/rememberedGeneration';
import { sameGeneration } from './flashcards/rememberedGenerationRule';

type FlashcardGenerationStyle = 'concise' | 'detailed';

interface AIGenerateFlashcardsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called with generated flashcards for parent to create */
  onFlashcardsGenerated: (flashcards: AIGeneratedFlashcard[]) => void;
  /**
   * Wave G. When the caller names the deck the cards belong in, generation
   * runs as a background job instead of a blocking wait: the modal closes, the
   * progress sheet takes over, and the cards are saved and notified even if the
   * student leaves. Without it the modal keeps its original generate-then-
   * preview flow, which needs the student to stay to save anything.
   */
  deckId?: string;
  deckName?: string;
}

const STYLE_OPTIONS: Array<{ value: FlashcardGenerationStyle; label: string }> = [
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
];

const TYPE_MIX_OPTIONS: Array<{ value: FlashcardTypeMix; label: string }> = [
  { value: 'basic', label: 'Questions' },
  { value: 'mixed', label: 'A mix' },
  { value: 'cloze', label: 'Fill the blank' },
];

export default function AIGenerateFlashcardsModal({
  visible,
  onClose,
  onFlashcardsGenerated,
  deckId,
  deckName,
}: AIGenerateFlashcardsModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The keyboard is handled by a measured overlap and a pure rule, NOT by a
  // KeyboardAvoidingView. On Android RN feeds `keyboardDidHide` back through
  // the same handler as `keyboardDidShow` and recomputes its padding from the
  // hide event's frame; inside this transparent, statusBarTranslucent Modal
  // under edge-to-edge that frame is the window minus the gesture bar, so ~200px
  // of lift was left behind on every dismissal. Build 171: after BACK closed the
  // keyboard the sheet stayed pinned at y≈0, header and close X under the status
  // bar where no tap reached them, chips still live — open with no way out.
  //
  // `planBottomSheetKeyboard` returns the resting geometry whenever the overlap
  // is 0, and the overlap is set to 0 on every hide path, so BACK, tap-away and
  // the done key all restore the sheet by construction.
  const keyboardOverlap = useKeyboardOverlap(visible);
  const sheet = planBottomSheetKeyboard({
    windowHeight,
    // A DEFINITE px height, not maxHeight '92%': the maxHeight+flex:1-scroll
    // combo collapses the body to zero height on Android release builds (same
    // failure family as the offline Download Options footer, 5fd746d).
    restingHeight: Math.round(windowHeight * 0.92),
    keyboardOverlap,
    topInset: insets.top,
  });
  const { handleAIGenerateFlashcards, isAILoading, aiError, setAiError } = useAIHandlers();

  const [notes, setNotes] = useState('');
  const [options, setOptions] = useState<FlashcardGenerationOptions>(readRememberedGeneration);
  // Not a remembered preference — a per-run steer, so it resets with the sheet.
  const [style, setStyle] = useState<FlashcardGenerationStyle>('concise');
  const [generated, setGenerated] = useState<AIGeneratedFlashcard[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Re-read on each open: the settings store may have loaded, or synced from
  // another device, since this component mounted. The synchronous read paints
  // the chips on the first frame; the hydrate then corrects them once the
  // device's own last-used copy is off disk (a cold start opens the sheet
  // before that read finishes), and only if the student has not already
  // touched a chip in the meantime.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const painted = readRememberedGeneration();
    setOptions(painted);
    void hydrateRememberedGeneration().then((remembered) => {
      if (!alive) return;
      setOptions((current) => (sameGeneration(current, painted) ? remembered : current));
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  const plan = useMemo(
    () => planGenerationRequest(options, { notes, style }),
    [options, notes, style]
  );
  const previewSample = useMemo(() => previewSampleFromSource(notes), [notes]);
  const preview = useMemo(
    () => (previewSample ? previewCard(options, previewSample) : null),
    [options, previewSample]
  );

  const handleGenerate = async () => {
    if (!plan.ok) {
      Alert.alert('Not enough to work with', plan.blockedReason ?? 'Paste your notes first.');
      return;
    }
    setAiError(null);
    // Remembered on use, not on every tap: what the student generated with is
    // the preference, not what they scrolled past.
    rememberGeneration(options);

    if (deckId) {
      const targetDeck = deckId;
      const body = plan.body;
      useJobsStore.getState().startJob({
        kind: 'flashcards',
        sourceTitle: deckName || 'your deck',
        requestedCount: body.count,
        run: async ({ jobId, onServerJob, onStage }) => {
          // The raw service, not the hook: the hook swallows the error and
          // returns [], which would report every failure as an empty result.
          const { flashcards } = await aiGenerateFlashcards(body.notes, {
            count: body.count,
            style: body.style,
            typeMix: body.typeMix,
            clozeCount: body.clozeCount,
            difficulty: body.difficulty,
            onJobUpdate: (p) => {
              if (p.jobId) onServerJob(p.jobId);
            },
          });
          trackAIToolUsed('generate_flashcards');
          if (!flashcards.length) throw new Error('Could not generate flashcards from these notes.');
          const userId = useAuthStore.getState().user?.id;
          if (!userId) throw new Error('You must be signed in to save flashcards.');

          onStage('Saving to your deck');
          // One save path for every generator (services/jobArtifacts.ts): it
          // counts only cards the server actually took, and it will not write
          // this job's cards a second time if the run is resumed.
          const { ref, saved } = await saveGeneratedDeck({
            jobId,
            userId,
            cards: flashcards,
            deckId: targetDeck,
            deckName: deckName || 'your deck',
          });
          return { artifact: ref, resultCount: saved };
        },
      });
      handleClose();
      return;
    }

    // The hook's own signature stops at { count, style }; the mix reaches the
    // server on the job path above, which is the one every deck-scoped
    // generation takes.
    const cards = await handleAIGenerateFlashcards(plan.body.notes, {
      count: plan.body.count,
      style: plan.body.style,
    });
    if (cards.length > 0) {
      setGenerated(cards);
    }
  };

  const handleUse = () => {
    onFlashcardsGenerated(generated);
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setNotes('');
    setGenerated([]);
    setAiError(null);
    setExpandedIdx(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const chipStyle = (selected: boolean) => ({
    backgroundColor: selected ? colors.primaryFill : colors.inputBackground,
    borderColor: selected ? colors.primary : colors.border,
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { paddingBottom: sheet.liftBy }]}>
        <View style={[styles.container, { backgroundColor: colors.modalBackground, height: sheet.height }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {/* The hit area is part of the header, so it moves with the sheet
                and never has to be aimed at where the sheet used to be. */}
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <AppIcon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <AppIcon name="sparkles" size={20} color={colors.primaryText} />
              <T.Heading>Generate flashcards</T.Heading>
            </View>
            <AIUsageBadge variant="badge" />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              // With the sheet lifted, the gesture bar is behind the keyboard:
              // paying its inset as well would strand the last control in a gap.
              { paddingBottom: sheet.liftBy > 0 ? 24 : insets.bottom + 40 },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {generated.length === 0 ? (
              <>
                <T.Label tone="secondary" style={styles.label}>
                  PASTE YOUR NOTES OR LECTURE CONTENT
                </T.Label>
                <AIDisclaimer compact textColor={colors.textSecondary} linkColor={colors.primaryText} />
                <TextInput
                  style={[
                    styles.notesInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.inputText,
                    },
                  ]}
                  placeholder="Paste lecture notes, textbook content, etc..."
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={3000}
                />
                <T.Caption tone="tertiary" style={styles.charCount}>
                  {notes.length}/3000
                </T.Caption>

                {/* Count — only what the server will honour */}
                <T.Label tone="secondary" style={styles.label}>
                  HOW MANY CARDS
                </T.Label>
                <View style={styles.optionRow}>
                  {FLASHCARD_COUNT_PRESETS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, chipStyle(options.count === c)]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: options.count === c }}
                      accessibilityLabel={`${c} cards`}
                      onPress={() => setOptions((o) => ({ ...o, count: c }))}
                    >
                      <T.Body style={{ color: options.count === c ? '#fff' : colors.text }}>{`${c}`}</T.Body>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Type mix */}
                <T.Label tone="secondary" style={styles.label}>
                  KIND OF CARD
                </T.Label>
                <View style={styles.optionRow}>
                  {TYPE_MIX_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.chip, chipStyle(options.typeMix === opt.value)]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: options.typeMix === opt.value }}
                      onPress={() => setOptions((o) => ({ ...o, typeMix: opt.value }))}
                    >
                      <T.Body style={{ color: options.typeMix === opt.value ? '#fff' : colors.text }}>
                        {opt.label}
                      </T.Body>
                    </TouchableOpacity>
                  ))}
                </View>
                {options.typeMix === 'mixed' ? (
                  <T.Caption tone="secondary">
                    {`${plan.body.clozeCount} of the ${plan.body.count} will be fill-in-the-blank.`}
                  </T.Caption>
                ) : null}

                {/* Style */}
                <T.Label tone="secondary" style={styles.label}>
                  ANSWER STYLE
                </T.Label>
                <View style={styles.optionRow}>
                  {STYLE_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.chip, chipStyle(style === opt.value)]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: style === opt.value }}
                      onPress={() => setStyle(opt.value)}
                    >
                      <T.Body style={{ color: style === opt.value ? '#fff' : colors.text }}>
                        {opt.label}
                      </T.Body>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* One card, built here, before anything is spent */}
                <T.Label tone="secondary" style={styles.label}>
                  WHAT A CARD WILL LOOK LIKE
                </T.Label>
                <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <T.Label tone="tertiary">
                    {preview?.type === 'CLOZE' ? 'FILL IN THE BLANK' : 'QUESTION CARD'}
                  </T.Label>
                  <T.Body style={styles.previewFront}>
                    {preview ? preview.front : 'Paste your notes to see one.'}
                  </T.Body>
                  {preview ? <T.Caption tone="secondary">{preview.back}</T.Caption> : null}
                </View>
                <T.Caption tone="tertiary" style={styles.previewNote}>
                  An example built from your notes on this phone. Nothing has been generated or spent yet.
                </T.Caption>

                {/* Error */}
                {aiError ? (
                  <View style={[styles.errorBox, { backgroundColor: colors.errorBackground }]}>
                    <AppIcon name="alert-circle" size={16} color={colors.error} />
                    <T.Caption style={{ color: colors.error, flex: 1 }}>{aiError}</T.Caption>
                  </View>
                ) : null}

                {/* Generate — with the price on it */}
                <TouchableOpacity
                  style={[
                    styles.generateBtn,
                    { backgroundColor: colors.primaryFill },
                    (isAILoading || !plan.ok) && styles.generateBtnMuted,
                  ]}
                  onPress={handleGenerate}
                  disabled={isAILoading || !plan.ok}
                  accessibilityRole="button"
                  accessibilityLabel={`Generate ${plan.body.count} flashcards for ${plan.costLabel}`}
                  accessibilityState={{ disabled: isAILoading || !plan.ok, busy: isAILoading }}
                >
                  {isAILoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <AppIcon name="sparkles" size={20} color="#fff" />
                  )}
                  <T.Body style={styles.generateBtnText}>
                    {isAILoading ? 'Generating…' : `Generate ${describeGenerationPlan(plan)}`}
                  </T.Body>
                </TouchableOpacity>
                {plan.blockedReason ? (
                  <T.Caption tone="secondary" style={styles.previewNote}>{plan.blockedReason}</T.Caption>
                ) : null}
              </>
            ) : (
              <>
                {/* Preview */}
                <T.Heading>{`${generated.length} flashcards generated`}</T.Heading>

                {generated.map((card, idx) => {
                  const isExpanded = expandedIdx === idx;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.cardPreview, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => setExpandedIdx(isExpanded ? null : idx)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.cardPreviewHeader}>
                        <View style={[styles.cardBadge, { backgroundColor: colors.primaryBackground }]}>
                          <T.Label style={{ color: colors.primaryText }}>{`#${idx + 1}`}</T.Label>
                        </View>
                        <AppIcon
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={colors.textTertiary}
                        />
                      </View>

                      <T.Body numberOfLines={isExpanded ? undefined : 2}>{card.front}</T.Body>

                      {isExpanded && (
                        <View style={[styles.cardBackContainer, { backgroundColor: colors.cardSecondary }]}>
                          <T.Label tone="tertiary">ANSWER</T.Label>
                          <T.Body>{card.back}</T.Body>
                          {card.mnemonic ? (
                            <T.Caption style={{ color: colors.primaryText }}>{`💡 ${card.mnemonic}`}</T.Caption>
                          ) : null}
                          {card.example ? (
                            <T.Caption tone="secondary">{`📝 ${card.example}`}</T.Caption>
                          ) : null}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                    onPress={() => setGenerated([])}
                    accessibilityRole="button"
                  >
                    <AppIcon name="refresh" size={18} color={colors.text} />
                    <T.Body>Regenerate</T.Body>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primaryFill, borderColor: colors.primary }]}
                    onPress={handleUse}
                    accessibilityRole="button"
                  >
                    <AppIcon name="add-circle" size={18} color="#fff" />
                    <T.Body style={styles.actionBtnText}>Add to deck</T.Body>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Height set inline as a definite px value — see sheetHeight comment.
  container: { borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  closeBtn: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  label: { marginBottom: 8, marginTop: 16 },
  notesInput: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 120 },
  charCount: { textAlign: 'right', marginTop: 4 },
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  previewCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  previewFront: { fontWeight: '600' },
  previewNote: { marginTop: 8 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, marginTop: 16 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 24 },
  generateBtnMuted: { opacity: 0.6 },
  generateBtnText: { color: '#fff', fontWeight: '600' },
  cardPreview: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, marginTop: 10 },
  cardPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  cardBackContainer: { marginTop: 10, padding: 10, borderRadius: 8, gap: 4 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { color: '#fff', fontWeight: '600' },
});
