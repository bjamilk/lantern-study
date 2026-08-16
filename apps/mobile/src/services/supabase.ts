/**
 * Mobile Supabase Client
 * Configured for React Native with AsyncStorage session persistence
 * 
 * NOTE: We hardcode LAN URLs here instead of using @lantern/shared's getConfig()
 * because Hermes (React Native's JS engine) doesn't reliably support navigator.product
 * or new Function(), causing the shared config's platform detection to fail and
 * return localhost URLs which are unreachable from a physical device.
 */
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExpoSecureStoreAdapter } from './secureStorage';
import 'react-native-url-polyfill/auto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';

const isAndroidEmulator = () => {
  if (Platform.OS !== 'android') return false;

  const constants = Platform.constants as {
    Brand?: string;
    Fingerprint?: string;
    Manufacturer?: string;
    Model?: string;
  };

  const brand = (constants.Brand || '').toLowerCase();
  const fingerprint = (constants.Fingerprint || '').toLowerCase();
  const manufacturer = (constants.Manufacturer || '').toLowerCase();
  const model = (constants.Model || '').toLowerCase();

  return (
    fingerprint.includes('generic') ||
    fingerprint.includes('emulator') ||
    model.includes('sdk') ||
    model.includes('emulator') ||
    manufacturer.includes('genymotion') ||
    brand.includes('generic')
  );
};

/** Cloud endpoints — public; used when preview/production builds must not use dev LAN URLs. */
const PRODUCTION_ENDPOINTS = {
  supabaseUrl: 'https://tiizkjhbrnaibaagmurl.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE',
  apiUrl: 'https://lantern-study-api.onrender.com',
} as const;

const LOCAL_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const appVariant = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? 'development';
const isDevRuntime = appVariant === 'development';

const lanApiHost = Constants.expoConfig?.extra?.lanApiHost || '127.0.0.1';
const emulatorApiHost = Constants.expoConfig?.extra?.emulatorApiHost || '10.0.2.2';
const defaultHost = isAndroidEmulator() ? emulatorApiHost : lanApiHost;

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '10.0.2.2' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.')
  );
}

function isLocalDevUrl(url: string): boolean {
  try {
    return isLocalDevHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** In dev, localhost/127.0.0.1 is unreachable off the host machine — rewrite to emulator or LAN IP. */
function resolveDevServiceUrl(url: string): string {
  if (!url || !isDevRuntime) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      parsed.hostname = defaultHost;
      return parsed.origin;
    }
  } catch {
    // ignore malformed URLs
  }

  return url;
}

function pickRuntimeValue(
  extraValue: unknown,
  envValue: string | undefined,
  productionDefault: string,
  devFallback: string
): string {
  if (typeof extraValue === 'string' && extraValue.length > 0) {
    return extraValue;
  }

  if (isDevRuntime) {
    return envValue || devFallback;
  }

  // OTA bundles can embed the publisher's local .env (127.0.0.1) — never use that in preview/production.
  if (envValue && !isLocalDevUrl(envValue)) {
    return envValue;
  }

  return productionDefault;
}

const configuredSupabaseUrl = pickRuntimeValue(
  Constants.expoConfig?.extra?.supabaseUrl,
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  PRODUCTION_ENDPOINTS.supabaseUrl,
  `http://${defaultHost}:55421`
);

const supabaseUrl = resolveDevServiceUrl(configuredSupabaseUrl);

const supabaseAnonKey = pickRuntimeValue(
  Constants.expoConfig?.extra?.supabaseAnonKey,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  PRODUCTION_ENDPOINTS.supabaseAnonKey,
  LOCAL_SUPABASE_ANON_KEY
);

const configuredApiUrl = pickRuntimeValue(
  Constants.expoConfig?.extra?.apiUrl,
  process.env.EXPO_PUBLIC_API_URL,
  PRODUCTION_ENDPOINTS.apiUrl,
  `http://${defaultHost}:3001`
);

// API server URL for backend calls
export const API_BASE_URL = resolveDevServiceUrl(configuredApiUrl);

if (!isDevRuntime && (!supabaseUrl || !supabaseAnonKey || !API_BASE_URL)) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, or EXPO_PUBLIC_API_URL');
}

// Session storage: SecureStore (Keychain) on iOS. On Android, `expo-secure-store`'s
// native Keystore call can block the JS thread indefinitely during Supabase auth init
// and hang app boot (observed on emulator images and the dev client), so use
// AsyncStorage there — it is reliable and still persists the session across launches.
const authStorage = Platform.OS === 'android' ? AsyncStorage : ExpoSecureStoreAdapter;

// Create Supabase client with device-appropriate session persistence
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Not needed in React Native
  },
  global: {
    headers: {
      'Accept': 'application/json, text/plain, */*, application/vnd.pgrst.object+json',
    },
  },
});

// Helper to get current session
export const getSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting session:', error.message);
    return null;
  }
  return session;
};

// Refresh cooldown: without it every getAuthHeaders call re-attempts a failing
// refresh, which is how one bad session turned into a 27-request 401 cascade.
let lastFailedRefreshAt = 0;
const REFRESH_RETRY_COOLDOWN_MS = 30_000;
let missingAuthOccurrences = 0;

// Helper to get auth headers for API calls
export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  let session = await getSession();

  if (!session?.access_token && Date.now() - lastFailedRefreshAt > REFRESH_RETRY_COOLDOWN_MS) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      session = data.session;
    } else {
      lastFailedRefreshAt = Date.now();
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    // Never silent: an unauthenticated header set means every consumer 401s.
    // Loud log (and a counter, so a cascade is obvious in one glance at logcat).
    missingAuthOccurrences += 1;
    console.error(
      `[auth] getAuthHeaders has NO access token (occurrence ${missingAuthOccurrences}); ` +
        'request will be sent unauthenticated and will 401. Session missing and refresh unavailable.'
    );
  }

  return headers;
};

// Auth functions
export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) throw error;
  return data;
};

export const signUpWithEmail = async (email: string, password: string, name?: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name || email.split('@')[0],
      },
    },
  });
  
  if (error) throw error;
  return data;
};

function isAuthSessionMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === 'AuthSessionMissingError' ||
    (typeof err.message === 'string' && err.message.includes('Auth session missing'))
  );
}

export const signOut = async () => {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    if (isAuthSessionMissingError(error)) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return;
    }
    throw error;
  }
};

export const resetPassword = async (email: string, redirectTo?: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo ?? getMobileAuthRedirectUri('reset-password'),
  });
  if (error) throw error;
  return data;
};

export function getMobileAuthRedirectUri(path: 'reset-password' | 'verify-email') {
  return makeRedirectUri({ scheme: 'lanternstudy', path });
}

export async function establishSessionFromAuthUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(String(errorCode));

  if (params.access_token && params.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: String(params.access_token),
      refresh_token: String(params.refresh_token),
    });
    if (error) throw error;
    return data.session;
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(String(params.code));
    if (error) throw error;
    return data.session;
  }

  return null;
}

export const resendSignupConfirmation = async (email: string, redirectTo?: string) => {
  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirectTo ?? getMobileAuthRedirectUri('verify-email') },
  });
  if (error) throw error;
  return data;
};

export const verifySignupOtp = async (email: string, token: string) => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.replace(/\D/g, '').slice(0, 6),
    type: 'signup',
  });
  if (error) throw error;
  return data;
};

/**
 * Sign out every other device after a credential change. Best-effort: a
 * failure must not make a successful password change look failed, but it is
 * logged because it leaves stale sessions alive.
 */
export const revokeOtherSessions = async (): Promise<boolean> => {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/revoke-other-sessions`, {
      method: 'POST',
      headers,
    });
    return response.ok;
  } catch (e) {
    console.error('Failed to revoke other sessions after password change:', e);
    return false;
  }
};

export const updateAuthPassword = async (newPassword: string, email?: string) => {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;

  // A password change must not leave sessions alive on devices the user may
  // no longer control. The global revoke ends this session too, so
  // re-authenticate right after when we know the account email; the fresh
  // token is issued after the cutoff and survives it.
  const revoked = await revokeOtherSessions();
  const accountEmail = email || data.user?.email;
  if (revoked && accountEmail) {
    try {
      await supabase.auth.signInWithPassword({ email: accountEmail, password: newPassword });
    } catch (e) {
      console.warn('Re-authentication after password change failed; sign in again', e);
    }
  }

  return data;
};

// Listen for auth state changes
export const onAuthStateChange = (callback: (event: string, session: any) => void) => {
  return supabase.auth.onAuthStateChange(callback);
};

export interface BudgetTransactionRow {
  id: string;
  user_id: string;
  type: 'income' | 'expense' | 'investment';
  amount: number;
  category?: string;
  description?: string;
  date: string;
}

export const fetchBudgetTransactions = async (userId: string): Promise<BudgetTransactionRow[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  const authUserId = user?.id || userId;

  const { data, error } = await supabase
    .from('budget_transactions')
    .select('id, user_id, type, amount, category, description, date')
    .eq('user_id', authUserId)
    .order('date', { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []).map((row) => ({
    ...row,
    amount: typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount)),
  }));
};

export interface BudgetTransactionInput {
  id: string;
  type: string;
  amount: number;
  category?: string;
  description?: string;
  date: string;
}

export const saveBudgetTransaction = async (
  userId: string,
  transaction: BudgetTransactionInput
): Promise<boolean> => {
  try {
    // Prefer API (service role) — direct PostgREST upsert hits RLS on conflict path.
    const { saveBudgetTransaction } = await import('./api');
    await saveBudgetTransaction(userId, {
      id: transaction.id,
      type: transaction.type.toLowerCase(),
      amount: transaction.amount,
      category: transaction.category,
      description: transaction.description,
      date: transaction.date,
    });
    return true;
  } catch (error) {
    console.error('Error saving budget transaction:', error);
    return false;
  }
};

export const deleteBudgetTransaction = async (transactionId: string): Promise<boolean> => {
  try {
    const { deleteBudgetTransaction: deleteViaApi } = await import('./api');
    // API requires userId for signature compatibility; ownership enforced server-side.
    await deleteViaApi('', transactionId);
    return true;
  } catch (error) {
    console.error('Error deleting budget transaction:', error);
    return false;
  }
};
