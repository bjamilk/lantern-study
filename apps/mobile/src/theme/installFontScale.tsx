/**
 * Applies appearance.fontSize (small / medium / large) to all React Native Text
 * and TextInput instances by patching the react-native module exports.
 *
 * Must be imported before any screen/components load (see apps/mobile/index.ts).
 */
import React from 'react';
import { StyleSheet, type TextProps, type TextInputProps } from 'react-native';

const reactNativeModule = require('react-native') as typeof import('react-native');

// Capture the ORIGINAL Text/TextInput before we override the module exports below.
// The wrappers must render these originals — if they rendered the (live) module
// exports instead, those now resolve back to the wrappers, causing infinite render
// recursion that exhausts the Hermes JS heap (OOM / SIGABRT) at startup.
const OriginalText = reactNativeModule.Text;
const OriginalTextInput = reactNativeModule.TextInput;

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

const ScaledText = React.forwardRef<React.ElementRef<typeof OriginalText>, TextProps>(
  function ScaledText(props, ref) {
    const { style, allowFontScaling = false, ...rest } = props;
    return (
      <OriginalText
        ref={ref}
        {...rest}
        style={scaleTextStyle(style)}
        allowFontScaling={allowFontScaling}
      />
    );
  }
);
ScaledText.displayName = 'Text';

const ScaledTextInput = React.forwardRef<React.ElementRef<typeof OriginalTextInput>, TextInputProps>(
  function ScaledTextInput(props, ref) {
    const { style, allowFontScaling = false, ...rest } = props;
    return (
      <OriginalTextInput
        ref={ref}
        {...rest}
        style={scaleTextStyle(style)}
        allowFontScaling={allowFontScaling}
      />
    );
  }
);
ScaledTextInput.displayName = 'TextInput';

// React Native 0.81 exposes `Text`/`TextInput` as getter-only module exports, so a direct
// assignment (`reactNativeModule.Text = ...`) throws "Cannot assign to property 'Text' which
// has only a getter" at import time. They are configurable accessors, so redefine them via
// Object.defineProperty instead. Guarded so global font scaling degrades gracefully rather
// than ever blocking startup.
function patchReactNativeExport(name: 'Text' | 'TextInput', component: React.ComponentType<never>) {
  try {
    Object.defineProperty(reactNativeModule, name, {
      configurable: true,
      enumerable: true,
      get: () => component,
    });
  } catch {
    // If the export can't be redefined, skip global font scaling for it instead of crashing.
  }
}

patchReactNativeExport('Text', ScaledText as unknown as React.ComponentType<never>);
patchReactNativeExport('TextInput', ScaledTextInput as unknown as React.ComponentType<never>);
