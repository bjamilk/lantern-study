import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { isAppleSignInAvailable } from '../../services/socialAuth';
import { brand } from '../../theme';

type SocialProvider = 'google' | 'apple';

interface Props {
  disabled?: boolean;
}

// Google's four-colour "G". An icon set only ships a single-colour glyph, which
// reads as a generic icon rather than the mark people recognise, so the
// official artwork is inlined here.
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
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

  /**
   * The store rethrows anything that is not a cancellation, and these are
   * fire-and-forget `onPress` handlers — so without this catch every provider
   * failure became an UNHANDLED PROMISE REJECTION with nothing on screen
   * (Sentry LANTERN-STUDY-MOBILE-7). The student gets a toast; the error is
   * already in the store for the form to render.
   */
  const run = async (provider: SocialProvider, start: () => Promise<void>) => {
    if (busy) return;
    setActiveProvider(provider);
    try {
      await start();
    } catch (error: unknown) {
      const fallback = provider === 'google' ? 'Google sign-in failed.' : 'Apple sign-in failed.';
      const message = error instanceof Error && error.message ? error.message : fallback;
      useToastStore.getState().showToast(message, 'error');
    } finally {
      setActiveProvider(null);
    }
  };

  const runGoogle = () => run('google', signInWithGoogle);
  const runApple = () => run('apple', signInWithApple);

  return (
    <View className="mt-6">
      <View className="flex-row items-center mb-4">
        <View className="flex-1 h-px bg-lantern-background-secondary" />
        <Text className="mx-3 text-sm text-lantern-text-secondary">Or continue with</Text>
        <View className="flex-1 h-px bg-lantern-background-secondary" />
      </View>

      {/* Stacked full-width rather than side-by-side: a provider button is
          recognised by its wordmark, and two half-width buttons squeeze that
          down to a bare icon. */}
      <View className="gap-3">
        <Pressable
          onPress={() => void runGoogle()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: busy, busy: loading('google') }}
          className={`h-12 flex-row items-center justify-center gap-3 rounded-2xl border border-lantern-border bg-lantern-surface ${
            busy ? 'opacity-50' : ''
          }`}
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
        >
          {loading('google') ? (
            <ActivityIndicator size="small" color={brand.text} />
          ) : (
            <>
              <GoogleMark size={20} />
              <Text
                importantForAccessibility="no"
                className="text-sm font-semibold text-lantern-text"
              >
                Continue with Google
              </Text>
            </>
          )}
        </Pressable>

        {appleAvailable ? (
          <View style={{ opacity: busy ? 0.5 : 1 }} pointerEvents={busy ? 'none' : 'auto'}>
            {loading('apple') ? (
              <View className="h-12 items-center justify-center rounded-2xl border border-lantern-border">
                <ActivityIndicator size="small" color={brand.text} />
              </View>
            ) : (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={16}
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
