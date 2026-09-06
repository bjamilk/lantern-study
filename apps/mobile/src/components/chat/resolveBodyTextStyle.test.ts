import { darkTheme, lightTheme } from '@lantern/shared/design';
import { MIN_FONT_SIZE } from '../../design/typeScale';
import {
  AA_NORMAL_TEXT,
  CHAT_TYPE_STEPS,
  contrastRatio,
  resolveBodyTextStyle,
  resolveMetaTextColor,
} from './resolveBodyTextStyle';

/** Only the two numbers a reader can see on screen. */
function size(fontScale: number, step?: Parameters<typeof resolveBodyTextStyle>[1]) {
  const { fontSize, lineHeight } = resolveBodyTextStyle(fontScale, step);
  return { fontSize, lineHeight };
}

describe('resolveBodyTextStyle', () => {
  it('renders the body step at 15/22 at scale 1', () => {
    expect(size(1)).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(resolveBodyTextStyle(1).fontWeight).toBe(CHAT_TYPE_STEPS.body.fontWeight);
  });

  it('scales the body step up at 1.15', () => {
    expect(size(1.15)).toEqual({ fontSize: 17, lineHeight: 25 });
  });

  it('scales the body step down at 0.9', () => {
    expect(size(0.9)).toEqual({ fontSize: 14, lineHeight: 20 });
  });

  it('never falls below the 11 sp floor', () => {
    const label = resolveBodyTextStyle(0.9, 'label');
    expect(label.fontSize).toBe(MIN_FONT_SIZE);
    // Leading must not collapse onto the glyphs when the floor lifts the size.
    expect(label.lineHeight).toBeGreaterThan(label.fontSize);
  });

  it('accepts a literal step as well as a name', () => {
    expect(
      size(1, { fontSize: 20, lineHeight: 26, fontWeight: '400', letterSpacing: 0 })
    ).toEqual({ fontSize: 20, lineHeight: 26 });
    expect(size(1, 'caption')).toEqual({
      fontSize: CHAT_TYPE_STEPS.caption.fontSize,
      lineHeight: CHAT_TYPE_STEPS.caption.lineHeight,
    });
  });

  it('falls back to scale 1 for a nonsense scale', () => {
    expect(size(0)).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(size(Number.NaN)).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(size(-2)).toEqual({ fontSize: 15, lineHeight: 22 });
  });

  it('is monotonic in the scale', () => {
    const sizes = [0.85, 1, 1.15, 1.3].map((s) => resolveBodyTextStyle(s).fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});

describe('resolveMetaTextColor', () => {
  it('measures the failure it exists to fix', () => {
    expect(contrastRatio(lightTheme.chatBubbleMeta, lightTheme.chatBubbleOwn)).toBeLessThan(
      AA_NORMAL_TEXT
    );
    expect(contrastRatio(darkTheme.chatBubbleMeta, darkTheme.chatBubbleOwn)).toBeLessThan(
      AA_NORMAL_TEXT
    );
  });

  it('returns ink that clears AA on the light own bubble', () => {
    const ink = resolveMetaTextColor(lightTheme.chatBubbleOwn, lightTheme.chatBubbleMeta);
    expect(contrastRatio(ink, lightTheme.chatBubbleOwn)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('returns ink that clears AA on the dark own bubble', () => {
    const ink = resolveMetaTextColor(darkTheme.chatBubbleOwn, darkTheme.chatBubbleMeta);
    expect(contrastRatio(ink, darkTheme.chatBubbleOwn)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('keeps the themed colour wherever it already passes', () => {
    expect(resolveMetaTextColor(lightTheme.chatBubbleOther, lightTheme.chatBubbleMeta)).toBe(
      lightTheme.chatBubbleMeta
    );
  });

  it('fails closed on an unparseable colour rather than throwing', () => {
    expect(contrastRatio('nope', '#ffffff')).toBe(1);
    expect(typeof resolveMetaTextColor('nope', '#667781')).toBe('string');
  });
});
