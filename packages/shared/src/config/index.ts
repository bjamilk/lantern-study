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
  
  // Check Vite env (only in web context, not React Native)
  // Note: import.meta is not supported in Hermes/React Native
  if (!isReactNative()) {
    try {
      // Use indirect eval to avoid Hermes parsing import.meta
      const checkViteEnv = new Function('return typeof import.meta !== "undefined" && import.meta.env?.PROD');
      if (checkViteEnv()) return 'production';
    } catch {
      // Ignore - not in a Vite environment
    }
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

// Production values (to be set via environment variables)
const PROD_CONFIG: Config = {
  supabaseUrl: '', // Set via VITE_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
  supabaseAnonKey: '', // Set via VITE_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY
  apiBaseUrl: '', // Set via VITE_API_URL or EXPO_PUBLIC_API_URL
};

/**
 * Get environment variable by name
 * Handles both Vite (web) and Expo (mobile) env patterns
 */
const getEnvVar = (name: string): string | undefined => {
  // Try Expo public env vars (mobile)
  if (typeof process !== 'undefined' && process.env) {
    const expoKey = `EXPO_PUBLIC_${name}`;
    if (process.env[expoKey]) return process.env[expoKey];
  }
  
  // Try Vite env vars (web only - import.meta not supported in Hermes/React Native)
  if (!isReactNative()) {
    try {
      const viteKey = `VITE_${name}`;
      const getViteVar = new Function('key', 'return typeof import.meta !== "undefined" && import.meta.env ? import.meta.env[key] : undefined');
      const value = getViteVar(viteKey);
      if (value) return value;
    } catch {
      // Not in Vite environment
    }
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
    
    // Validate required production environment variables
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
    if (!apiBaseUrl) missing.push('API_URL');
    
    if (missing.length > 0) {
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
