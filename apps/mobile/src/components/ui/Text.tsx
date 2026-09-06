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
import { useTheme } from '../../theme';
import { typeScale, tabularNums, type TypeStepName } from '../../design/typeScale';

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
  const base = typeScale[step];
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
