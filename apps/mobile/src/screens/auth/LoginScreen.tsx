// ===========================================
// Lantern Study Mobile - Login Screen
// ===========================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { useTheme } from '../../theme';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

// Type imports will be resolved once navigation is properly set up
type LoginScreenProps = NativeStackScreenProps<any, 'Login'>;

// Warm up the browser for faster OAuth
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | 'twitter' | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  
  // Forgot Password Modal State
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  const { signIn, isLoading: authLoading, error: authError } = useAuthStore();

  const validateEmail = (emailStr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);

  const validateForm = useCallback(() => {
    const newErrors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [email, password]);

  const handleLogin = useCallback(async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      await signIn(email, password);
      // Navigation will happen automatically via RootNavigator auth state check
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }, [email, password, validateForm, signIn]);

  const handleSocialLogin = useCallback(async (provider: 'google' | 'facebook' | 'twitter') => {
    setSocialLoading(provider);
    try {
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'lanternstudy',
        path: 'auth/callback',
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUri
        );

        if (result.type === 'success') {
          const url = result.url;
          // Extract the tokens from the URL
          const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1]);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (sessionError) {
              throw sessionError;
            }
          }
        }
      }
    } catch (error: any) {
      console.error(`${provider} login error:`, error);
      Alert.alert('Error', error.message || `Failed to sign in with ${provider}`);
    } finally {
      setSocialLoading(null);
    }
  }, []);

  const handleForgotPassword = useCallback(async () => {
    setResetError('');
    
    if (!resetEmail.trim()) {
      setResetError('Please enter your email address');
      return;
    }
    
    if (!validateEmail(resetEmail)) {
      setResetError('Please enter a valid email address');
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: 'lanternstudy://reset-password',
      });

      if (error) {
        setResetError(error.message);
        return;
      }

      setResetEmailSent(true);
    } catch (error: any) {
      setResetError(error.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  }, [resetEmail]);

  const closeForgotPasswordModal = () => {
    setShowForgotPasswordModal(false);
    setResetEmail('');
    setResetEmailSent(false);
    setResetError('');
  };

  const isAnyLoading = isLoading || socialLoading !== null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo and Title */}
        <View style={styles.header}>
          <View style={[styles.logoContainer, { backgroundColor: colors.card }]}>
            <Ionicons name="book" size={60} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Lantern Study</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Welcome back! Sign in to continue your journey.</Text>
        </View>

        {/* Login Form */}
        <View style={styles.form}>
          {/* Email Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.email && styles.inputError]}>
              <Ionicons name="at-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Enter your email"
                placeholderTextColor={colors.inputPlaceholder}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isAnyLoading}
              />
            </View>
            {errors.email && <Text style={[styles.errorText, { color: colors.error }]}>{errors.email}</Text>}
          </View>

          {/* Password Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.password && styles.inputError]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Enter your password"
                placeholderTextColor={colors.inputPlaceholder}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                editable={!isAnyLoading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
                disabled={isAnyLoading}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.inputPlaceholder}
                />
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={[styles.errorText, { color: colors.error }]}>{errors.password}</Text>}
          </View>

          {/* Forgot Password */}
          <TouchableOpacity
            style={styles.forgotPassword}
            onPress={() => setShowForgotPasswordModal(true)}
            disabled={isAnyLoading}
          >
            <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>Forgot your password?</Text>
          </TouchableOpacity>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginButton, { backgroundColor: colors.primary }, isAnyLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isAnyLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={[styles.loginButtonText, { color: colors.textInverse }]}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textSecondary }]}>Or continue with</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          {/* Social Login Buttons */}
          <View style={styles.socialButtonsContainer}>
            {/* Google */}
            <TouchableOpacity
              style={[styles.socialButton, { backgroundColor: colors.card, borderColor: colors.border }, isAnyLoading && styles.buttonDisabled]}
              onPress={() => handleSocialLogin('google')}
              disabled={isAnyLoading}
              activeOpacity={0.8}
            >
              {socialLoading === 'google' ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="logo-google" size={24} color="#4285f4" />
              )}
            </TouchableOpacity>

            {/* Twitter/X */}
            <TouchableOpacity
              style={[styles.socialButton, { backgroundColor: colors.card, borderColor: colors.border }, isAnyLoading && styles.buttonDisabled]}
              onPress={() => handleSocialLogin('twitter')}
              disabled={isAnyLoading}
              activeOpacity={0.8}
            >
              {socialLoading === 'twitter' ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="logo-twitter" size={24} color="#1da1f2" />
              )}
            </TouchableOpacity>

            {/* Facebook */}
            <TouchableOpacity
              style={[styles.socialButton, { backgroundColor: colors.card, borderColor: colors.border }, isAnyLoading && styles.buttonDisabled]}
              onPress={() => handleSocialLogin('facebook')}
              disabled={isAnyLoading}
              activeOpacity={0.8}
            >
              {socialLoading === 'facebook' ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="logo-facebook" size={24} color="#1877f2" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Sign Up Link */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>Don't have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('SignUp')}
            disabled={isAnyLoading}
          >
            <Text style={[styles.signUpText, { color: colors.primary }]}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      <Modal
        visible={showForgotPasswordModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeForgotPasswordModal}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={closeForgotPasswordModal} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Reset Password</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.modalContent}>
            {!resetEmailSent ? (
              <>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                  Enter your email address and we'll send you a link to reset your password.
                </Text>

                <View style={styles.inputContainer}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, resetError ? styles.inputError : null]}>
                    <Ionicons name="at-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: colors.inputText }]}
                      placeholder="Enter your email"
                      placeholderTextColor={colors.inputPlaceholder}
                      value={resetEmail}
                      onChangeText={(text) => {
                        setResetEmail(text);
                        setResetError('');
                      }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      editable={!resetLoading}
                    />
                  </View>
                  {resetError ? <Text style={[styles.errorText, { color: colors.error }]}>{resetError}</Text> : null}
                </View>

                <TouchableOpacity
                  style={[styles.loginButton, { backgroundColor: colors.primary }, resetLoading && styles.buttonDisabled]}
                  onPress={handleForgotPassword}
                  disabled={resetLoading}
                  activeOpacity={0.8}
                >
                  {resetLoading ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={[styles.loginButtonText, { color: colors.textInverse }]}>Send Reset Email</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.successContainer}>
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark-circle" size={60} color={colors.success} />
                </View>
                <Text style={[styles.successTitle, { color: colors.text }]}>Email Sent!</Text>
                <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
                  We've sent a password reset link to {resetEmail}. Check your inbox and follow the instructions.
                </Text>
                <TouchableOpacity
                  style={[styles.loginButton, { backgroundColor: colors.primary }]}
                  onPress={closeForgotPasswordModal}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.loginButtonText, { color: colors.textInverse }]}>Back to Sign In</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  form: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  inputIcon: {
    paddingLeft: 16,
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 16,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    paddingHorizontal: 16,
  },
  socialButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  socialButton: {
    width: 60,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
  },
  signUpText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
  },
  successIcon: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  successMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
});
