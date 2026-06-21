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

const lanApiHost = Constants.expoConfig?.extra?.lanApiHost || '127.0.0.1';
const emulatorApiHost = Constants.expoConfig?.extra?.emulatorApiHost || '10.0.2.2';
const defaultHost = isAndroidEmulator() ? emulatorApiHost : lanApiHost;
const isDevRuntime = (Constants.expoConfig?.extra?.appVariant || 'development') === 'development';

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

const configuredSupabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  (isDevRuntime ? `http://${defaultHost}:55421` : '');

const supabaseUrl = resolveDevServiceUrl(configuredSupabaseUrl);

const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  (isDevRuntime ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' : '');

const configuredApiUrl =
  Constants.expoConfig?.extra?.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  (isDevRuntime ? `http://${defaultHost}:3001` : '');

// API server URL for backend calls
export const API_BASE_URL = resolveDevServiceUrl(configuredApiUrl);

if (!isDevRuntime && (!supabaseUrl || !supabaseAnonKey || !API_BASE_URL)) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, or EXPO_PUBLIC_API_URL');
}

// Create Supabase client with React Native AsyncStorage
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
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

// Helper to get auth headers for API calls
export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  let session = await getSession();

  if (!session?.access_token) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      session = data.session;
    }
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
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

export const updateAuthPassword = async (newPassword: string) => {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
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
  const { data: { user } } = await supabase.auth.getUser();
  const authUserId = user?.id || userId;
  if (!authUserId) return false;

  const dbType = transaction.type.toLowerCase();
  const { error } = await supabase.from('budget_transactions').upsert(
    {
      id: transaction.id,
      user_id: authUserId,
      type: dbType,
      amount: transaction.amount,
      category: transaction.category,
      description: transaction.description,
      date: transaction.date,
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.error('Error saving budget transaction:', error);
    return false;
  }
  return true;
};

export const deleteBudgetTransaction = async (transactionId: string): Promise<boolean> => {
  const { error } = await supabase.from('budget_transactions').delete().eq('id', transactionId);
  if (error) {
    console.error('Error deleting budget transaction:', error);
    return false;
  }
  return true;
};
