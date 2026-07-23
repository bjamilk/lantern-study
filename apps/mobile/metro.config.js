const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const isExpoGoRuntime = process.env.EXPO_PUBLIC_APP_RUNTIME === 'expo-go';
const expoNotificationsStub = path.resolve(projectRoot, 'src/stubs/expo-notifications.ts');

function resolvePackageDir(packageName) {
  const mobilePath = path.resolve(projectRoot, 'node_modules', packageName);
  if (fs.existsSync(mobilePath)) return mobilePath;
  return path.resolve(monorepoRoot, 'node_modules', packageName);
}

// Expo Go ships native worklets 0.5.1; monorepo root may hoist 0.7.x via NativeWind peers.
const pinnedNativeModules = {
  'react-native-worklets': resolvePackageDir('react-native-worklets'),
  'react-native-reanimated': resolvePackageDir('react-native-reanimated'),
  'react-native-webview': resolvePackageDir('react-native-webview'),
};

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  ...pinnedNativeModules,
};
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isExpoGoRuntime && moduleName === 'expo-notifications') {
    return { type: 'sourceFile', filePath: expoNotificationsStub };
  }
  if (Object.hasOwn(pinnedNativeModules, moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.ts') },
      moduleName,
      platform,
    );
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
