// ===========================================
// Lantern Study Mobile - Username Required Modal
// ===========================================
// Prompts existing users to set a username on login

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { checkUsername, updateUsername } from '../services/api';

interface User {
  id: string;
  name: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

interface UsernameRequiredModalProps {
  visible: boolean;
  onClose: () => void;
  currentUser: User;
  onSuccess: (username: string, firstName: string, lastName: string) => void;
}

export default function UsernameRequiredModal({
  visible,
  onClose,
  currentUser,
  onSuccess,
}: UsernameRequiredModalProps) {
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState(currentUser.firstName || '');
  const [lastName, setLastName] = useState(currentUser.lastName || '');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const validateUsernameFormat = (usernameStr: string) => /^[a-z0-9_]{3,20}$/.test(usernameStr.toLowerCase());

  // Parse name from currentUser if firstName/lastName not set
  useEffect(() => {
    if (!currentUser.firstName && !currentUser.lastName && currentUser.name) {
      const parts = currentUser.name.trim().split(' ');
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      } else if (parts.length === 1) {
        setFirstName(parts[0]);
      }
    }
  }, [currentUser]);

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

  const handleSubmit = async () => {
    setError('');
    
    const normalizedUsername = username.toLowerCase().trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    // Validate
    if (!normalizedUsername) {
      setError('Username is required');
      return;
    }
    
    if (normalizedUsername.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    
    if (!validateUsernameFormat(normalizedUsername)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }
    
    if (usernameAvailable === false) {
      setError('This username is already taken');
      return;
    }
    
    if (!trimmedFirstName) {
      setError('First name is required');
      return;
    }
    
    if (!trimmedLastName) {
      setError('Last name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateUsername(currentUser.id, normalizedUsername, {
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
      });

      Alert.alert(
        'Welcome!',
        `Your username @${normalizedUsername} has been set successfully.`,
        [{ text: 'Continue', onPress: () => onSuccess(normalizedUsername, trimmedFirstName, trimmedLastName) }]
      );
    } catch (err: any) {
      const message = err?.message || 'Failed to update profile';
      if (/taken|already/i.test(message)) {
        setError('This username is already taken');
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {}}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        // Android must stay undefined: the manifest sets adjustResize, so the
        // window already shrinks for the keyboard. 'height' subtracts it a
        // second time and the two corrections oscillate, which makes the footer
        // Continue button jump around the screen.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Complete Your Profile</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView 
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.infoBox, { backgroundColor: colors.primaryLight || '#EBF5FF' }]}>
            <Ionicons name="information-circle" size={24} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.text }]}>
              We've updated our system! Please set a username to continue. Your username will be used by other members to find and add you to groups.
            </Text>
          </View>

          {/* First Name */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>First Name</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <Ionicons name="person-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="First name"
                placeholderTextColor={colors.inputPlaceholder}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                editable={!isSubmitting}
              />
            </View>
          </View>

          {/* Last Name */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Last Name</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <Ionicons name="person-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Last name"
                placeholderTextColor={colors.inputPlaceholder}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                editable={!isSubmitting}
              />
            </View>
          </View>

          {/* Username */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Username</Text>
            <View style={[
              styles.inputWrapper, 
              { 
                backgroundColor: colors.inputBackground, 
                borderColor: usernameAvailable === true ? '#10B981' : 
                             usernameAvailable === false ? colors.error : 
                             colors.inputBorder 
              }
            ]}>
              <Text style={[styles.atSymbol, { color: colors.primary }]}>@</Text>
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="username"
                placeholderTextColor={colors.inputPlaceholder}
                value={username}
                onChangeText={(text) => {
                  const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  setUsername(sanitized);
                  setError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                editable={!isSubmitting}
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
            {usernameAvailable === true && username.length >= 3 && (
              <Text style={[styles.successText, { color: '#10B981' }]}>Username is available!</Text>
            )}
            {usernameAvailable === false && (
              <Text style={[styles.errorText, { color: colors.error }]}>Username is already taken</Text>
            )}
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              3-20 characters, letters, numbers, and underscores only
            </Text>
          </View>

          {error ? (
            <View style={[styles.errorContainer, { backgroundColor: '#FEF2F2' }]}>
              <Ionicons name="alert-circle" size={20} color="#DC2626" />
              <Text style={[styles.errorContainerText, { color: '#DC2626' }]}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton, 
              { backgroundColor: colors.primary },
              (isSubmitting || checkingUsername || usernameAvailable === false) && styles.buttonDisabled
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting || checkingUsername || usernameAvailable === false}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerSpacer: {
    width: 44,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
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
  inputIcon: {
    paddingLeft: 16,
  },
  inputIconRight: {
    paddingRight: 12,
  },
  atSymbol: {
    fontSize: 16,
    fontWeight: '600',
    paddingLeft: 16,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  successText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  },
  errorText: {
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
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  errorContainerText: {
    flex: 1,
    fontSize: 14,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  submitButton: {
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
