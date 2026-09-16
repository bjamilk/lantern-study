/**
 * Styles for the `TestTaking` route (screens/tests/TestTakingScreen.tsx).
 *
 * Main exports: `createStyles(colors)` — the raw per-theme StyleSheet — and
 * `s(colors)`, the cached accessor the screen and its module-local question
 * components actually call.
 * Touches: nothing but `StyleSheet` and the `ThemeColors` palette (plus the two
 * brand constants); it holds no state and imports nothing from the app.
 *
 * Gotcha: `s` memoises per palette OBJECT in a WeakMap, so it is only cheap
 * while the theme hands out a stable `colors` reference — a palette rebuilt on
 * every render would rebuild the sheet on every render too. This block was
 * split out of TestTakingScreen.tsx verbatim (no style value changed); the key
 * list is frozen by TestTakingScreen.styles.test.ts, so a renamed or dropped
 * key fails there rather than silently rendering an unstyled view. The two
 * brand constants come from `theme/brand` rather than the `theme` barrel so the
 * sheet can be imported by a node-environment jest test without dragging the
 * ThemeProvider (and every native module behind it) in with it; both paths
 * export the same two values.
 */
import { StyleSheet } from 'react-native';
import { BRAND_INK, BRAND_TINT } from '../../theme/brand';
import type { ThemeColors } from '../../theme';

// Styles were hardcoded slate, so a test stayed dark in light mode. Built per
// theme and cached, so the implicit-return question components can read them
// straight from the `colors` prop they already receive.
const styleCache = new WeakMap<ThemeColors, ReturnType<typeof createStyles>>();
export const s = (c: ThemeColors) => {
  let cached = styleCache.get(c);
  if (!cached) {
    cached = createStyles(c);
    styleCache.set(c, cached);
  }
  return cached;
};

export const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  exitButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  testName: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
    marginBottom: 4,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  timerWarning: {
    backgroundColor: '#ef444420',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text,
  },
  timerTextWarning: {
    color: c.error,
  },
  submitButton: {
    // White label: the fill role, not the raw #6366f1 (4.47:1 under white).
    backgroundColor: c.primaryFill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: c.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: BRAND_INK,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
    minWidth: 50,
    textAlign: 'right',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  questionCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  questionTypeBadge: {
    backgroundColor: BRAND_TINT,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  questionTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: BRAND_INK,
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '500',
    color: c.text,
    lineHeight: 28,
  },
  questionImageWrapper: {
    marginTop: 16,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  questionImage: {
    width: '100%',
    minHeight: 120,
    maxHeight: 320,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  tag: {
    backgroundColor: c.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    color: c.textSecondary,
  },
  
  // MCQ Single styles
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: BRAND_INK,
    backgroundColor: BRAND_TINT,
  },
  optionRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4b5563',
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionRadioSelected: {
    borderColor: BRAND_INK,
  },
  optionRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: BRAND_INK,
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: c.text,
  },
  optionTextSelected: {
    color: c.textInverse,
    fontWeight: '500',
  },
  
  // MCQ Multiple styles
  multiSelectHint: {
    fontSize: 14,
    color: c.textSecondary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  optionCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4b5563',
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionCheckboxSelected: {
    backgroundColor: BRAND_INK,
    borderColor: BRAND_INK,
  },
  
  // True/False styles
  trueFalseContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  trueFalseButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 2,
  },
  trueButton: {
    backgroundColor: '#10b98110',
    borderColor: '#10b98140',
  },
  falseButton: {
    backgroundColor: '#ef444410',
    borderColor: '#ef444440',
  },
  trueFalseSelected: {
    borderWidth: 3,
  },
  trueButtonSelected: {
    backgroundColor: c.success,
    borderColor: c.success,
  },
  falseButtonSelected: {
    backgroundColor: c.error,
    borderColor: c.error,
  },
  trueFalseText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  
  // Fill in Blank styles
  fillBlankContainer: {
    gap: 12,
  },
  fillBlankHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  fillBlankInput: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: c.text,
    borderWidth: 2,
    borderColor: c.border,
  },
  
  // Matching styles
  matchingContainer: {
    gap: 16,
  },
  matchingHint: {
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  matchingColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  matchingColumn: {
    flex: 1,
    gap: 8,
  },
  matchingColumnTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: BRAND_INK,
    textAlign: 'center',
    marginBottom: 4,
  },
  matchingItem: {
    backgroundColor: c.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchingItemSelected: {
    borderColor: BRAND_INK,
    backgroundColor: BRAND_TINT,
  },
  matchingItemMatched: {
    borderColor: c.success,
    backgroundColor: '#10b98110',
  },
  matchingItemUsed: {
    opacity: 0.5,
    backgroundColor: '#10b98120',
  },
  matchingItemDisabled: {
    opacity: 0.7,
  },
  matchingItemText: {
    fontSize: 14,
    color: c.text,
    flex: 1,
  },
  matchingItemTextUsed: {
    color: c.success,
  },
  matchBadge: {
    marginLeft: 8,
  },
  clearMatchesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  clearMatchesText: {
    fontSize: 14,
    color: '#f59e0b',
  },
  
  // Diagram Labeling styles
  diagramContainer: {
    gap: 16,
  },
  diagramImageWrapper: {
    position: 'relative',
    backgroundColor: c.card,
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
  },
  diagramImagePlaceholder: {
    backgroundColor: c.card,
    borderRadius: 12,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagramImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  diagramMarker: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    borderRadius: 14,
    backgroundColor: '#dc2626',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  diagramMarkerText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
  },
  diagramPlaceholderText: {
    fontSize: 14,
    color: c.textTertiary,
    marginTop: 8,
  },
  diagramHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  labelInputsContainer: {
    gap: 10,
  },
  labelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  labelNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelNumberText: {
    fontSize: 14,
    fontWeight: '600',
    // sits on a hardcoded red chip
    color: '#ffffff',
  },
  labelPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  labelPickerSelected: {
    borderColor: BRAND_INK,
  },
  labelPickerText: {
    flex: 1,
    fontSize: 14,
    color: c.text,
    marginRight: 8,
  },
  labelPickerPlaceholder: {
    color: c.textTertiary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerScrollContent: {
    paddingBottom: 8,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
    marginBottom: 12,
  },
  pickerOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  pickerOptionText: {
    fontSize: 15,
    color: c.text,
  },
  
  // Open Ended styles
  openEndedContainer: {
    gap: 12,
  },
  openEndedHint: {
    fontSize: 14,
    color: c.textSecondary,
  },
  openEndedInput: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: c.text,
    borderWidth: 2,
    borderColor: c.border,
    minHeight: 180,
  },
  openEndedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordCount: {
    fontSize: 12,
    color: c.textTertiary,
  },
  keywordsHint: {
    fontSize: 11,
    color: BRAND_INK,
    fontStyle: 'italic',
    flex: 1,
    textAlign: 'right',
  },
  
  // Navigation styles
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: c.card,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  navButtonTextDisabled: {
    fontSize: 16,
    fontWeight: '500',
  },
  questionDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Ten 8 dp dots plus their gaps have to survive between Previous and
    // Next on a 360 dp screen, so the strip shrinks rather than pushing a
    // nav button off the row.
    flexShrink: 1,
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.backgroundSecondary,
  },
  dotAnswered: {
    backgroundColor: c.success,
  },
  dotCurrent: {
    backgroundColor: BRAND_INK,
    width: 12,
  },
  dotRevealed: {
    backgroundColor: '#f59e0b',
  },
  dotFlagged: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  offlineNoticeText: {
    flex: 1,
    color: c.textSecondary,
  },

  flagRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: c.card,
  },
  flagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  flagButtonActive: {
    backgroundColor: '#eab30820',
  },
  flagButtonText: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  flagButtonTextActive: {
    color: '#eab308',
  },
  reviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
  },
  reviewModal: {
    backgroundColor: c.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  reviewTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewSubtitle: {
    color: c.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  reviewGridScroll: {
    maxHeight: 280,
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 8,
  },
  reviewCell: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: c.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCellAnswered: {
    backgroundColor: '#10b98130',
    borderWidth: 1,
    borderColor: c.success,
  },
  reviewCellFlagged: {
    borderWidth: 1,
    borderColor: '#f97316',
  },
  reviewCellText: {
    color: c.text,
    fontWeight: '600',
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  reviewCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: c.backgroundSecondary,
    alignItems: 'center',
  },
  reviewCancelText: {
    color: c.text,
    fontWeight: '600',
  },
  reviewSubmitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: BRAND_INK,
    alignItems: 'center',
  },
  reviewSubmitText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  
  // Study Mode styles
  headerStudy: {
    borderBottomColor: '#10b98140',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#10b98120',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  studyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.success,
  },
  studyProgress: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  studyProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
  },
  progressBarStudy: {
    backgroundColor: '#10b98130',
  },
  progressFillStudy: {
    backgroundColor: c.success,
  },
  navigationStudy: {
    borderTopColor: '#10b98140',
  },
  feedbackContainer: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  feedbackCorrect: {
    backgroundColor: '#10b98115',
    borderColor: c.success,
  },
  feedbackIncorrect: {
    backgroundColor: '#ef444415',
    borderColor: c.error,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  feedbackTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  feedbackTitleCorrect: {
    color: c.success,
  },
  feedbackTitleIncorrect: {
    color: c.error,
  },
  feedbackExplanation: {
    fontSize: 14,
    color: c.textSecondary,
    lineHeight: 22,
  },
  correctAnswerBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: c.card,
    borderRadius: 8,
  },
  correctAnswerLabel: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 4,
  },
  correctAnswerText: {
    fontSize: 15,
    color: c.success,
    fontWeight: '600',
  },
  confidenceCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  confidenceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  confidenceOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    // 48 keeps both targets above the 44 pt minimum at every font scale.
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkAnswerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    padding: 16,
    backgroundColor: c.success,
    borderRadius: 12,
  },
  checkAnswerText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
  },
  finishStudyButton: {
    backgroundColor: '#10b98120',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  finishStudyText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.success,
  },
  
  // Error styles
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: c.textSecondary,
    marginBottom: 16,
  },
  errorLink: {
    fontSize: 16,
    color: BRAND_INK,
    fontWeight: '600',
  },
});
