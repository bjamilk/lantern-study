/**
 * Proving test for the TestTakingScreen style extraction.
 *
 * The 868-line `createStyles` block moved out of TestTakingScreen.tsx into
 * TestTakingScreen.styles.ts as a pure move. The only way that move can go
 * wrong silently is a dropped, renamed or duplicated style key: React Native
 * renders `style={undefined}` without complaining, so a missing key is an
 * unstyled view on a phone and nothing at all in CI.
 *
 * KEYS below was captured from the UNTOUCHED file before the move (the 157
 * top-level entries of the object literal, in source order) and is asserted
 * against the extracted module. It is not a snapshot file on purpose — the
 * list is the contract, and it should be read in the diff.
 *
 * Renders nothing and touches no native module: `react-native` is replaced by a
 * `StyleSheet.create` that returns its argument, which is what the real one
 * does for key purposes, and the palette is a Proxy that answers every colour
 * with a string. Adding a style key to the screen means adding it here too.
 */
jest.mock('react-native', () => ({
  StyleSheet: { create: <T,>(sheet: T): T => sheet },
}));

import type { ThemeColors } from '../../theme';
import { createStyles, s } from './TestTakingScreen.styles';

/** Every colour lookup answers with a string, so no real palette is needed. */
const palette = new Proxy({} as ThemeColors, {
  get: (_t, key) => (typeof key === 'string' ? `#000000/${key}` : undefined),
});

const KEYS: readonly string[] = [
  'container',
  'header',
  'exitButton',
  'headerCenter',
  'testName',
  'timerBadge',
  'timerWarning',
  'timerText',
  'timerTextWarning',
  'submitButton',
  'submitButtonText',
  'progressContainer',
  'progressBar',
  'progressFill',
  'progressText',
  'content',
  'contentContainer',
  'questionCard',
  'questionHeader',
  'questionTypeBadge',
  'questionTypeText',
  'pointsText',
  'questionText',
  'questionImageWrapper',
  'questionImage',
  'tagsContainer',
  'tag',
  'tagText',
  'optionsContainer',
  'optionButton',
  'optionSelected',
  'optionRadio',
  'optionRadioSelected',
  'optionRadioInner',
  'optionText',
  'optionTextSelected',
  'multiSelectHint',
  'optionCheckbox',
  'optionCheckboxSelected',
  'trueFalseContainer',
  'trueFalseButton',
  'trueButton',
  'falseButton',
  'trueFalseSelected',
  'trueButtonSelected',
  'falseButtonSelected',
  'trueFalseText',
  'fillBlankContainer',
  'fillBlankHint',
  'fillBlankInput',
  'matchingContainer',
  'matchingHint',
  'matchingColumns',
  'matchingColumn',
  'matchingColumnTitle',
  'matchingItem',
  'matchingItemSelected',
  'matchingItemMatched',
  'matchingItemUsed',
  'matchingItemDisabled',
  'matchingItemText',
  'matchingItemTextUsed',
  'matchBadge',
  'clearMatchesButton',
  'clearMatchesText',
  'diagramContainer',
  'diagramImageWrapper',
  'diagramImagePlaceholder',
  'diagramImage',
  'diagramMarker',
  'diagramMarkerText',
  'diagramPlaceholderText',
  'diagramHint',
  'labelInputsContainer',
  'labelInputRow',
  'labelNumber',
  'labelNumberText',
  'labelPicker',
  'labelPickerSelected',
  'labelPickerText',
  'labelPickerPlaceholder',
  'pickerOverlay',
  'pickerSheet',
  'pickerScroll',
  'pickerScrollContent',
  'pickerTitle',
  'pickerOption',
  'pickerOptionText',
  'openEndedContainer',
  'openEndedHint',
  'openEndedInput',
  'openEndedFooter',
  'wordCount',
  'keywordsHint',
  'navigation',
  'navButton',
  'navButtonDisabled',
  'navButtonText',
  'navButtonTextDisabled',
  'questionDots',
  'dot',
  'dotAnswered',
  'dotCurrent',
  'dotRevealed',
  'dotFlagged',
  'offlineNotice',
  'offlineNoticeText',
  'flagRow',
  'flagButton',
  'flagButtonActive',
  'flagButtonText',
  'flagButtonTextActive',
  'reviewOverlay',
  'reviewModal',
  'reviewTitle',
  'reviewSubtitle',
  'reviewGridScroll',
  'reviewGrid',
  'reviewCell',
  'reviewCellAnswered',
  'reviewCellFlagged',
  'reviewCellText',
  'reviewActions',
  'reviewCancelButton',
  'reviewCancelText',
  'reviewSubmitButton',
  'reviewSubmitText',
  'headerStudy',
  'headerTitleRow',
  'studyBadge',
  'studyBadgeText',
  'studyProgress',
  'studyProgressText',
  'progressBarStudy',
  'progressFillStudy',
  'navigationStudy',
  'feedbackContainer',
  'feedbackCorrect',
  'feedbackIncorrect',
  'feedbackHeader',
  'feedbackTitle',
  'feedbackTitleCorrect',
  'feedbackTitleIncorrect',
  'feedbackExplanation',
  'correctAnswerBox',
  'correctAnswerLabel',
  'correctAnswerText',
  'confidenceCard',
  'confidenceRow',
  'confidenceOption',
  'checkAnswerButton',
  'checkAnswerText',
  'finishStudyButton',
  'finishStudyText',
  'errorContainer',
  'errorText',
  'errorLink',
];

describe('TestTakingScreen styles', () => {
  it('exposes exactly the keys the screen had before the extraction', () => {
    expect(Object.keys(createStyles(palette))).toEqual([...KEYS]);
  });

  it('lists each key once', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });

  it('builds every key into an object', () => {
    const sheet = createStyles(palette) as Record<string, unknown>;
    for (const key of KEYS) {
      expect(typeof sheet[key]).toBe('object');
    }
  });

  it('caches one sheet per palette object and rebuilds for a new one', () => {
    // `s` is a WeakMap cache keyed on the palette IDENTITY — a theme that
    // handed out a fresh object each render would rebuild the sheet each
    // render, so the identity check is the behaviour worth pinning.
    const other = new Proxy({} as ThemeColors, { get: () => '#111111' });
    expect(s(palette)).toBe(s(palette));
    expect(s(other)).not.toBe(s(palette));
    expect(Object.keys(s(other))).toEqual([...KEYS]);
  });
});
