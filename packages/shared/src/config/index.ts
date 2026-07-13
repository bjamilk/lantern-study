// ===========================================
// Lantern Study - Shared Environment Config
// ===========================================
// Platform-agnostic configuration for web and mobile apps

/**
 * Environment detection
 */
export type Platform = 'web' | 'mobile';
export type Environment = 'development' | 'production';

// Detect if running in React Native (Hermes may not set navigator.product)
const isReactNative = (): boolean => {
  try {
    const { Platform } = require('react-native');
    if (Platform?.OS) return true;
  } catch {
    // not in React Native
  }
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};

// Detect current platform
export const getPlatform = (): Platform => {
  return isReactNative() ? 'mobile' : 'web';
};

// Detect environment
export const getEnvironment = (): Environment => {
  // Check for common production indicators
  if (typeof process !== 'undefined') {
    if (process.env.NODE_ENV === 'production') return 'production';
    if (process.env.EXPO_PUBLIC_ENV === 'production') return 'production';
  }

  // Web production build: Vite defines __LANTERN_VITE_* on globalThis
  if (!isReactNative() && getWebViteEnv('SUPABASE_URL')) {
    return 'production';
  }

  return 'development';
};

/**
 * Configuration values
 */
interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
}

// Default development values
const DEV_CONFIG: Config = {
  supabaseUrl: 'http://localhost:55421',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  apiBaseUrl: 'http://localhost:3001',
};

// Mobile development needs LAN IP for device access
const MOBILE_DEV_CONFIG: Config = {
  supabaseUrl: 'http://192.168.4.38:55421',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  apiBaseUrl: 'http://192.168.4.38:3001',
};

/**
 * Public cloud endpoints used when Expo OTA/production bundles don't inline
 * EXPO_PUBLIC_* (dynamic process.env access is stripped by Metro).
 * Anon key is public-by-design (same values as apps/mobile supabase client).
 */
const MOBILE_PROD_FALLBACK: Config = {
  supabaseUrl: 'https://tiizkjhbrnaibaagmurl.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE',
  apiBaseUrl: 'https://lantern-study-api.onrender.com',
};

type GlobalWithLanternVite = typeof globalThis & {
  __LANTERN_VITE_SUPABASE_URL__?: string;
  __LANTERN_VITE_SUPABASE_ANON_KEY__?: string;
  __LANTERN_VITE_API_URL__?: string;
};

/** Vite injects these at web build time (see apps/web/vite.config.ts). */
const getWebViteEnv = (name: string): string | undefined => {
  const g = globalThis as GlobalWithLanternVite;
  const map: Record<string, string | undefined> = {
    SUPABASE_URL: g.__LANTERN_VITE_SUPABASE_URL__,
    SUPABASE_ANON_KEY: g.__LANTERN_VITE_SUPABASE_ANON_KEY__,
    API_URL: g.__LANTERN_VITE_API_URL__,
  };
  const value = map[name];
  return value || undefined;
};

/**
 * Static EXPO_PUBLIC_* reads — Metro/Expo only inlines literal property access.
 * Dynamic `process.env[key]` is undefined in production OTA bundles.
 */
const getExpoPublicEnv = (name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'API_URL'): string | undefined => {
  if (typeof process === 'undefined' || !process.env) return undefined;
  switch (name) {
    case 'SUPABASE_URL':
      return process.env.EXPO_PUBLIC_SUPABASE_URL || undefined;
    case 'SUPABASE_ANON_KEY':
      return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || undefined;
    case 'API_URL':
      return process.env.EXPO_PUBLIC_API_URL || undefined;
    default:
      return undefined;
  }
};

/**
 * Get environment variable by name
 * Handles both Vite (web) and Expo (mobile) env patterns
 */
const getEnvVar = (name: string): string | undefined => {
  if (name === 'SUPABASE_URL' || name === 'SUPABASE_ANON_KEY' || name === 'API_URL') {
    const expoValue = getExpoPublicEnv(name);
    if (expoValue) return expoValue;
  }

  if (!isReactNative()) {
    const webValue = getWebViteEnv(name);
    if (webValue) return webValue;
  }

  return undefined;
};

/**
 * Get the full configuration based on platform and environment
 */
export const getConfig = (): Config => {
  const platform = getPlatform();
  const env = getEnvironment();

  // Production: use environment variables (with validation)
  if (env === 'production') {
    const supabaseUrl = getEnvVar('SUPABASE_URL');
    const supabaseAnonKey = getEnvVar('SUPABASE_ANON_KEY');
    const apiBaseUrl = getEnvVar('API_URL');

    const missing: string[] = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
    if (!apiBaseUrl) missing.push('API_URL');

    if (missing.length > 0) {
      // Mobile preview/production OTA: never hard-fail chat/API over missing inlined env.
      if (platform === 'mobile') {
        return {
          supabaseUrl: supabaseUrl || MOBILE_PROD_FALLBACK.supabaseUrl,
          supabaseAnonKey: supabaseAnonKey || MOBILE_PROD_FALLBACK.supabaseAnonKey,
          apiBaseUrl: apiBaseUrl || MOBILE_PROD_FALLBACK.apiBaseUrl,
        };
      }
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    }

    return {
      supabaseUrl: supabaseUrl || '',
      supabaseAnonKey: supabaseAnonKey || '',
      apiBaseUrl: apiBaseUrl || '',
    };
  }

  // Development: use platform-specific defaults, allow env override
  const defaultConfig = platform === 'mobile' ? MOBILE_DEV_CONFIG : DEV_CONFIG;

  return {
    supabaseUrl: getEnvVar('SUPABASE_URL') || defaultConfig.supabaseUrl,
    supabaseAnonKey: getEnvVar('SUPABASE_ANON_KEY') || defaultConfig.supabaseAnonKey,
    apiBaseUrl: getEnvVar('API_URL') || defaultConfig.apiBaseUrl,
  };
};

/**
 * Individual config getters for convenience
 */
export const getSupabaseUrl = (): string => getConfig().supabaseUrl;
export const getSupabaseAnonKey = (): string => getConfig().supabaseAnonKey;
export const getApiBaseUrl = (): string => getConfig().apiBaseUrl;

/**
 * Allow runtime override of LAN IP for mobile development
 * Useful when IP changes or testing on different networks
 */
let lanIpOverride: string | null = null;

export const setLanIp = (ip: string): void => {
  lanIpOverride = ip;
};

export const getLanIp = (): string => {
  return lanIpOverride || '192.168.4.38';
};

/**
 * Get API URL with optional LAN IP override for mobile
 */
export const getApiUrl = (endpoint: string): string => {
  const baseUrl = getApiBaseUrl();

  // If we have a LAN override and this is mobile dev, use it
  if (lanIpOverride && getPlatform() === 'mobile' && getEnvironment() === 'development') {
    return `http://${lanIpOverride}:3001${endpoint}`;
  }

  return `${baseUrl}${endpoint}`;
};
