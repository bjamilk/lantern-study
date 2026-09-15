/**
 * Auth stack -> VerifyEmail. Confirms a new account either by the 6-digit OTP
 * typed in here or by the magic link in the same email, and offers a
 * cooldown-gated resend. Route param: { email }.
 *
 * Exports: VerifyEmailScreen (named).
 * Touches: expo-linking, deepLinkAllowlist `planAuthDeepLink`,
 * components/ui/appDialog `confirmAsync` (the consent step), authStore.user
 * (whoever is already signed in here), services/supabase
 * establishSessionFromAuthUrl / verifySignupOtp / resendSignupConfirmation /
 * getMobileAuthRedirectUri.
 */
// FIXED (F45): the magic-link effect no longer signs anyone in on its own. An
// incoming URL is untrusted — any installed app can send
// `lanternstudy://verify-email#access_token=…` — so the link is classified
// behind the scheme/host allowlist and the student confirms "Sign in as
// <email>?" before a session is established. A link for a different account
// than the one already signed in here is refused, not silently honoured.
// The magic-link failure is still non-fatal (the OTP field below stays usable)
// but it is now SAID, not swallowed.
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isValidOtpCode, RESEND_COOLDOWN_SECONDS } from '@lantern/shared';
import { Button } from '../../components/ui';
import { LanternLogo } from '../../components/LanternLogo';
import { ResendEmailButton } from '../../components/auth/ResendEmailButton';
import { planAuthDeepLink } from '../../utils/deepLinkAllowlist';
import { confirmAsync } from '../../components/ui/appDialog';
import { useAuthStore } from '../../stores/authStore';
import {
  establishSessionFromAuthUrl,
  getMobileAuthRedirectUri,
  resendSignupConfirmation,
  verifySignupOtp,
} from '../../services/supabase';
import type { AuthStackParamList } from '../../navigation/types';
// The cookie notice is an app-root `absolute bottom-0` overlay during the
// whole first-run flow; without its height reserved it covers the footer links.
import { useCookieNoticeBottomInset } from '../../components/CookieNoticeBanner';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

export function VerifyEmailScreen({ navigation, route }: Props) {
  const cookieNoticeInset = useCookieNoticeBottomInset();
  const email = route.params.email;
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    const handled = new Set<string>();
    const tryMagicLink = async (url: string | null) => {
      if (!url) return;
      // The cold-start URL and the 'url' event can deliver the same link twice.
      if (handled.has(url)) return;
      handled.add(url);

      const plan = planAuthDeepLink(url, { userId: currentUser?.id, email: currentUser?.email });
      if (plan.action === 'ignore') return;
      if (plan.action === 'already-signed-in') {
        setMessage('This device is already signed in to that account.');
        return;
      }
      if (plan.action === 'show-error') {
        setError('That confirmation link has expired or has already been used. Enter the code below, or resend the email.');
        return;
      }
      if (plan.action === 'confirm-sign-out-first') {
        setError(
          `That link is for ${plan.email ?? 'another account'}. Sign out of ` +
            `${plan.currentEmail ?? 'this account'} first, then open it again.`
        );
        return;
      }

      const confirmed = await confirmAsync(
        `Sign in as ${plan.email ?? email}?`,
        'You opened an email-confirmation link. Only continue if you asked for it.',
        { confirmLabel: 'Continue' }
      );
      if (!confirmed) {
        setMessage('Link ignored. You can still enter the 6-digit code from your email below.');
        return;
      }

      try {
        const session = await establishSessionFromAuthUrl(url);
        if (session) {
          setMessage('Email verified! Signing you in…');
        }
      } catch (err) {
        // Non-fatal: the OTP field below is the other way in. Say so anyway —
        // silence here read as "the app did nothing".
        setError(
          err instanceof Error && err.message
            ? `${err.message} Enter the 6-digit code from your email instead.`
            : 'That link could not be used. Enter the 6-digit code from your email instead.'
        );
      }
    };
    void Linking.getInitialURL().then((url) => void tryMagicLink(url));
    const sub = Linking.addEventListener('url', ({ url }) => void tryMagicLink(url));
    return () => sub.remove();
  }, [email, currentUser?.id, currentUser?.email]);

  const handleVerify = async () => {
    if (!isValidOtpCode(otpCode)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await verifySignupOtp(email, otpCode);
      setMessage('Email verified! Signing you in…');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResendLoading(true);
    setError('');
    try {
      await resendSignupConfirmation(email, getMobileAuthRedirectUri('verify-email'));
      setMessage('Confirmation email sent. Check your inbox.');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend email.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background">
      <KeyboardAvoidingView
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        className="flex-1"
      >
        {/* Without persist-taps the first tap on the primary button is
            swallowed dismissing the keyboard, so it needs two. */}
        <ScrollView
          contentContainerClassName="flex-grow px-6 py-8 justify-center"
          contentContainerStyle={{ paddingBottom: 24 + cookieNoticeInset }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-8">
            <LanternLogo size={64} style={{ marginBottom: 16 }} />
            <Text className="text-2xl font-bold text-lantern-text dark:text-white">Verify your email</Text>
            <Text className="text-lantern-text-secondary mt-2 text-center">
              Enter the 6-digit code sent to {email}
            </Text>
          </View>

          {error ? (
            <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4">
              <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
            </View>
          ) : null}

          {message ? (
            <View className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 mb-4">
              <Text className="text-green-700 dark:text-green-300 text-sm">{message}</Text>
            </View>
          ) : null}

          <TextInput
            value={otpCode}
            onChangeText={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor="#94a3b8"
            className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-4 text-lantern-text dark:text-white text-center text-2xl tracking-widest font-mono mb-4"
          />

          <Button fullWidth loading={loading} onPress={handleVerify}>
            Verify email
          </Button>

          <ResendEmailButton
            label="Resend confirmation email"
            cooldownSeconds={resendCooldown}
            loading={resendLoading}
            onPress={handleResend}
          />

          <Button fullWidth variant="ghost" onPress={() => navigation.navigate('Login')}>
            Back to sign in
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
