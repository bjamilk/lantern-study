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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RESEND_COOLDOWN_SECONDS } from '@lantern/shared';
import { Button } from '../../components/ui';
import { LanternLogo } from '../../components/LanternLogo';
import { ResendEmailButton } from '../../components/auth/ResendEmailButton';
import { resetPassword } from '../../services/supabase';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
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

  const sendReset = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(trimmed);
      setSent(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setResendLoading(true);
    setError('');
    try {
      await resetPassword(email.trim());
      setSent(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend reset email.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="flex-grow px-6 py-8 justify-center">
          <View className="items-center mb-8">
            <LanternLogo size={64} style={{ marginBottom: 16 }} />
            <Text className="text-2xl font-bold text-lantern-text dark:text-white">Reset password</Text>
            <Text className="text-lantern-text-secondary mt-2 text-center">
              Enter your email and we will send a reset link.
            </Text>
          </View>

          {error ? (
            <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4">
              <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
            </View>
          ) : null}

          {sent ? (
            <View className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 mb-4">
              <Text className="text-green-700 dark:text-green-300 text-sm">
                Password reset email sent! Check your inbox.
              </Text>
            </View>
          ) : null}

          <View className="mb-4">
            <Text className="text-sm font-medium text-lantern-text mb-1.5">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@university.edu"
              placeholderTextColor="#94a3b8"
              className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white"
            />
          </View>

          <Button fullWidth loading={loading} onPress={sendReset}>
            {sent ? 'Send again' : 'Send reset email'}
          </Button>

          {sent ? (
            <ResendEmailButton
              label="Resend reset email"
              cooldownSeconds={resendCooldown}
              loading={resendLoading}
              onPress={handleResend}
            />
          ) : null}

          <Button fullWidth variant="ghost" onPress={() => navigation.navigate('Login')}>
            Back to sign in
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
