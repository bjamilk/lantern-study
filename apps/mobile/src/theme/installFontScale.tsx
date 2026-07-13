/**
 * Applies appearance.fontSize (small / medium / large) to all React Native Text
 * and TextInput instances by patching the react-native module exports.
 *
 * Must be imported before any screen/components load (see apps/mobile/index.ts).
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

export function setFontScale(scale: number) {
  fontScale = scale;
}

export function getFontScaleValue(): number {
  return fontScale;
}

const DEFAULT_TEXT_SIZE = 14;

function scaleTextStyle(style: TextProps['style']): TextProps['style'] {
  if (fontScale === 1 && style == null) return style;
  const flat = StyleSheet.flatten(style);
  const baseSize = typeof flat?.fontSize === 'number' ? flat.fontSize : DEFAULT_TEXT_SIZE;
  if (fontScale === 1) return style;
  const scaled = Math.round(baseSize * fontScale);
  if (flat != null && typeof flat.fontSize === 'number') {
    return Array.isArray(style) ? [...style, { fontSize: scaled }] : [style, { fontSize: scaled }];
  }
  return Array.isArray(style) ? [...style, { fontSize: scaled }] : [style ?? {}, { fontSize: scaled }];
}

const ScaledText = React.forwardRef(function ScaledText(props: TextProps, ref: React.Ref<RNText>) {
  const { style, allowFontScaling = false, ...rest } = props;
  return (
    <RNText ref={ref} {...rest} style={scaleTextStyle(style)} allowFontScaling={allowFontScaling} />
  );
});
ScaledText.displayName = 'Text';

const ScaledTextInput = React.forwardRef(function ScaledTextInput(
  props: TextInputProps,
  ref: React.Ref<RNTextInput>
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

const reactNativeModule = require('react-native') as typeof import('react-native');
reactNativeModule.Text = ScaledText;
reactNativeModule.TextInput = ScaledTextInput;
