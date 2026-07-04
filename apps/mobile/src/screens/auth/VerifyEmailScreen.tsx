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
import { isAllowedMobileAuthUrl } from '../../utils/deepLinkAllowlist';
import {
  establishSessionFromAuthUrl,
  getMobileAuthRedirectUri,
  resendSignupConfirmation,
  verifySignupOtp,
} from '../../services/supabase';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

export function VerifyEmailScreen({ navigation, route }: Props) {
  const email = route.params.email;
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    const tryMagicLink = async (url: string | null) => {
      if (!url || !isAllowedMobileAuthUrl(url)) return;
      try {
        const session = await establishSessionFromAuthUrl(url);
        if (session) {
          setMessage('Email verified! Signing you in…');
        }
      } catch {
        // User can still enter OTP manually
      }
    };
    void Linking.getInitialURL().then((url) => void tryMagicLink(url));
    const sub = Linking.addEventListener('url', ({ url }) => void tryMagicLink(url));
    return () => sub.remove();
  }, []);

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
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="flex-grow px-6 py-8 justify-center">
          <View className="items-center mb-8">
            <LanternLogo size={64} style={{ marginBottom: 16 }} />
            <Text className="text-2xl font-bold text-slate-900 dark:text-white">Verify your email</Text>
            <Text className="text-slate-500 dark:text-slate-400 mt-2 text-center">
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
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-4 text-slate-900 dark:text-white text-center text-2xl tracking-widest font-mono mb-4"
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
