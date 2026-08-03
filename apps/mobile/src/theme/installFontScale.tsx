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

// CRITICAL: capture the real components *before* the module exports are patched below.
// `import { Text as RNText }` compiles to a live `_reactNative.Text` lookup, so once the
// patch is installed `RNText` would resolve to ScaledText itself — rendering ScaledText
// inside ScaledText, i.e. infinite recursion that allocates until the app is OOM-killed.
// These consts snapshot the originals at module-eval time, which is before patchExport runs.
const BaseText = RNText;
const BaseTextInput = RNTextInput;

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
    <BaseText
      ref={ref}
      {...rest}
      style={scaleTextStyle(style)}
      allowFontScaling={allowFontScaling}
    />
  );
});
ScaledText.displayName = 'Text';

const ScaledTextInput = React.forwardRef(function ScaledTextInput(
  props: TextInputProps,
  ref: React.Ref<RNTextInput>
) {
  const { style, allowFontScaling = false, ...rest } = props;
  return (
    <BaseTextInput
      ref={ref}
      {...rest}
      style={scaleTextStyle(style)}
      allowFontScaling={allowFontScaling}
    />
  );
});
ScaledTextInput.displayName = 'TextInput';

// React Native 0.81+ exposes `Text`/`TextInput` as getter-only exports (object-literal
// accessors), so a direct assignment (`module.Text = ...`) throws
// "Cannot assign to property 'Text' which has only a getter" and crashes boot.
// Those accessors are configurable, so redefine them with a getter instead.
const reactNativeModule = require('react-native') as Record<string, unknown>;
function patchExport(name: string, component: unknown) {
  try {
    Object.defineProperty(reactNativeModule, name, {
      configurable: true,
      enumerable: true,
      get: () => component,
    });
  } catch {
    // If a future RN makes the export non-configurable, skip the patch rather than
    // crash the app — global font scaling degrades gracefully to the default size.
  }
}
patchExport('Text', ScaledText);
patchExport('TextInput', ScaledTextInput);
