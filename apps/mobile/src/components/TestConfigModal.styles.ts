/**
 * Styles for the test configuration bottom sheet (components/TestConfigModal.tsx).
 *
 * Main exports: `createStyles(colors)`, the per-theme StyleSheet the modal
 * memoises with `useMemo(() => createStyles(colors), [colors])`.
 * Touches: `StyleSheet`, the `ThemeColors` palette and the `typeScale` steps;
 * it holds no state and imports nothing else from the app.
 *
 * Gotcha: this block was split out of TestConfigModal.tsx verbatim — no style
 * value changed. Its key list is frozen by TestConfigModal.styles.test.ts, so a
 * renamed or dropped key fails there rather than silently rendering an
 * unstyled view (React Native accepts `style={undefined}` in silence).
 */
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme';
import { typeScale } from '../design/typeScale';

export const createStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  closeButton: {
    padding: 4,
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#10b98120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerIconStudy: {
    backgroundColor: '#10b98120',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: c.textSecondary,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 24,
    flexGrow: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: '#10b98115',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10b98130',
    marginBottom: 24,
  },
  infoBoxStudy: {
    backgroundColor: '#10b98115',
    borderColor: '#10b98130',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
  },
  questionCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10b981',
  },
  availableHint: {
    fontSize: 12,
    marginBottom: 10,
    marginTop: -6,
  },
  presetRow: {
    marginBottom: 10,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  presetSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  presetInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  presetSaveButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  presetSaveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  presetDeleteButton: {
    padding: 8,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '500',
  },
  subgroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  subgroupText: {
    fontSize: 14,
  },
  sliderContainer: {
    paddingHorizontal: 4,
  },
  numberInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  numberButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberInput: {
    width: 80,
    height: 48,
    backgroundColor: c.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: c.border,
    fontSize: 24,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  quickSelectRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  quickSelectButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  quickSelectButtonActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  quickSelectText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textSecondary,
  },
  quickSelectTextActive: {
    color: '#ffffff',
  },
  timerValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f97316',
  },
  timerPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timerPresetButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  timerPresetButtonActive: {
    backgroundColor: '#f9731620',
    borderColor: '#f97316',
  },
  timerPresetText: {
    fontSize: 13,
    fontWeight: '500',
    color: c.textSecondary,
  },
  timerPresetTextActive: {
    color: '#f97316',
  },
  selectedCount: {
    fontSize: 13,
    color: '#8b5cf6',
  },
  questionTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  questionTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  questionTypeButtonActive: {
    backgroundColor: '#8b5cf6',
    borderColor: '#8b5cf6',
  },
  questionTypeText: {
    fontSize: 13,
    fontWeight: '500',
    color: c.textSecondary,
  },
  questionTypeTextActive: {
    color: '#ffffff',
  },
  disabledMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: c.backgroundSecondary,
    borderRadius: 10,
  },
  disabledMessageText: {
    fontSize: 13,
    color: c.textTertiary,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 16,
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#10b981',
  },
  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: c.backgroundSecondary,
    borderRadius: 12,
    marginBottom: 12,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
    marginRight: 12,
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: c.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleContent: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 12,
    color: c.textTertiary,
    lineHeight: 18,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  tagButtonActive: {
    backgroundColor: '#ec489920',
    borderColor: '#ec4899',
  },
  tagText: {
    fontSize: 13,
    color: c.textSecondary,
  },
  tagTextActive: {
    color: '#ec4899',
    fontWeight: '500',
  },
  footer: {
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.card,
    flexShrink: 0,
  },
  validationHint: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  downloadButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  summaryLine: {
    ...typeScale.caption,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: c.backgroundSecondary,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
  },
  submitButton: {
    flex: 1.5,
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonStudy: {
    backgroundColor: '#10b981',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
