// ===========================================
// Lantern Study Mobile - Sign Up Screen
// ===========================================

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
  Modal,
  FlatList,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { useTheme } from '../../theme';
import { LanternLogo } from '../../components/LanternLogo';
import { SocialAuthButtons } from '../../components/auth/SocialAuthButtons';
import type { AuthStackParamList } from '../../navigation/types';

type SignUpScreenProps = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

interface FormErrors {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  phoneNumber?: string;
  password?: string;
  confirmPassword?: string;
}

interface CountryCode {
  code: string;
  name: string;
}

// Country codes list (matching web app)
const COUNTRY_CODES: CountryCode[] = [
  { code: '+1', name: 'United States/Canada' },
  { code: '+7', name: 'Russia/Kazakhstan' },
  { code: '+20', name: 'Egypt' },
  { code: '+27', name: 'South Africa' },
  { code: '+30', name: 'Greece' },
  { code: '+31', name: 'Netherlands' },
  { code: '+32', name: 'Belgium' },
  { code: '+33', name: 'France' },
  { code: '+34', name: 'Spain' },
  { code: '+36', name: 'Hungary' },
  { code: '+39', name: 'Italy' },
  { code: '+40', name: 'Romania' },
  { code: '+41', name: 'Switzerland' },
  { code: '+43', name: 'Austria' },
  { code: '+44', name: 'United Kingdom' },
  { code: '+45', name: 'Denmark' },
  { code: '+46', name: 'Sweden' },
  { code: '+47', name: 'Norway' },
  { code: '+48', name: 'Poland' },
  { code: '+49', name: 'Germany' },
  { code: '+51', name: 'Peru' },
  { code: '+52', name: 'Mexico' },
  { code: '+53', name: 'Cuba' },
  { code: '+54', name: 'Argentina' },
  { code: '+55', name: 'Brazil' },
  { code: '+56', name: 'Chile' },
  { code: '+57', name: 'Colombia' },
  { code: '+58', name: 'Venezuela' },
  { code: '+60', name: 'Malaysia' },
  { code: '+61', name: 'Australia' },
  { code: '+62', name: 'Indonesia' },
  { code: '+63', name: 'Philippines' },
  { code: '+64', name: 'New Zealand' },
  { code: '+65', name: 'Singapore' },
  { code: '+66', name: 'Thailand' },
  { code: '+81', name: 'Japan' },
  { code: '+82', name: 'South Korea' },
  { code: '+84', name: 'Vietnam' },
  { code: '+86', name: 'China' },
  { code: '+90', name: 'Turkey' },
  { code: '+91', name: 'India' },
  { code: '+92', name: 'Pakistan' },
  { code: '+93', name: 'Afghanistan' },
  { code: '+94', name: 'Sri Lanka' },
  { code: '+95', name: 'Myanmar' },
  { code: '+98', name: 'Iran' },
  { code: '+212', name: 'Morocco' },
  { code: '+213', name: 'Algeria' },
  { code: '+216', name: 'Tunisia' },
  { code: '+218', name: 'Libya' },
  { code: '+220', name: 'Gambia' },
  { code: '+221', name: 'Senegal' },
  { code: '+233', name: 'Ghana' },
  { code: '+234', name: 'Nigeria' },
  { code: '+254', name: 'Kenya' },
  { code: '+255', name: 'Tanzania' },
  { code: '+256', name: 'Uganda' },
  { code: '+260', name: 'Zambia' },
  { code: '+263', name: 'Zimbabwe' },
  { code: '+351', name: 'Portugal' },
  { code: '+352', name: 'Luxembourg' },
  { code: '+353', name: 'Ireland' },
  { code: '+354', name: 'Iceland' },
  { code: '+358', name: 'Finland' },
  { code: '+370', name: 'Lithuania' },
  { code: '+371', name: 'Latvia' },
  { code: '+372', name: 'Estonia' },
  { code: '+380', name: 'Ukraine' },
  { code: '+420', name: 'Czech Republic' },
  { code: '+421', name: 'Slovakia' },
  { code: '+852', name: 'Hong Kong' },
  { code: '+853', name: 'Macau' },
  { code: '+886', name: 'Taiwan' },
  { code: '+966', name: 'Saudi Arabia' },
  { code: '+971', name: 'United Arab Emirates' },
  { code: '+972', name: 'Israel' },
  { code: '+974', name: 'Qatar' },
];

export default function SignUpScreen({ navigation }: SignUpScreenProps) {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const { signUp, isLoading: authLoading, error: authError } = useAuthStore();

  const validateEmail = (emailStr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
  const validateUsernameFormat = (usernameStr: string) => /^[a-z0-9_]{3,20}$/.test(usernameStr.toLowerCase());

  // Debounced username availability check
  useEffect(() => {
    const normalizedUsername = username.toLowerCase().trim();
    
    if (!normalizedUsername || normalizedUsername.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    if (!validateUsernameFormat(normalizedUsername)) {
      setUsernameAvailable(null);
      return;
    }

    setCheckingUsername(true);
    const timeoutId = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('is_username_available', { 
          username_to_check: normalizedUsername 
        });
        
        if (!error) {
          setUsernameAvailable(data === true);
        }
      } catch (err) {
        console.error('Error checking username:', err);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username]);

  const validateForm = useCallback(() => {
    const newErrors: FormErrors = {};

    if (!firstName.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (firstName.trim().length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    }

    if (!lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (lastName.trim().length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    }

    // Username validation
    const normalizedUsername = username.toLowerCase().trim();
    if (!normalizedUsername) {
      newErrors.username = 'Username is required';
    } else if (normalizedUsername.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    } else if (normalizedUsername.length > 20) {
      newErrors.username = 'Username must be at most 20 characters';
    } else if (!validateUsernameFormat(normalizedUsername)) {
      newErrors.username = 'Username can only contain letters, numbers, and underscores';
    } else if (usernameAvailable === false) {
      newErrors.username = 'This username is already taken';
    }

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email';
    }

    // Phone is optional but validate format if provided
    if (phoneNumber.trim() && !/^\d{7,15}$/.test(phoneNumber.replace(/\D/g, ''))) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [firstName, lastName, username, usernameAvailable, email, phoneNumber, password, confirmPassword]);

  const handleSignUp = useCallback(async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const fullPhoneNumber = phoneNumber.trim() ? `${countryCode}${phoneNumber.trim()}` : '';
      const normalizedUsername = username.toLowerCase().trim();
      
      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: fullName,
            phone: fullPhoneNumber,
            username: normalizedUsername,
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
        // Create profile in database
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id,
          name: fullName,
          username: normalizedUsername,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: fullPhoneNumber || null,
          points: 0,
          stats: {},
          settings: {},
          badges: [],
        });

        if (profileError) {
          console.log('Profile insert error (may already exist):', profileError);
        }

        if (data.session?.user) {
          Alert.alert('Welcome to Lantern Study!', 'Your account has been created successfully.');
        } else {
          navigation.replace('VerifyEmail', { email });
        }
      }
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }, [firstName, lastName, username, email, countryCode, phoneNumber, password, validateForm, navigation]);

  const clearError = (field: keyof FormErrors) => {
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const renderCountryItem = ({ item }: { item: CountryCode }) => (
    <TouchableOpacity
      style={styles.countryItem}
      onPress={() => {
        setCountryCode(item.code);
        setShowCountryPicker(false);
      }}
    >
      <Text style={[styles.countryCode, { color: colors.primary }]}>{item.code}</Text>
      <Text style={[styles.countryName, { color: colors.text }]}>{item.name}</Text>
    </TouchableOpacity>
  );

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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            disabled={isLoading}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
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
                <Ionicons name="person-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
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
                <Ionicons name="person-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
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
              <Text style={[styles.atSymbol, { color: colors.primary }]}>@</Text>
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
                <ActivityIndicator size="small" color={colors.primary} style={styles.inputIconRight} />
              )}
              {!checkingUsername && usernameAvailable === true && username.length >= 3 && (
                <Ionicons name="checkmark-circle" size={20} color="#10B981" style={styles.inputIconRight} />
              )}
              {!checkingUsername && usernameAvailable === false && (
                <Ionicons name="close-circle" size={20} color={colors.error} style={styles.inputIconRight} />
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

          {/* Phone Number Input */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Phone Number (Optional)</Text>
            <View style={styles.phoneRow}>
              <TouchableOpacity
                style={[styles.countryCodeButton, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
                onPress={() => setShowCountryPicker(true)}
                disabled={isLoading}
              >
                <Text style={[styles.countryCodeText, { color: colors.inputText }]}>{countryCode}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.inputPlaceholder} />
              </TouchableOpacity>
              <View style={[styles.inputWrapper, styles.phoneInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }, errors.phoneNumber && styles.inputError]}>
                <Ionicons name="call-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.inputText }]}
                  placeholder="Phone number"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={phoneNumber}
                  onChangeText={(text) => {
                    setPhoneNumber(text.replace(/\D/g, ''));
                    clearError('phoneNumber');
                  }}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!isLoading}
                />
              </View>
            </View>
            {errors.phoneNumber && <Text style={[styles.errorText, { color: colors.error }]}>{errors.phoneNumber}</Text>}
          </View>

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
              <Ionicons name="lock-closed-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
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
              >
<Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
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
              <Ionicons name="lock-closed-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
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
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.inputPlaceholder}
                />
              </TouchableOpacity>
            </View>
            {errors.confirmPassword && <Text style={[styles.errorText, { color: colors.error }]}>{errors.confirmPassword}</Text>}
          </View>

          {/* Sign Up Button */}
          <TouchableOpacity
            style={[styles.signUpButton, { backgroundColor: colors.primary }, isLoading && styles.buttonDisabled]}
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
              style={[styles.termsLink, { color: colors.primary }]}
              onPress={() => navigation.navigate('LegalDocument', { document: 'terms' })}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              style={[styles.termsLink, { color: colors.primary }]}
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
            <Text style={[styles.signInText, { color: colors.primary }]}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Country Code Picker Modal */}
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowCountryPicker(false)} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Country Code</Text>
            <View style={{ width: 24 }} />
          </View>
          <FlatList
            data={COUNTRY_CODES}
            renderItem={renderCountryItem}
            keyExtractor={(item) => item.code}
            style={styles.countryList}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
          />
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
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: Platform.OS === 'ios' ? 40 : 20,
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 40 : 20,
    left: 0,
    padding: 8,
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
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countryCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 52,
    gap: 4,
  },
  countryCodeText: {
    fontSize: 16,
    fontWeight: '500',
  },
  phoneInput: {
    flex: 1,
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
  countryList: {
    flex: 1,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    width: 60,
  },
  countryName: {
    fontSize: 16,
    flex: 1,
  },
  separator: {
    height: 1,
    marginHorizontal: 24,
  },
});
