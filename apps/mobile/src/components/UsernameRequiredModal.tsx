// ===========================================
// Lantern Study Mobile - Profile Setup Modal
// ===========================================
// Mobile counterpart of the web "Set up your profile" step
// (docs/phase1-academic-identity-contract.md §4/§5): username (OAuth path)
// + institution + programme + level + optional courses. Also offered once,
// skippable, to students who already have a username but no institution.

import React, { useState, useEffect, useMemo } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Course } from '@lantern/shared/types';
import { currentAcademicYear, studyLevelLabel } from '@lantern/shared/academic';
import { useTheme } from '../theme';
import { checkUsername, updateUsername } from '../services/api';
import { getMyActiveCourses, saveAcademicProfile, saveMyCourseSet } from '../services/academic';
import { useAuthStore } from '../stores/authStore';
import { useInstitutions } from '../hooks/useInstitutions';
import { COMPOSER_KEYBOARD_BEHAVIOR } from './chat/composerKeyboardBehavior';
import { CampusPicker } from '../screens/marketplace/CampusPicker';
import { StudyLevelPicker } from './academic/StudyLevelPicker';
import { CourseMultiSelect } from './academic/CourseMultiSelect';

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
  /**
   * 'username' (default): no username yet — username/name required, no skip.
   * 'academic': username exists — academic fields only, "Skip for now" shown.
   */
  mode?: 'username' | 'academic';
  onSkip?: () => void;
}

export default function UsernameRequiredModal({
  visible,
  onClose,
  currentUser,
  onSuccess,
  mode = 'username',
  onSkip,
}: UsernameRequiredModalProps) {
  const { colors } = useTheme();
  // Edge-to-edge (forced at targetSdk 35+): RN Modals draw under the status
  // and navigation bars, so the header and the footer buttons need the real
  // insets or they land beneath system chrome — the footer "Skip for now"
  // was untappable behind the nav bar (same class as the ConfirmSheet fix).
  const insets = useSafeAreaInsets();
  const academicProfile = useAuthStore(s => s.academicProfile);
  const {
    institutions,
    loading: institutionsLoading,
    error: institutionsError,
    reload: reloadInstitutions,
  } = useInstitutions();
  const needsUsername = mode === 'username';

  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState(currentUser.firstName || '');
  const [lastName, setLastName] = useState(currentUser.lastName || '');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [institutionId, setInstitutionId] = useState(academicProfile?.institutionId ?? '');
  const [programme, setProgramme] = useState(academicProfile?.programme ?? '');
  const [studyLevel, setStudyLevel] = useState<number | null>(academicProfile?.studyLevel ?? null);
  const [courses, setCourses] = useState<Course[]>([]);
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

  // Hydrate academic fields if the profile arrives after first render.
  useEffect(() => {
    if (!academicProfile) return;
    setInstitutionId(prev => prev || academicProfile.institutionId || '');
    setProgramme(prev => prev || academicProfile.programme || '');
    setStudyLevel(prev => prev ?? academicProfile.studyLevel ?? null);
  }, [academicProfile]);

  // Debounced username availability check
  useEffect(() => {
    if (!needsUsername) return;
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
  }, [username, needsUsername]);

  const title = needsUsername ? 'Complete Your Profile' : 'Set up your academic profile';
  const intro = useMemo(
    () =>
      needsUsername
        ? 'Pick a username so classmates can find you, then tell us where you study — your notes, decks and tests get filed under your courses.'
        : 'Tell us where you study. Your notes, decks and tests get filed under your courses, and the marketplace shows what fits your level.',
    [needsUsername]
  );

  const handleSubmit = async () => {
    setError('');

    const normalizedUsername = username.toLowerCase().trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (needsUsername) {
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
    }

    // Institution + level are OPTIONAL — activation must never dead-end a
    // student at an unlisted school or one hitting a failed campuses fetch. The
    // username (username mode) is the only hard requirement; whatever academic
    // fields are provided are saved best-effort below.

    setIsSubmitting(true);
    try {
      if (needsUsername) {
        await updateUsername(currentUser.id, normalizedUsername, {
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
        });
      }

      const hasAcademicInput = !!institutionId || studyLevel != null || !!programme.trim();
      if (hasAcademicInput) {
        // Best-effort — a failed academic PUT must not trap the user behind the
        // gate once the username is set.
        try {
          await saveAcademicProfile(currentUser.id, {
            institutionId: institutionId || null,
            programme: programme.trim() || null,
            studyLevel: studyLevel ?? null,
          });

          if (courses.length > 0) {
            // Union with anything already enrolled this year (PUT replaces the set).
            const academicYear = currentAcademicYear();
            let existingIds: string[] = [];
            try {
              existingIds = (await getMyActiveCourses({ force: true }))
                .filter(row => row.academicYear === academicYear)
                .map(row => row.course.id);
            } catch {
              existingIds = [];
            }
            const ids = Array.from(new Set([...existingIds, ...courses.map(c => c.id)]));
            await saveMyCourseSet(ids, academicYear);
          }
        } catch (academicErr) {
          console.warn('[ProfileSetup] academic profile save failed (non-blocking):', academicErr);
        }
      }

      const finalUsername = needsUsername ? normalizedUsername : currentUser.username || '';
      const finalFirst = needsUsername ? trimmedFirstName : currentUser.firstName || firstName.trim();
      const finalLast = needsUsername ? trimmedLastName : currentUser.lastName || lastName.trim();

      Alert.alert(
        needsUsername ? 'Welcome!' : 'All set',
        needsUsername
          ? `Your username @${finalUsername} has been set successfully.`
          : 'Your academic profile is saved.',
        [{ text: 'Continue', onPress: () => onSuccess(finalUsername, finalFirst, finalLast) }]
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

  const submitDisabled =
    isSubmitting || (needsUsername && (checkingUsername || usernameAvailable === false));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (onSkip) onSkip();
      }}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        // iOS and Android 15+ (API 35, where adjustResize is ignored) need
        // 'padding'; older Android still resizes the window itself, and
        // padding on top of that would lift the footer twice.
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === 'ios' ? 60 : insets.top + 16,
            },
          ]}
        >
          <View style={styles.headerSpacer} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
          {onSkip ? (
            <TouchableOpacity onPress={onSkip} style={styles.headerSpacer} accessibilityRole="button" accessibilityLabel="Skip for now">
              <Text style={[styles.skipText, { color: colors.textSecondary }]}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.infoBox, { backgroundColor: colors.primaryLight || '#EBF5FF' }]}>
            <Ionicons name="school" size={24} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.text }]}>{intro}</Text>
          </View>

          {needsUsername ? (
            <>
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
                                 colors.inputBorder,
                  },
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
            </>
          ) : null}

          {/* Institution (optional) */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>University / Polytechnic (Optional)</Text>
            <CampusPicker
              campuses={institutions}
              value={institutionId}
              onChange={(campusId) => {
                setInstitutionId(campusId);
                setError('');
              }}
              emptyLabel={institutionsLoading ? 'Loading institutions…' : 'Choose your institution'}
              searchPlaceholder="Search universities and polytechnics…"
            />
            {institutionsError ? (
              <TouchableOpacity onPress={reloadInstitutions} accessibilityRole="button">
                <Text style={[styles.errorText, { color: colors.error }]}>
                  Couldn’t load institutions. Tap to retry.
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                Not listed, or not in Nigeria? Leave this blank — you can add it later.
              </Text>
            )}
          </View>

          {/* Programme */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Programme (Optional)</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <Ionicons name="book-outline" size={20} color={colors.inputPlaceholder} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="e.g. Medicine and Surgery"
                placeholderTextColor={colors.inputPlaceholder}
                value={programme}
                onChangeText={setProgramme}
                autoCapitalize="words"
                editable={!isSubmitting}
              />
            </View>
          </View>

          {/* Level */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Level (Optional){studyLevel ? ` — ${studyLevelLabel(studyLevel)}` : ''}
            </Text>
            <StudyLevelPicker
              value={studyLevel}
              onChange={(level) => {
                setStudyLevel(level);
                setError('');
              }}
              disabled={isSubmitting}
            />
          </View>

          {/* Courses (optional) */}
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Courses this semester (Optional)</Text>
            <CourseMultiSelect
              selected={courses}
              onChange={setCourses}
              institutionId={institutionId || null}
              includeMyCourses={false}
              disabled={isSubmitting}
              placeholder="Search or add, e.g. BIO 201"
            />
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              Can’t find a course? Type its code (e.g. GST 101) and tap “Add”.
            </Text>
          </View>

          {error ? (
            <View style={[styles.errorContainer, { backgroundColor: '#FEF2F2' }]}>
              <Ionicons name="alert-circle" size={20} color="#DC2626" />
              <Text style={[styles.errorContainerText, { color: '#DC2626' }]}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { borderTopColor: colors.border, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              submitDisabled && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitDisabled}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Continue</Text>
            )}
          </TouchableOpacity>
          {onSkip ? (
            <TouchableOpacity onPress={onSkip} style={styles.skipButton} accessibilityRole="button">
              <Text style={[styles.skipButtonText, { color: colors.textSecondary }]}>Skip for now</Text>
            </TouchableOpacity>
          ) : null}
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
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  skipText: {
    fontSize: 14,
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
  skipButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 6,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
