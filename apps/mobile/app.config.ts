import { ExpoConfig, ConfigContext } from 'expo/config';

const APP_VARIANT = process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || 'development';
const IS_DEV_VARIANT = APP_VARIANT === 'development';
const IS_PRODUCTION_BUILD = ['production', 'preview'].includes(process.env.EAS_BUILD_PROFILE || '');
const ANDROID_PACKAGE = IS_DEV_VARIANT ? 'com.lanternstudy.app.dev' : 'com.lanternstudy.app';
const IOS_BUNDLE_ID = IS_DEV_VARIANT ? 'com.lanternstudy.app.dev' : 'com.lanternstudy.app';

if (IS_PRODUCTION_BUILD) {
  const required = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_API_URL'] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required Expo env vars for ${process.env.EAS_BUILD_PROFILE} build: ${missing.join(', ')}`);
  }
}

const SPLASH_BACKGROUND_COLOR = '#7B88E8';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV_VARIANT ? 'Lantern Study Dev' : 'Lantern Study',
  slug: 'lantern-study',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // Disabled new architecture for Expo Go compatibility
  // newArchEnabled: true,
  
  // Deep linking configuration
  scheme: 'lanternstudy',
  
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: SPLASH_BACKGROUND_COLOR,
  },
  
  ios: {
    supportsTablet: true,
    bundleIdentifier: IOS_BUNDLE_ID,
    associatedDomains: ['applinks:lanternstudy.app'],
  },
  
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: SPLASH_BACKGROUND_COLOR,
    },
    package: ANDROID_PACKAGE,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'lanternstudy.app',
            pathPrefix: '/',
          },
          {
            scheme: 'lanternstudy',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },
  
  plugins: [
    'expo-font',
    'expo-secure-store',
    'expo-web-browser',
    ['expo-apple-authentication', { usesAppleSignIn: true }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 260,
        resizeMode: 'contain',
        backgroundColor: SPLASH_BACKGROUND_COLOR,
      },
    ],
  ],
  
  updates: {
    url: 'https://u.expo.dev/2e6076dd-b213-42d0-a966-3a15e3f9cb33',
    ...(IS_PRODUCTION_BUILD
      ? { fallbackToCacheTimeout: 30000 }
      : { enabled: false }),
  },

  runtimeVersion: {
    policy: 'appVersion',
  },

  extra: {
    appVariant: APP_VARIANT,
    lanApiHost: process.env.EXPO_PUBLIC_LAN_API_HOST || '127.0.0.1',
    emulatorApiHost: process.env.EXPO_PUBLIC_EMULATOR_API_HOST || '10.0.2.2',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    eas: {
      projectId: '2e6076dd-b213-42d0-a966-3a15e3f9cb33',
    },
  },
  
  experiments: {
    typedRoutes: true,
  },
});
