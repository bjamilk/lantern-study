/**
 * Proving test for the TestConfigModal style extraction.
 *
 * The 440-line trailing `createStyles` block moved out of
 * TestConfigModal.tsx into TestConfigModal.styles.ts as a pure move. A
 * dropped or renamed style key is the one way that move fails quietly:
 * React Native accepts `style={undefined}` without a warning, so the modal
 * would simply render unstyled on a phone and pass every other gate.
 *
 * KEYS below was captured from the UNTOUCHED file before the move (the 79
 * top-level entries of the object literal, in source order). It is deliberately
 * not a snapshot file: the list is the contract and belongs in the diff.
 *
 * Renders nothing and loads no native module — `react-native` is replaced by a
 * `StyleSheet.create` that returns its argument, and the palette is a Proxy
 * answering every colour with a string. Adding a style key to the modal means
 * adding it here too.
 */
jest.mock('react-native', () => ({
  StyleSheet: { create: <T,>(sheet: T): T => sheet },
}));

import type { ThemeColors } from '../theme';
import { createStyles } from './TestConfigModal.styles';

/** Every colour lookup answers with a string, so no real palette is needed. */
const palette = new Proxy({} as ThemeColors, {
  get: (_t, key) => (typeof key === 'string' ? `#000000/${key}` : undefined),
});

const KEYS: readonly string[] = [
  'overlay',
  'container',
  'header',
  'closeButton',
  'headerCenter',
  'headerIcon',
  'headerIconStudy',
  'headerTitle',
  'headerSubtitle',
  'content',
  'contentContainer',
  'infoBox',
  'infoBoxStudy',
  'infoText',
  'section',
  'sectionHeader',
  'sectionTitle',
  'questionCount',
  'availableHint',
  'presetRow',
  'presetChip',
  'presetChipText',
  'presetSaveRow',
  'presetInput',
  'presetSaveButton',
  'presetSaveText',
  'presetDeleteButton',
  'selectAllRow',
  'selectAllText',
  'subgroupRow',
  'subgroupText',
  'sliderContainer',
  'numberInputRow',
  'numberButton',
  'numberInput',
  'quickSelectRow',
  'quickSelectButton',
  'quickSelectButtonActive',
  'quickSelectText',
  'quickSelectTextActive',
  'timerValue',
  'timerPresets',
  'timerPresetButton',
  'timerPresetButtonActive',
  'timerPresetText',
  'timerPresetTextActive',
  'selectedCount',
  'questionTypes',
  'questionTypeButton',
  'questionTypeButtonActive',
  'questionTypeText',
  'questionTypeTextActive',
  'disabledMessage',
  'disabledMessageText',
  'advancedToggle',
  'advancedToggleText',
  'toggleSection',
  'toggleInfo',
  'toggleIcon',
  'toggleContent',
  'toggleTitle',
  'toggleDescription',
  'tags',
  'tagButton',
  'tagButtonActive',
  'tagText',
  'tagTextActive',
  'footer',
  'validationHint',
  'downloadButton',
  'downloadButtonText',
  'summaryLine',
  'footerButtons',
  'cancelButton',
  'cancelButtonText',
  'submitButton',
  'submitButtonStudy',
  'submitButtonDisabled',
  'submitButtonText',
];

describe('TestConfigModal styles', () => {
  it('exposes exactly the keys the modal had before the extraction', () => {
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

  it('builds a fresh sheet per call, as the modal memo expects', () => {
    // The modal wraps this in `useMemo(..., [colors])`; the sheet factory
    // itself is uncached, unlike TestTakingScreen's `s()`.
    expect(createStyles(palette)).not.toBe(createStyles(palette));
  });
});
