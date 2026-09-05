/**
 * Settings → Academic: institution, programme, level, entry / graduation
 * years, and "My courses" (add via typeahead, remove, exam date, archive the
 * semester). Mirrors the web Settings → Academic section
 * (docs/phase1-academic-identity-contract.md §4/§5).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Course, UserCourse } from '@lantern/shared/types';
import { currentAcademicYear, semesterLabel, studyLevelLabel } from '@lantern/shared/academic';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../theme';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { CampusPicker } from '../marketplace/CampusPicker';
import { StudyLevelPicker } from '../../components/academic/StudyLevelPicker';
import { SemesterPicker } from '../../components/academic/SemesterPicker';
import { CourseMultiSelect } from '../../components/academic/CourseMultiSelect';
import { useInstitutions } from '../../hooks/useInstitutions';
import {
  addMyCourse,
  archiveAcademicYear,
  getMyActiveCourses,
  loadAcademicProfile,
  removeMyCourseEnrolment,
  saveAcademicProfile,
  setMyCourseExamDate,
} from '../../services/academic';
import { formatCourseLabel, isValidExamDateInput, validateAcademicYears } from '../../utils/courseSelection';
import type { AcademicProfile } from '../../utils/academicProfile';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = { goBack: () => void };

function parseYear(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : Number.NaN;
}

export default function AcademicSettingsScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  // `paddingBottom: 48` was a literal; this tracks the device's own inset so
  // the archive action clears the system navigation bar.
  const bottomPadding = useScreenBottomPadding();
  const user = useAuthStore(s => s.user);
  const storedProfile = useAuthStore(s => s.academicProfile);
  const { institutions, loading: institutionsLoading } = useInstitutions();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [institutionId, setInstitutionId] = useState('');
  const [programme, setProgramme] = useState('');
  const [faculty, setFaculty] = useState('');
  const [studyLevel, setStudyLevel] = useState<number | null>(null);
  const [currentSemester, setCurrentSemester] = useState<1 | 2 | null>(null);
  const [entryYear, setEntryYear] = useState('');
  const [graduationYear, setGraduationYear] = useState('');

  const [courses, setCourses] = useState<UserCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [examDrafts, setExamDrafts] = useState<Record<string, string>>({});
  const [savingExamFor, setSavingExamFor] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const academicYear = useMemo(() => currentAcademicYear(), []);

  const hydrate = useCallback((profile: AcademicProfile) => {
    setInstitutionId(profile.institutionId ?? '');
    setProgramme(profile.programme ?? '');
    setFaculty(profile.faculty ?? '');
    setStudyLevel(profile.studyLevel ?? null);
    setCurrentSemester(profile.currentSemester ?? null);
    setEntryYear(profile.entryYear != null ? String(profile.entryYear) : '');
    setGraduationYear(profile.expectedGraduationYear != null ? String(profile.expectedGraduationYear) : '');
  }, []);

  const reloadCourses = useCallback(async () => {
    setCoursesLoading(true);
    try {
      const rows = await getMyActiveCourses({ force: true });
      setCourses(rows);
      setExamDrafts(
        rows.reduce<Record<string, string>>((acc, row) => {
          acc[row.course.id] = row.examDate ?? '';
          return acc;
        }, {})
      );
      setCoursesError(null);
    } catch (e: unknown) {
      setCoursesError(e instanceof Error ? e.message : 'Could not load your courses');
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    if (storedProfile) hydrate(storedProfile);
    loadAcademicProfile(user.id)
      .then(profile => {
        if (!cancelled) hydrate(profile);
      })
      .catch(() => {
        /* keep whatever the store had */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void reloadCourses();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSaveProfile = useCallback(async () => {
    if (!user?.id) return;
    const entry = parseYear(entryYear);
    const grad = parseYear(graduationYear);
    if (Number.isNaN(entry) || Number.isNaN(grad)) {
      Alert.alert('Check the years', 'Entry and graduation years must be whole numbers, e.g. 2024.');
      return;
    }
    const yearError = validateAcademicYears(entry, grad);
    if (yearError) {
      Alert.alert('Check the years', yearError);
      return;
    }
    setSaving(true);
    try {
      await saveAcademicProfile(user.id, {
        institutionId: institutionId || null,
        programme: programme.trim() || null,
        faculty: faculty.trim() || null,
        studyLevel: studyLevel ?? null,
        currentSemester: currentSemester ?? null,
        entryYear: entry,
        expectedGraduationYear: grad,
      });
      Alert.alert('Saved', 'Your academic profile is up to date.');
    } catch (e: unknown) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    user?.id,
    institutionId,
    programme,
    faculty,
    studyLevel,
    currentSemester,
    entryYear,
    graduationYear,
  ]);

  const handleAddCourse = useCallback(
    async (course: Course) => {
      try {
        await addMyCourse(course, academicYear);
        await reloadCourses();
      } catch (e: unknown) {
        Alert.alert('Could not add course', e instanceof Error ? e.message : 'Please try again.');
      }
    },
    [academicYear, reloadCourses]
  );

  const handleRemoveCourse = useCallback(
    (row: UserCourse) => {
      Alert.alert('Remove course?', `${row.course.code} will be removed from ${row.academicYear}. Your notes and decks stay where they are.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeMyCourseEnrolment(row.course.id, row.academicYear)
              .then(reloadCourses)
              .catch((e: unknown) =>
                Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.')
              );
          },
        },
      ]);
    },
    [reloadCourses]
  );

  const handleSaveExamDate = useCallback(
    async (row: UserCourse) => {
      const draft = (examDrafts[row.course.id] ?? '').trim();
      if (!isValidExamDateInput(draft)) {
        Alert.alert('Check the date', 'Use YYYY-MM-DD, e.g. 2026-11-30.');
        return;
      }
      setSavingExamFor(row.course.id);
      try {
        await setMyCourseExamDate(row.course.id, draft || null, row.academicYear);
        await reloadCourses();
      } catch (e: unknown) {
        Alert.alert('Could not save exam date', e instanceof Error ? e.message : 'Please try again.');
      } finally {
        setSavingExamFor(null);
      }
    },
    [examDrafts, reloadCourses]
  );

  const handleArchiveSemester = useCallback(() => {
    const active = courses.filter(row => row.academicYear === academicYear);
    if (active.length === 0) {
      Alert.alert('Nothing to archive', `You have no active courses for ${academicYear}.`);
      return;
    }
    Alert.alert(
      'Archive this semester?',
      `${active.length} course${active.length === 1 ? '' : 's'} for ${academicYear} will move to your archive. Nothing is deleted — notes, decks and tests stay filed under each course.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            setArchiving(true);
            void archiveAcademicYear(academicYear)
              .then(async count => {
                await reloadCourses();
                Alert.alert('Archived', `${count} course${count === 1 ? '' : 's'} archived.`);
              })
              .catch((e: unknown) =>
                Alert.alert('Could not archive', e instanceof Error ? e.message : 'Please try again.')
              )
              .finally(() => setArchiving(false));
          },
        },
      ]
    );
  }, [courses, academicYear, reloadCourses]);

  const selectedCourses = useMemo(() => courses.map(row => row.course), [courses]);
  const inputStyle = [
    styles.input,
    { color: colors.inputText, backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
  ];

  return (
    <Screen keyboard bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Close">
          <AppIcon name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Academic</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? <ActivityIndicator color={colors.primary} style={{ marginBottom: 12 }} /> : null}

        {/* Identity */}
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Your university</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Institution</Text>
          <CampusPicker
            campuses={institutions}
            value={institutionId}
            onChange={setInstitutionId}
            emptyLabel={institutionsLoading ? 'Loading institutions…' : 'Choose your university or polytechnic'}
            searchPlaceholder="Search universities and polytechnics…"
          />

          <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>Programme</Text>
          <TextInput
            value={programme}
            onChangeText={setProgramme}
            placeholder="e.g. Medicine and Surgery"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="words"
            style={inputStyle}
            accessibilityLabel="Programme"
          />

          <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>Faculty (optional)</Text>
          <TextInput
            value={faculty}
            onChangeText={setFaculty}
            placeholder="e.g. Faculty of Science"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="words"
            style={inputStyle}
            accessibilityLabel="Faculty"
          />

          <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>
            Level{studyLevel ? ` · ${studyLevelLabel(studyLevel)}` : ''}
          </Text>
          <StudyLevelPicker value={studyLevel} onChange={setStudyLevel} />

          <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>
            Semester{currentSemester ? ` · ${semesterLabel(currentSemester)}` : ''}
          </Text>
          <SemesterPicker value={currentSemester} onChange={setCurrentSemester} />

          <View style={styles.yearRow}>
            <View style={styles.yearCol}>
              <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>Entry year</Text>
              <TextInput
                value={entryYear}
                onChangeText={text => setEntryYear(text.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="2024"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="number-pad"
                maxLength={4}
                style={inputStyle}
                accessibilityLabel="Entry year"
              />
            </View>
            <View style={styles.yearCol}>
              <Text style={[styles.label, styles.labelSpaced, { color: colors.textSecondary }]}>Expected graduation</Text>
              <TextInput
                value={graduationYear}
                onChangeText={text => setGraduationYear(text.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="2029"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="number-pad"
                maxLength={4}
                style={inputStyle}
                accessibilityLabel="Expected graduation year"
              />
            </View>
          </View>

          <Pressable
            onPress={() => void handleSaveProfile()}
            disabled={saving || loading}
            accessibilityRole="button"
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: saving || loading ? 0.6 : 1 }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: colors.textInverse }]}>Save academic profile</Text>
            )}
          </Pressable>
        </View>

        {/* My courses */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>My courses · {academicYear}</Text>
          {coursesLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Add a course</Text>
          <CourseMultiSelect
            selected={selectedCourses}
            onChange={() => {}}
            onPick={course => void handleAddCourse(course)}
            institutionId={institutionId || null}
            includeMyCourses={false}
            showChips={false}
            placeholder="Search or add a course, e.g. BIO 201"
          />

          {coursesError ? <Text style={[styles.errorText, { color: colors.error }]}>{coursesError}</Text> : null}

          {!coursesLoading && courses.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No active courses yet. Add the courses you are taking this semester — notes, decks and tests
              can then be filed under them.
            </Text>
          ) : null}

          {courses.map(row => {
            const draft = examDrafts[row.course.id] ?? '';
            const dirty = draft.trim() !== (row.examDate ?? '');
            return (
              <View key={`${row.course.id}-${row.academicYear}`} style={[styles.courseRow, { borderTopColor: colors.border }]}>
                <View style={styles.courseHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.courseCode, { color: colors.text }]}>{formatCourseLabel(row.course)}</Text>
                    <Text style={[styles.courseMeta, { color: colors.textTertiary }]}>
                      {row.academicYear}
                      {row.semester ? ` · Semester ${row.semester}` : ''}
                      {row.examDate ? ` · Exam ${row.examDate}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveCourse(row)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${row.course.code}`}
                  >
                    <AppIcon name="trash" size={18} color={colors.error} />
                  </Pressable>
                </View>
                <View style={styles.examRow}>
                  <TextInput
                    value={draft}
                    onChangeText={text =>
                      setExamDrafts(prev => ({ ...prev, [row.course.id]: text.replace(/[^\d-]/g, '').slice(0, 10) }))
                    }
                    placeholder="Exam date YYYY-MM-DD"
                    placeholderTextColor={colors.inputPlaceholder}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    style={[inputStyle, styles.examInput]}
                    accessibilityLabel={`Exam date for ${row.course.code}`}
                  />
                  <Pressable
                    onPress={() => void handleSaveExamDate(row)}
                    disabled={!dirty || savingExamFor === row.course.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Save exam date for ${row.course.code}`}
                    style={[
                      styles.examSave,
                      { backgroundColor: dirty ? colors.primary : colors.inputBackground, borderColor: colors.inputBorder },
                    ]}
                  >
                    {savingExamFor === row.course.id ? (
                      <ActivityIndicator size="small" color={dirty ? colors.textInverse : colors.primary} />
                    ) : (
                      <AppIcon name="checkmark" size={18} color={dirty ? colors.textInverse : colors.textTertiary} />
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}

          <Pressable
            onPress={handleArchiveSemester}
            disabled={archiving || coursesLoading}
            accessibilityRole="button"
            style={[styles.secondaryButton, { borderColor: colors.border, opacity: archiving ? 0.6 : 1 }]}
          >
            {archiving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <AppIcon name="archive" size={16} color={colors.textSecondary} />
                <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>Archive this semester</Text>
              </>
            )}
          </Pressable>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            Archiving keeps everything — it just moves {academicYear} out of your active list so next
            semester starts clean.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 40, alignItems: 'center', justifyContent: 'center', padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  labelSpaced: { marginTop: 14 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  yearRow: { flexDirection: 'row', gap: 12 },
  yearCol: { flex: 1 },
  primaryButton: { marginTop: 18, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  errorText: { fontSize: 12, marginTop: 8 },
  emptyText: { fontSize: 13, marginTop: 12, lineHeight: 19 },
  courseRow: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  courseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courseCode: { fontSize: 15, fontWeight: '600' },
  courseMeta: { fontSize: 12, marginTop: 2 },
  examRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  examInput: { flex: 1, paddingVertical: 10 },
  examSave: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
