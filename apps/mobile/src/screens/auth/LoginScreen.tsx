import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { isEmailNotConfirmedError } from '@lantern/shared';
import { Button } from '../../components/ui';
import { LanternLogo } from '../../components/LanternLogo';
import { SocialAuthButtons } from '../../components/auth/SocialAuthButtons';
import { useCookieNoticeBottomInset } from '../../components/CookieNoticeBanner';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { signIn, isLoading, error, clearError } = useAuthStore();
  const cookieNoticeInset = useCookieNoticeBottomInset();

  const onSubmit = async () => {
    clearError();
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (isEmailNotConfirmedError(err)) {
        navigation.navigate('VerifyEmail', { email: email.trim() });
      }
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
            <Text className="text-3xl font-bold text-lantern-text tracking-tight">Lantern Study</Text>
            <Text className="text-lantern-text-secondary mt-1">Sign in to continue</Text>
          </View>

          {error ? (
            <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4">
              <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
            </View>
          ) : null}

          <View className="gap-3">
            <View>
              <Text className="text-sm font-medium text-lantern-text-secondary mb-1.5">Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@university.edu"
                placeholderTextColor="#64748b"
                className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-3 text-lantern-text"
              />
            </View>
            <View>
              <Text className="text-sm font-medium text-lantern-text-secondary mb-1.5">Password</Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#64748b"
                  className="bg-lantern-surface border border-lantern-border rounded-xl px-4 py-3 pr-12 text-lantern-text"
                />
                <Pressable
                  onPress={() => setShowPassword(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-3"
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#64748b" />
                </Pressable>
              </View>
            </View>
          </View>

          <View className="mt-6 gap-3">
            <Button fullWidth loading={isLoading} onPress={onSubmit}>
              Sign in
            </Button>
            <Pressable onPress={() => navigation.navigate('ForgotPassword')} className="py-2">
              <Text className="text-center text-sm text-lantern-primary">
                Forgot your password?
              </Text>
            </Pressable>
            <Button fullWidth variant="secondary" onPress={() => navigation.navigate('SignUp')}>
              Create account
            </Button>
          </View>

          <SocialAuthButtons disabled={isLoading} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
