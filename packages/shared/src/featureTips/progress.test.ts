import {
  DEFAULT_FEATURE_TIPS,
  dismissTip,
  normalizeFeatureTips,
  pickActiveTip,
  setDontShowAgain,
  shouldShowTip,
  skipAllTips,
  toPersistentFeatureTips,
} from './progress';

describe('feature tip persistence policy', () => {
  it('treats Got it as session dismiss only when serializing for storage', () => {
    const afterGotIt = dismissTip(DEFAULT_FEATURE_TIPS, 'nav.library');
    expect(afterGotIt.dismissed['nav.library']).toBe(true);

    const persistent = toPersistentFeatureTips(afterGotIt);
    expect(persistent.dismissed).toEqual({});
    expect(persistent.dontShowAgain).toBe(false);
    expect(persistent.skippedAll).toBe(false);
  });

  it('keeps dontShowAgain / skippedAll in persistent payload', () => {
    const permanent = setDontShowAgain(DEFAULT_FEATURE_TIPS, true);
    const persistent = toPersistentFeatureTips(permanent);
    expect(persistent.dontShowAgain).toBe(true);
    expect(persistent.skippedAll).toBe(true);
    expect(persistent.dismissed).toEqual({});
  });

  it('clears legacy persisted Got-it dismissals on normalize when not opted out', () => {
    const normalized = normalizeFeatureTips({
      version: 1,
      dismissed: { 'nav.library': true, 'nav.chat': true },
      skippedAll: false,
      dontShowAgain: false,
      checklist: {},
    });
    expect(normalized.dismissed).toEqual({});
    expect(shouldShowTip(normalized, 'nav.library', {
      onboardingComplete: true,
      surfaceReady: true,
    })).toBe(true);
  });

  it('still hides tips when dontShowAgain is set', () => {
    const state = setDontShowAgain(DEFAULT_FEATURE_TIPS, true);
    expect(
      pickActiveTip(state, ['nav.library', 'nav.chat'], { onboardingComplete: true })
    ).toBeNull();
  });

  it('advances to next tip after session dismiss', () => {
    const afterFirst = dismissTip(DEFAULT_FEATURE_TIPS, 'nav.library');
    expect(
      pickActiveTip(afterFirst, ['nav.library', 'library.tabs'], { onboardingComplete: true })
    ).toBe('library.tabs');
  });

  it('skip all permanently blocks until replay fields cleared', () => {
    const skipped = skipAllTips(DEFAULT_FEATURE_TIPS);
    expect(toPersistentFeatureTips(skipped).skippedAll).toBe(true);
    expect(
      pickActiveTip(skipped, ['nav.library'], { onboardingComplete: true })
    ).toBeNull();
  });
});
