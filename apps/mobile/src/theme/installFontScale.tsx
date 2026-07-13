/**
 * Applies appearance.fontSize (small / medium / large) to all React Native Text
 * and TextInput instances by patching the react-native module exports.
 *
 * Must be imported before any screen/components load (see apps/mobile/index.ts).
 * Mutation is guarded — a failed patch must never crash app startup.
 */
import React from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextProps,
  type TextInputProps,
} from 'react-native';

let fontScale = 1;
let patchApplied = false;

export function setFontScale(scale: number) {
  fontScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function getFontScaleValue(): number {
  return fontScale;
}

export function isFontScalePatchApplied(): boolean {
  return patchApplied;
}

const DEFAULT_TEXT_SIZE = 14;

function scaleTextStyle(style: TextProps['style']): TextProps['style'] {
  if (fontScale === 1) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  const baseSize = typeof flat.fontSize === 'number' ? flat.fontSize : DEFAULT_TEXT_SIZE;
  const scaled = Math.round(baseSize * fontScale);
  if (Array.isArray(style)) return [...style, { fontSize: scaled }];
  if (style == null) return { fontSize: scaled };
  return [style, { fontSize: scaled }];
}

const ScaledText = React.forwardRef(function ScaledText(
  props: TextProps,
  ref: React.Ref<React.ComponentRef<typeof RNText>>
) {
  const { style, allowFontScaling = false, ...rest } = props;
  return (
    <RNText ref={ref} {...rest} style={scaleTextStyle(style)} allowFontScaling={allowFontScaling} />
  );
});
ScaledText.displayName = 'Text';

const ScaledTextInput = React.forwardRef(function ScaledTextInput(
  props: TextInputProps,
  ref: React.Ref<React.ComponentRef<typeof RNTextInput>>
) {
  const { style, allowFontScaling = false, ...rest } = props;
  return (
    <RNTextInput
      ref={ref}
      {...rest}
      style={scaleTextStyle(style)}
      allowFontScaling={allowFontScaling}
    />
  );
});
ScaledTextInput.displayName = 'TextInput';

try {
  const reactNativeModule = require('react-native') as typeof import('react-native') & {
    Text: typeof ScaledText;
    TextInput: typeof ScaledTextInput;
  };
  Object.defineProperty(reactNativeModule, 'Text', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: ScaledText,
  });
  Object.defineProperty(reactNativeModule, 'TextInput', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: ScaledTextInput,
  });
  patchApplied = true;
} catch (error) {
  // Never block app boot if RN exports are frozen or unavailable.
  console.warn('[installFontScale] Failed to patch Text/TextInput:', error);
  patchApplied = false;
}
