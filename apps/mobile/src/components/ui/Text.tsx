/**
 * `T` — the six type steps as components.
 *
 * StyleSheet screens have nowhere to put a Tailwind class, so this is what
 * they migrate to: `<T.Body>`, `<T.Caption>`, `<T.Display tabular>`. Same
 * numbers as design/typeScale.ts and as the `text-body`/`text-title` classes
 * in tailwind.config.js — one scale, three ways of reaching it.
 *
 * Colour comes from `tone`, not from a hardcoded hex, so dark mode and the
 * high-contrast/accent settings reach every string. Font scaling is NOT done
 * here: theme/installFontScale.tsx patches RN's `Text` export and rescales the
 * `fontSize` we set, so importing `Text` from 'react-native' below is what
 * makes the appearance setting apply. Do not swap it for a raw import.
 */
import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, serifDisplayStyle } from '../../theme';
import { typeScale, tabularNums, type TypeStepName } from '../../design/typeScale';

/**
 * The two DISPLAY steps, and the only strings in the app set in the serif.
 *
 * `display` is a hub's greeting and a score numeral; `title` is a screen's h1
 * and a bottom sheet's heading. Everything from `heading` down stays in the
 * platform sans — a serif at 17 sp and under loses its brackets on a 420 dpi
 * phone and reads as blurred sans rather than as a second voice.
 *
 * The face carries its own weight (see theme/fonts.ts), so the style below
 * also resets `fontWeight`: the scale sets '700' on both steps, and a 700
 * against a single-weight custom family is a synthesised faux-bold on iOS and
 * a silently ignored hint on Android.
 */
const SERIF_STEPS: readonly TypeStepName[] = ['display', 'title'];

export type TypeTone = 'text' | 'secondary' | 'tertiary';

export interface TypeProps extends TextProps {
  /** Which theme ink. Defaults to the primary text colour. */
  tone?: TypeTone;
  /** Numerals that must not jitter as they change: scores, counts, timers. */
  tabular?: boolean;
  children?: React.ReactNode;
}

function useToneColor(tone: TypeTone): string {
  const { colors } = useTheme();
  if (tone === 'secondary') return colors.textSecondary;
  if (tone === 'tertiary') return colors.textTertiary;
  return colors.text;
}

function makeStep(step: TypeStepName) {
  // Resolved once per step, at module load, not per render: `serifDisplayStyle`
  // reads `Platform` and nothing that can change while the app is running.
  const base: TextStyle = SERIF_STEPS.includes(step)
    ? { ...typeScale[step], ...serifDisplayStyle() }
    : typeScale[step];
  const Component = React.forwardRef<Text, TypeProps>(function TypeStepText(
    { tone = 'text', tabular, style, ...rest },
    ref
  ) {
    const color = useToneColor(tone);
    const stepStyle: TextStyle = { ...base, color };
    return (
      <Text
        ref={ref}
        {...rest}
        style={tabular ? [stepStyle, tabularNums, style] : [stepStyle, style]}
      />
    );
  });
  Component.displayName = `T.${step[0].toUpperCase()}${step.slice(1)}`;
  return Component;
}

export const Display = makeStep('display');
export const Title = makeStep('title');
export const Heading = makeStep('heading');
export const Body = makeStep('body');
export const Caption = makeStep('caption');
export const Label = makeStep('label');

export const T = { Display, Title, Heading, Body, Caption, Label };

export default T;
