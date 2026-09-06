// ===========================================
// Lantern Study Mobile - Sign Up Screen
// ===========================================

import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useCallback, useEffect } from 'react';
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
  Linking,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { studyLevelLabel } from '@lantern/shared/academic';
import { useAuthStore } from '../../stores/authStore';
import { checkUsername } from '../../services/api';
import { supabase } from '../../services/supabase';
import { saveAcademicProfile } from '../../services/academic';
import { stashPendingAcademicProfile } from '../../services/pendingAcademicProfile';
import { useTheme } from '../../theme';
import { LanternLogo } from '../../components/LanternLogo';
import { SocialAuthButtons } from '../../components/auth/SocialAuthButtons';
import { useCookieNoticeBottomInset } from '../../components/CookieNoticeBanner';
import { StudyLevelPicker } from '../../components/academic/StudyLevelPicker';
import { CampusPicker } from '../marketplace/CampusPicker';
import { useInstitutions } from '../../hooks/useInstitutions';
import {
  PROGRAMME_MAX_LENGTH,
  areInstitutionsUnavailable,
  buildSignUpAcademicFields,
  isValidUsernameFormat,
  validateSignUpForm,
  type SignUpFormErrors,
} from '../../utils/signUpValidation';
import type { AuthStackParamList } from '../../navigation/types';
import { AppIcon } from '../../components/ui/AppIcon';

type SignUpScreenProps = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

type FormErrors = SignUpFormErrors;

export default function SignUpScreen({ navigation, route }: SignUpScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState('');
  // Academic identity (replaces the old phone block): institution + level are
  // required, programme optional — the same rule as the web onboarding step.
  // Written to profiles on insert AND via PUT /users/:id once a session exists
  // (the API is the source of truth, and that PUT triggers
  // refreshAutoMemberships). The one escape is an institution-list outage; see
  // institutionsUnavailable below.
  const [institutionId, setInstitutionId] = useState('');
  const [programme, setProgramme] = useState('');
  const [studyLevel, setStudyLevel] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const {
    institutions,
    loading: institutionsLoading,
    error: institutionsError,
    reload: reloadInstitutions,
  } = useInstitutions();

  const { signUp, isLoading: authLoading, error: authError } = useAuthStore();
  const cookieNoticeInset = useCookieNoticeBottomInset();

  // The institution list could not be loaded (failed fetch, or nothing came
  // back): the picker has nothing to offer, so requiring an institution would
  // lock this student out of creating an account at all. This is the ONE
  // deliberate escape — the requirement degrades to optional, level stays
  // required, and RootNavigator's academic profile-setup modal picks them up on
  // the next boot. Mirrors the web onboarding step.
  const institutionsUnavailable = areInstitutionsUnavailable({
    loading: institutionsLoading,
    error: institutionsError,
    count: institutions.length,
  });

  // Debounced username availability check
  useEffect(() => {
    const normalizedUsername = username.toLowerCase().trim();
    
    if (!normalizedUsername || normalizedUsername.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    if (!isValidUsernameFormat(normalizedUsername)) {
      setUsernameAvailable(null);
      return;
    }

    setCheckingUsername(true);
    const timeoutId = setTimeout(async () => {
      try {
        const result = await checkUsername(normalizedUsername);
        setUsernameAvailable(result.available === true);
      } catch (err) {
        console.error('Error checking username:', err);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username]);

  // Institution and study level are REQUIRED (programme stays optional) — the
  // same rule the web onboarding step applies. Both feed auto communities,
  // course rows, campus counts and Discover, so a blank one is a permanently
  // empty account. The only way past a missing institution is
  // `institutionsUnavailable` above. Rules live in utils/signUpValidation.ts.
  const validateForm = useCallback(() => {
    const newErrors = validateSignUpForm({
      firstName,
      lastName,
      username,
      usernameAvailable,
      email,
      institutionId,
      programme,
      studyLevel,
      institutionsUnavailable,
      password,
      confirmPassword,
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    firstName,
    lastName,
    username,
    usernameAvailable,
    email,
    institutionId,
    programme,
    studyLevel,
    institutionsUnavailable,
    password,
    confirmPassword,
  ]);

  const handleSignUp = useCallback(async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const normalizedUsername = username.toLowerCase().trim();
      const academicFields = buildSignUpAcademicFields({ institutionId, programme, studyLevel });

      void import('../../services/productAnalytics').then(({ trackSignupStarted }) => {
        trackSignupStarted();
      });

      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: fullName,
            username: normalizedUsername,
            institution_id: academicFields.institutionId,
            programme: academicFields.programme,
            study_level: academicFields.studyLevel,
            // Phase 4 Q: consumed SERVER-SIDE by handle_new_user(); the client
            // never grants anything. Signup is worth nothing on its own —
            // mobile has no Turnstile, so the reward is gated on activation.
            ...(referralCode ? { referral_code: referralCode, referral_source: 'link' } : {}),
          },
        },
      });

      if (error) {
        if (error.message.includes('already registered') || error.status === 422) {
          Alert.alert('Account Exists', 'This email is already registered. Please sign in instead.');
        } else {
          Alert.alert('Sign Up Failed', error.message);
        }
        return;
      }

      if (data.user) {
        // Create profile in database (best-effort; handle_new_user may already
        // have created the row). The academic columns ride along.
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id,
          name: fullName,
          username: normalizedUsername,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          institution_id: academicFields.institutionId,
          programme: academicFields.programme,
          study_level: academicFields.studyLevel,
          points: 0,
          stats: {},
          settings: {},
          badges: [],
        });

        if (profileError) {
          console.log('Profile insert error (may already exist):', profileError);
        }

        if (data.session?.user) {
          // Session exists: PUT /users/:id is the source of truth for the
          // academic profile. Best-effort — never block the welcome.
          try {
            await saveAcademicProfile(data.user.id, academicFields);
          } catch (academicError) {
            console.warn('[SignUp] academic profile PUT failed; stashing for next boot:', academicError);
            await stashPendingAcademicProfile(email, academicFields);
          }
          Alert.alert('Welcome to Lantern Study!', 'Your account has been created successfully.');
        } else {
          // Email confirmation pending: no token yet, so replay the academic
          // fields on the first authenticated boot.
          await stashPendingAcademicProfile(email, academicFields);
          navigation.replace('VerifyEmail', { email });
        }
      }
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }, [
    firstName,
    lastName,
    username,
    email,
    institutionId,
    programme,
    studyLevel,
    password,
    validateForm,
    navigation,
  ]);

  /**
   * Referral code for this signup (Phase 4 · Q).
   *
   * Sourced from the invite deep link (`lanternstudy://signup?ref=CODE` or the
   * https equivalent). Read once on mount so it survives re-renders, and
   * validated to a conservative charset so nothing odd reaches signup metadata.
   */
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const normalize = (raw?: string | null): string | null => {
      const candidate = (raw || '').trim().toUpperCase();
      return /^[A-Z0-9]{4,16}$/.test(candidate) ? candidate : null;
    };
    const fromParams = normalize((route?.params as { ref?: string } | undefined)?.ref);
    if (fromParams) {
      setReferralCode(fromParams);
      return;
    }
    void Linking.getInitialURL()
      .then((url) => {
        if (cancelled || !url) return;
        const match = /[?&]ref=([^&#]+)/.exec(url);
        const code = normalize(match ? decodeURIComponent(match[1]) : null);
        if (code) setReferralCode(code);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [route?.params]);

  const clearError = (field: keyof FormErrors) => {
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      // See UsernameRequiredModal: 'height' fights the manifest's adjustResize
      // on Android and makes the layout oscillate.
      behavior={COMPOSER_KEYBOARD_BEHAVIOR}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + cookieNoticeInset }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        {/* 40 is less than the 59pt inset on a Dynamic Island iPhone, so the
            title and back button drew under the clock. Read the inset. */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={[styles.backButton, { top: insets.top + 12 }]}
            hitSlop={10}
            onPress={() => navigation.goBack()}
            disabled={isLoading}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.logoContainer}>
            <LanternLogo size={72} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Join us to illuminate your mind.</Text>
        </View>

        {/* Sign Up Form */}
        <View style={styles.form}>
          {/* First Name and Last Name Row */}
          <View style={styles.nameRow}>
            {/* First Name Input */}
            <View style={[styles.inputContainer, styles.nameInput]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>First Name</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.firstName && styles.inputError]}>
                <AppIcon name="person" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.inputText }]}
                  placeholder="First"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={firstName}
                  onChangeText={(text) => {
                    setFirstName(text);
                    clearError('firstName');
                  }}
                  autoCapitalize="words"
                  autoComplete="given-name"
                  editable={!isLoading}
                />
              </View>
              {errors.firstName && <Text style={[styles.errorText, { color: colors.error }]}>{errors.firstName}</Text>}
            </View>

            {/* Last Name Input */}
            <View style={[styles.inputContainer, styles.nameInput]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Last Name</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.lastName && styles.inputError]}>
                <AppIcon name="person" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.inputText }]}
                  placeholder="Last"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={lastName}
                  onChangeText={(text) => {
                    setLastName(text);
                    clearError('lastName');
                  }}
                  autoCapitalize="words"
                  autoComplete="family-name"
                  editable={!isLoading}
                />
              </View>
              {errors.lastName && <Text style={[styles.errorText, { color: colors.error }]}>{errors.lastName}</Text>}
            </View>
          </View>

          {/* Username Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Username</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: errors.username ? colors.error : (usernameAvailable === true ? '#10B981' : colors.inputBorder) }]}>
              <Text style={[styles.atSymbol, { color: colors.primaryText }]}>@</Text>
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="username"
                placeholderTextColor={colors.inputPlaceholder}
                value={username}
                onChangeText={(text) => {
                  // Only allow valid characters and lowercase
                  const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  setUsername(sanitized);
                  clearError('username');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                editable={!isLoading}
              />
              {checkingUsername && (
                <ActivityIndicator size="small" color={colors.primaryText} style={styles.inputIconRight} />
              )}
              {!checkingUsername && usernameAvailable === true && username.length >= 3 && (
                <AppIcon name="checkmark-circle" size={20} color="#10B981" style={styles.inputIconRight} />
              )}
              {!checkingUsername && usernameAvailable === false && (
                <AppIcon name="close-circle" size={20} color={colors.error} style={styles.inputIconRight} />
              )}
            </View>
            {errors.username && <Text style={[styles.errorText, { color: colors.error }]}>{errors.username}</Text>}
            {!errors.username && usernameAvailable === true && username.length >= 3 && (
              <Text style={[styles.successText, { color: '#10B981' }]}>Username is available!</Text>
            )}
            {!errors.username && usernameAvailable === false && (
              <Text style={[styles.errorText, { color: colors.error }]}>Username is already taken</Text>
            )}
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              3-20 characters, letters, numbers, and underscores only
            </Text>
          </View>

          {/* Institution (required; "Other" sentinels are never offered) */}
          <View style={styles.inputContainer}>
            {/* The asterisk is decorative — the label spells "required" out for
                screen readers, so the requirement is never colour/glyph only. */}
            <Text
              style={[styles.label, { color: colors.textSecondary }]}
              accessibilityLabel="University or Polytechnic, required"
            >
              University / Polytechnic <Text style={{ color: colors.error }}>*</Text>
            </Text>
            <CampusPicker
              campuses={institutions}
              value={institutionId}
              onChange={(campusId) => {
                setInstitutionId(campusId);
                clearError('institution');
              }}
              emptyLabel={institutionsLoading ? 'Loading institutions…' : 'Choose your institution'}
              searchPlaceholder="Search universities and polytechnics…"
            />
            {institutionsUnavailable ? (
              // The list is genuinely unavailable, so this student is allowed
              // through without one — say so honestly and offer the retry.
              <View style={styles.retryRow}>
                <Text style={[styles.errorText, { color: colors.error }]}>
                  We couldn’t load the list of institutions.
                </Text>
                <TouchableOpacity
                  onPress={reloadInstitutions}
                  accessibilityRole="button"
                  accessibilityLabel="Try loading institutions again"
                  hitSlop={10}
                  style={styles.retryButton}
                >
                  <Text style={[styles.retryText, { color: colors.primaryText }]}>Try again</Text>
                </TouchableOpacity>
                <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                  You can continue and add your school later.
                </Text>
              </View>
            ) : errors.institution ? (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.institution}</Text>
            ) : (
              <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                This files your notes, decks and tests by course, and puts you in your campus groups.
              </Text>
            )}
          </View>

          {/* Programme (optional) */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Programme (Optional)</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <AppIcon name="book" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="e.g. Medicine and Surgery"
                placeholderTextColor={colors.inputPlaceholder}
                value={programme}
                onChangeText={setProgramme}
                autoCapitalize="words"
                maxLength={PROGRAMME_MAX_LENGTH}
                editable={!isLoading}
                accessibilityLabel="Programme, optional"
              />
            </View>
          </View>

          {/* Level (required — needs no network, so no outage escape) */}
          <View style={styles.inputContainer}>
            <Text
              style={[styles.label, { color: colors.textSecondary }]}
              accessibilityLabel={`Level, required${studyLevel ? `, ${studyLevelLabel(studyLevel)} selected` : ''}`}
            >
              Level <Text style={{ color: colors.error }}>*</Text>
              {studyLevel ? ` — ${studyLevelLabel(studyLevel)}` : ''}
            </Text>
            <StudyLevelPicker
              value={studyLevel}
              onChange={(level) => {
                setStudyLevel(level);
                clearError('studyLevel');
              }}
              disabled={isLoading}
              accessibilityLabel="Study level, required"
            />
            {errors.studyLevel && <Text style={[styles.errorText, { color: colors.error }]}>{errors.studyLevel}</Text>}
          </View>

          {/* Email Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.email && styles.inputError]}>
              <AppIcon name="at" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Enter your email"
                placeholderTextColor={colors.inputPlaceholder}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  clearError('email');
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
              />
            </View>
            {errors.email && <Text style={[styles.errorText, { color: colors.error }]}>{errors.email}</Text>}
          </View>

          {/* Password Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.password && styles.inputError]}>
              <AppIcon name="lock-closed" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Create a password"
                placeholderTextColor={colors.inputPlaceholder}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  clearError('password');
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isLoading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
<AppIcon
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={colors.inputPlaceholder}
                />
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={[styles.errorText, { color: colors.error }]}>{errors.password}</Text>}
            <Text style={[styles.passwordHint, { color: colors.textTertiary }]}>
              Must be at least 6 characters
            </Text>
          </View>

          {/* Confirm Password Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm Password</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.confirmPassword && styles.inputError]}>
              <AppIcon name="lock-closed" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Confirm your password"
                placeholderTextColor={colors.inputPlaceholder}
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  clearError('confirmPassword');
                }}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isLoading}
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                <AppIcon
                  name={showConfirmPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={colors.inputPlaceholder}
                />
              </TouchableOpacity>
            </View>
            {errors.confirmPassword && <Text style={[styles.errorText, { color: colors.error }]}>{errors.confirmPassword}</Text>}
          </View>

          {/* Sign Up Button */}
          <TouchableOpacity
            style={[styles.signUpButton, { backgroundColor: colors.primaryFill }, isLoading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={[styles.signUpButtonText, { color: colors.textInverse }]}>Create Account</Text>
            )}
          </TouchableOpacity>

          {/* Terms */}
          <Text style={[styles.termsText, { color: colors.textSecondary }]}>
            By signing up, you agree to our{' '}
            <Text
              style={[styles.termsLink, { color: colors.primaryText }]}
              onPress={() => navigation.navigate('LegalDocument', { document: 'terms' })}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              style={[styles.termsLink, { color: colors.primaryText }]}
              onPress={() => navigation.navigate('LegalDocument', { document: 'privacy' })}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>

        <SocialAuthButtons disabled={isLoading} />

        {/* Sign In Link */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} disabled={isLoading}>
            <Text style={[styles.signInText, { color: colors.primaryText }]}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    // paddingTop is applied inline with the real status-bar inset —
    // Android 15+ edge-to-edge put the back button under the clock at 20dp.
  },
  backButton: {
    position: 'absolute',
    left: 0,
    padding: 10,
    zIndex: 1,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameInput: {
    flex: 1,
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
  successText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  retryRow: {
    marginTop: 2,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  hintText: {
    fontSize: 11,
    marginTop: 4,
    marginLeft: 4,
    fontStyle: 'italic',
  },
  atSymbol: {
    fontSize: 16,
    fontWeight: '600',
    paddingLeft: 16,
    paddingRight: 4,
  },
  inputIconRight: {
    paddingRight: 12,
  },
  passwordHint: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  signUpButton: {
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  signUpButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  termsText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 14,
  },
  signInText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
