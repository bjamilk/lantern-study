/**
 * Auth stack -> ResetPassword. Landing screen for the emailed reset link: it
 * turns the link into a Supabase session, then takes the new password.
 *
 * Exports: ResetPasswordScreen (named).
 * Touches: expo-linking (initial URL + 'url' events), deepLinkAllowlist
 * `planAuthDeepLink`, components/ui/appDialog `confirmAsync` (the consent step),
 * services/supabase establishSessionFromAuthUrl and updateAuthPassword,
 * authStore.setPasswordRecovery (held true while the recovery session is live,
 * cleared once the password is updated) and authStore.user (the account already
 * signed in here, if any).
 */
// FIXED (F45): the mount effect no longer turns an incoming link into a
// session on its own. `planAuthDeepLink` classifies the URL (allowlist first,
// tokens parsed only after) and the student is asked "Sign in as <email>?"
// before `establishSessionFromAuthUrl` runs — otherwise any app able to send
// `lanternstudy://reset-password#access_token=…` could put this handset into
// the attacker's account and collect the new password typed below. Errors are
// shown rather than swallowed.
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { Button } from '../../components/ui';
import { LanternLogo } from '../../components/LanternLogo';
import { planAuthDeepLink } from '../../utils/deepLinkAllowlist';
import { confirmAsync } from '../../components/ui/appDialog';
import { establishSessionFromAuthUrl, updateAuthPassword } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import type { AuthStackParamList } from '../../navigation/types';
// The cookie notice is an app-root `absolute bottom-0` overlay during the
// whole first-run flow; without its height reserved it covers the footer links.
import { useCookieNoticeBottomInset } from '../../components/CookieNoticeBanner';
import { AppIcon } from '../../components/ui/AppIcon';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

export function ResetPasswordScreen({ navigation }: Props) {
  const cookieNoticeInset = useCookieNoticeBottomInset();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const setPasswordRecovery = useAuthStore((s) => s.setPasswordRecovery);
  // Who (if anyone) this handset is already signed in as: a reset link for a
  // different account must not be allowed to switch accounts behind their back.
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    let active = true;
    const handled = new Set<string>();
    const establish = async (url: string | null) => {
      if (!url) return;
      // The cold-start URL and the 'url' event can both deliver the same link.
      if (handled.has(url)) return;
      handled.add(url);

      const plan = planAuthDeepLink(url, { userId: currentUser?.id, email: currentUser?.email });
      if (plan.action === 'ignore') return;
      if (plan.action === 'show-error') {
        if (active) setError('That reset link has expired or has already been used. Request a new one.');
        return;
      }
      if (plan.action === 'already-signed-in') {
        if (active) {
          setSessionReady(true);
          setPasswordRecovery(true);
        }
        return;
      }
      if (plan.action === 'confirm-sign-out-first') {
        if (active) {
          setError(
            `This link is for ${plan.email ?? 'another account'}. Sign out of ` +
              `${plan.currentEmail ?? 'this account'} first, then open the link again.`
          );
        }
        return;
      }

      const confirmed = await confirmAsync(
        plan.email ? `Sign in as ${plan.email}?` : 'Use this reset link?',
        'You opened a password-reset link. Only continue if you asked for it — otherwise the new password you set would belong to someone else’s account.',
        { confirmLabel: 'Continue' }
      );
      if (!confirmed) {
        if (active) setError('Reset link ignored. Request a new one from the sign-in screen when you are ready.');
        return;
      }

      try {
        await establishSessionFromAuthUrl(url);
        if (active) {
          setSessionReady(true);
          setPasswordRecovery(true);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Invalid or expired reset link.');
        }
      }
    };

    void Linking.getInitialURL().then((url) => void establish(url));
    const sub = Linking.addEventListener('url', ({ url }) => void establish(url));
    return () => {
      active = false;
      sub.remove();
    };
  }, [setPasswordRecovery, currentUser?.id, currentUser?.email]);

  const handleSubmit = async () => {
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await updateAuthPassword(password);
      setSuccess(true);
      setPasswordRecovery(false);
      setTimeout(() => navigation.navigate('Login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
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
            <Text className="text-2xl font-bold text-lantern-text dark:text-white">Set new password</Text>
            <Text className="text-lantern-text-secondary mt-2 text-center">
              {sessionReady
                ? 'Choose a strong password for your account.'
                : 'Open the reset link from your email, or paste the link in your browser to return here.'}
            </Text>
          </View>

          {error ? (
            <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4">
              <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
            </View>
          ) : null}

          {success ? (
            <View className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 mb-4">
              <Text className="text-green-700 dark:text-green-300 text-sm">
                Password updated! Redirecting to sign in…
              </Text>
            </View>
          ) : null}

          <View className="gap-3 mb-4">
            <View>
              <Text className="text-sm font-medium text-lantern-text mb-1.5">New password</Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94a3b8"
                  className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-3 pr-12 text-lantern-text dark:text-white"
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} className="absolute right-3 top-3">
                  <AppIcon name={showPassword ? 'eye-off' : 'eye'} size={22} color="#94a3b8" />
                </Pressable>
              </View>
            </View>
            <View>
              <Text className="text-sm font-medium text-lantern-text mb-1.5">Confirm password</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                placeholderTextColor="#94a3b8"
                className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white"
              />
            </View>
          </View>

          <Button fullWidth loading={loading} disabled={success} onPress={handleSubmit}>
            Update password
          </Button>

          <Button fullWidth variant="ghost" onPress={() => navigation.navigate('Login')}>
            Back to sign in
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
