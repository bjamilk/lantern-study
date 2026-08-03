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
 * Public cloud endpoints — used for production web/mobile when env is missing
 * or incorrectly baked as localhost (phones cannot reach the developer's machine).
 * Anon key is public-by-design.
 */
const CLOUD_PROD_FALLBACK: Config = {
  supabaseUrl: 'https://tiizkjhbrnaibaagmurl.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE',
  apiBaseUrl: 'https://lantern-study-api.onrender.com',
};

/** @deprecated use CLOUD_PROD_FALLBACK */
const MOBILE_PROD_FALLBACK = CLOUD_PROD_FALLBACK;

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

const LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const LOOPBACK_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i;
const VITE_DEV_PORTS = new Set(['5173', '5174', '5175', '5176']);

const isLoopbackHost = (host: string): boolean => LOOPBACK_HOST_RE.test(host);

const isLoopbackOrDevProxyUrl = (url: string): boolean => {
  if (!url) return true;
  if (url.startsWith('/')) return true; // relative / Vite proxy path
  if (LOOPBACK_URL_RE.test(url)) return true;
  if (url.includes('__lantern_api')) return true;
  return false;
};

/** True when URL points at the Render API host (cross-site vs lanternstudy.com). */
const isCrossSiteRenderApiUrl = (url: string): boolean =>
  /lantern-study-api\.onrender\.com/i.test(url);

/** Hosted production web (phones must never call the developer's localhost). */
const isDeployedWebHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (isLoopbackHost(host)) return false;
  if (host === 'lanternstudy.com' || host === 'www.lanternstudy.com') return true;
  if (host.endsWith('.pages.dev')) return true;
  // Any https public host serving this SPA is treated as deployed.
  return window.location.protocol === 'https:';
};

/**
 * Resolve API base for web:
 * - Deployed site → same-origin '' so `/api/*` hits the Cloudflare Pages proxy
 *   (first-party cookies; cross-site cookies from *.onrender.com are blocked in Chrome)
 * - Local Vite on LAN → same-origin `/__lantern_api` proxy
 */
const resolveWebApiBaseUrl = (apiBaseUrl: string): string => {
  if (typeof window === 'undefined') return apiBaseUrl;

  if (isDeployedWebHost()) {
    // Empty base → fetch('/api/v1/...') on lanternstudy.com (Pages Function → Render).
    // Never call onrender.com directly from the browser when cookie auth is used.
    if (!apiBaseUrl || isLoopbackOrDevProxyUrl(apiBaseUrl) || isCrossSiteRenderApiUrl(apiBaseUrl)) {
      return '';
    }
    return apiBaseUrl;
  }

  const { hostname, origin, port } = window.location;
  const onViteDevPort = VITE_DEV_PORTS.has(port);

  if (apiBaseUrl.startsWith('/')) return apiBaseUrl;

  const pointsAtLoopback = LOOPBACK_URL_RE.test(apiBaseUrl) || apiBaseUrl.includes('__lantern_api');

  if (!isLoopbackHost(hostname) && pointsAtLoopback) {
    return onViteDevPort
      ? `${origin}/__lantern_api`
      : apiBaseUrl.replace(LOOPBACK_URL_RE, `${window.location.protocol}//${hostname}`);
  }

  if (!isLoopbackHost(hostname) && onViteDevPort && /^https?:\/\//i.test(apiBaseUrl)) {
    return `${origin}/__lantern_api`;
  }

  if (onViteDevPort && pointsAtLoopback) {
    return '/__lantern_api';
  }

  return apiBaseUrl;
};

const resolveWebSupabaseUrl = (supabaseUrl: string): string => {
  if (typeof window === 'undefined') return supabaseUrl;
  if (isDeployedWebHost() && (!supabaseUrl || LOOPBACK_URL_RE.test(supabaseUrl))) {
    return CLOUD_PROD_FALLBACK.supabaseUrl;
  }
  return supabaseUrl;
};

const isCloudSupabaseUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.supabase.co');
  } catch {
    return false;
  }
};

/** Project ref from `https://<ref>.supabase.co` (null if not a standard cloud host). */
export const getCloudSupabaseProjectRef = (url: string): string | null => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.endsWith('.supabase.co')) return null;
    const ref = host.slice(0, -'.supabase.co'.length);
    return ref && !ref.includes('.') ? ref : null;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : typeof Buffer !== 'undefined'
          ? Buffer.from(padded, 'base64').toString('utf8')
          : null;
    if (!json) return null;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * True when a cloud Supabase URL is paired with a local-demo / wrong-project anon JWT.
 * Publishable keys (`sb_publishable_…`) are left alone (not JWTs).
 */
export const isMismatchedCloudSupabaseAnonKey = (
  supabaseUrl: string,
  supabaseAnonKey: string
): boolean => {
  if (!supabaseUrl || !isCloudSupabaseUrl(supabaseUrl)) return false;
  if (!supabaseAnonKey) return true;
  if (supabaseAnonKey.startsWith('sb_publishable_')) return false;

  const expectedRef = getCloudSupabaseProjectRef(supabaseUrl);
  const payload = decodeJwtPayload(supabaseAnonKey);
  if (!payload) return true;

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const ref = typeof payload.ref === 'string' ? payload.ref : '';
  if (iss === 'supabase-demo') return true;
  if (expectedRef && ref && ref !== expectedRef) return true;
  if (expectedRef && !ref) return true;
  return false;
};

/**
 * Never call cloud Supabase with the local demo anon key (or another project's JWT).
 * For Lantern's cloud project, swap in {@link CLOUD_PROD_FALLBACK}'s anon key.
 */
export const reconcileSupabaseAnonKey = (
  supabaseUrl: string,
  supabaseAnonKey: string
): string => {
  if (!isMismatchedCloudSupabaseAnonKey(supabaseUrl, supabaseAnonKey)) {
    return supabaseAnonKey || CLOUD_PROD_FALLBACK.supabaseAnonKey;
  }

  const expectedRef = getCloudSupabaseProjectRef(supabaseUrl);
  const fallbackRef = getCloudSupabaseProjectRef(CLOUD_PROD_FALLBACK.supabaseUrl);
  if (
    expectedRef &&
    fallbackRef &&
    expectedRef === fallbackRef
  ) {
    return CLOUD_PROD_FALLBACK.supabaseAnonKey;
  }

  // Unknown cloud project with a demo/wrong key — cannot invent their anon key.
  return supabaseAnonKey;
};

const finalizeConfig = (config: Config): Config => ({
  ...config,
  supabaseAnonKey: reconcileSupabaseAnonKey(config.supabaseUrl, config.supabaseAnonKey),
});

/** User-facing copy when Supabase returns UNAUTHORIZED_INVALID_API_KEY. */
export const SUPABASE_INVALID_API_KEY_USER_MESSAGE =
  'App is misconfigured (Supabase key). Use https://lanternstudy.com or fix local .env (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be from the same project), then restart the dev server.';

export const formatSupabaseClientAuthError = (message: string): string => {
  if (/invalid api key/i.test(message)) {
    return SUPABASE_INVALID_API_KEY_USER_MESSAGE;
  }
  return message;
};

/**
 * Get the full configuration based on platform and environment
 */
export const getConfig = (): Config => {
  const platform = getPlatform();
  const env = getEnvironment();

  // Production: use environment variables (with validation)
  if (env === 'production') {
    let supabaseUrl = getEnvVar('SUPABASE_URL');
    const supabaseAnonKey = getEnvVar('SUPABASE_ANON_KEY');
    let apiBaseUrl = getEnvVar('API_URL');

    if (platform === 'web') {
      // Never ship phones a localhost API/DB — recover even if the build baked bad env.
      apiBaseUrl = resolveWebApiBaseUrl(apiBaseUrl || CLOUD_PROD_FALLBACK.apiBaseUrl);
      supabaseUrl = resolveWebSupabaseUrl(supabaseUrl || CLOUD_PROD_FALLBACK.supabaseUrl);
      return finalizeConfig({
        supabaseUrl,
        supabaseAnonKey: supabaseAnonKey || CLOUD_PROD_FALLBACK.supabaseAnonKey,
        apiBaseUrl,
      });
    }

    const missing: string[] = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
    if (!apiBaseUrl) missing.push('API_URL');

    if (missing.length > 0) {
      // Mobile preview/production OTA: never hard-fail chat/API over missing inlined env.
      if (platform === 'mobile') {
        return finalizeConfig({
          supabaseUrl: supabaseUrl || MOBILE_PROD_FALLBACK.supabaseUrl,
          supabaseAnonKey: supabaseAnonKey || MOBILE_PROD_FALLBACK.supabaseAnonKey,
          apiBaseUrl: apiBaseUrl || MOBILE_PROD_FALLBACK.apiBaseUrl,
        });
      }
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    }

    return finalizeConfig({
      supabaseUrl: supabaseUrl || '',
      supabaseAnonKey: supabaseAnonKey || '',
      apiBaseUrl: apiBaseUrl || '',
    });
  }

  // Development: use platform-specific defaults, allow env override
  const defaultConfig = platform === 'mobile' ? MOBILE_DEV_CONFIG : DEV_CONFIG;
  let apiBaseUrl = getEnvVar('API_URL') || defaultConfig.apiBaseUrl;
  let supabaseUrl = getEnvVar('SUPABASE_URL') || defaultConfig.supabaseUrl;
  if (platform === 'web') {
    apiBaseUrl = resolveWebApiBaseUrl(apiBaseUrl);
    supabaseUrl = resolveWebSupabaseUrl(supabaseUrl);
  }

  return finalizeConfig({
    supabaseUrl,
    supabaseAnonKey: getEnvVar('SUPABASE_ANON_KEY') || defaultConfig.supabaseAnonKey,
    apiBaseUrl,
  });
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
