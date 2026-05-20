import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Lantern Study',
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
    backgroundColor: '#4F46E5', // Indigo-600
  },
  
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.lanternstudy.app',
    associatedDomains: ['applinks:lanternstudy.app'],
  },
  
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#4F46E5',
    },
    package: 'com.lanternstudy.app',
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
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#4F46E5',
      },
    ],
  ],
  
  // EAS Update configuration
  updates: {
    url: 'https://u.expo.dev/your-project-id', // Replace with actual project ID after eas init
    fallbackToCacheTimeout: 30000,
  },
  
  runtimeVersion: {
    policy: 'appVersion',
  },
  
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://192.168.4.38:54321',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://192.168.4.38:3001',
    eas: {
      projectId: 'your-project-id', // Replace after eas init
    },
  },
  
  experiments: {
    typedRoutes: true,
  },
});
