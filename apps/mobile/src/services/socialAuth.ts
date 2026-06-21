import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ensureUserProfile } from './ensureUserProfile';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({ scheme: 'lanternstudy' });

export async function signInWithGoogleOAuth(): Promise<{ user: User; session: Session }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error('No OAuth URL returned from Supabase');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Google sign-in was cancelled');
  }
  if (result.type !== 'success') {
    throw new Error('Google sign-in failed');
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(String(errorCode));
  if (!params.code) throw new Error('No authorization code in redirect URL');

  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(params.code);
  if (exchangeError) throw exchangeError;
  if (!sessionData.session?.user) throw new Error('No session after Google sign-in');

  await ensureUserProfile(sessionData.session.user);
  return { user: sessionData.session.user, session: sessionData.session };
}

export async function signInWithAppleNative(): Promise<{ user: User; session: Session }> {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple Sign In is only available on iOS');
  }

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error('Apple Sign In is not available on this device');
  }

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error('Apple Sign In failed — no identity token');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
  if (!data.session?.user) throw new Error('No session after Apple sign-in');

  if (credential.fullName) {
    const parts = [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean);
    const name = parts.join(' ').trim();
    if (name) {
      await supabase.auth.updateUser({ data: { name } });
    }
  }

  await ensureUserProfile(data.session.user);
  return { user: data.session.user, session: data.session };
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}
