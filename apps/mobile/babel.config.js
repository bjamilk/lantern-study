module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // worklets: false — this app uses Reanimated 3 (its own plugin, added below);
      // babel-preset-expo otherwise injects `react-native-worklets/plugin`, which is
      // Reanimated 4 only and is not installed.
      [
        'babel-preset-expo',
        { jsxImportSource: 'nativewind', unstable_transformImportMeta: true, worklets: false },
      ],
      'nativewind/babel',
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};
