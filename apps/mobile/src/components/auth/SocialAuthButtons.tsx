import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../stores/authStore';
import { isAppleSignInAvailable } from '../../services/socialAuth';

type SocialProvider = 'google' | 'apple';

interface Props {
  disabled?: boolean;
}

export function SocialAuthButtons({ disabled = false }: Props) {
  const { signInWithGoogle, signInWithApple, isLoading } = useAuthStore();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(null);

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const busy = disabled || isLoading;
  const loading = (provider: SocialProvider) => activeProvider === provider && isLoading;

  const runGoogle = async () => {
    if (busy) return;
    setActiveProvider('google');
    try {
      await signInWithGoogle();
    } finally {
      setActiveProvider(null);
    }
  };

  const runApple = async () => {
    if (busy) return;
    setActiveProvider('apple');
    try {
      await signInWithApple();
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <View className="mt-6">
      <View className="flex-row items-center mb-4">
        <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        <Text className="mx-3 text-sm text-slate-500 dark:text-slate-400">Or continue with</Text>
        <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </View>

      <View className={`flex-row gap-3 ${appleAvailable ? '' : 'justify-center'}`}>
        <Pressable
          onPress={() => void runGoogle()}
          disabled={busy}
          className={`flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 ${
            busy ? 'opacity-50' : ''
          } ${!appleAvailable ? 'max-w-xs' : ''}`}
        >
          {loading('google') ? (
            <ActivityIndicator size="small" color="#6366f1" />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color="#4285F4" />
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">Google</Text>
            </>
          )}
        </Pressable>

        {appleAvailable ? (
          <View className="flex-1" style={{ opacity: busy ? 0.5 : 1 }} pointerEvents={busy ? 'none' : 'auto'}>
            {loading('apple') ? (
              <View className="h-12 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-600">
                <ActivityIndicator size="small" color="#6366f1" />
              </View>
            ) : (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={12}
                style={{ width: '100%', height: 48 }}
                onPress={() => void runApple()}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}
