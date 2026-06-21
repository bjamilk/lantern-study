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
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/ui';
import { LanternLogo } from '../../components/LanternLogo';
import { establishSessionFromAuthUrl, updateAuthPassword } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

export function ResetPasswordScreen({ navigation }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const setPasswordRecovery = useAuthStore((s) => s.setPasswordRecovery);

  useEffect(() => {
    let active = true;
    const establish = async (url: string | null) => {
      if (!url) return;
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
  }, [setPasswordRecovery]);

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
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="flex-grow px-6 py-8 justify-center">
          <View className="items-center mb-8">
            <LanternLogo size={64} style={{ marginBottom: 16 }} />
            <Text className="text-2xl font-bold text-slate-900 dark:text-white">Set new password</Text>
            <Text className="text-slate-500 dark:text-slate-400 mt-2 text-center">
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
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">New password</Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94a3b8"
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 pr-12 text-slate-900 dark:text-white"
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} className="absolute right-3 top-3">
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#94a3b8" />
                </Pressable>
              </View>
            </View>
            <View>
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm password</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                placeholderTextColor="#94a3b8"
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
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
