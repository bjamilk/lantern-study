/**
 * Single-select course picker (bottom-sheet modal).
 *
 * My active courses first, then search over GET /courses, an inline
 * "Add ‘BIO 201’" row that find-or-creates via POST /courses, and a clear
 * row. StyleSheet + useTheme so it drops into both the NativeWind screens
 * and the legacy StyleSheet modals.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Course } from '@lantern/shared/types';
import { COURSE_TITLE_MIN_LENGTH } from '@lantern/shared/academic';
import { useTheme } from '../theme';
import { useAuthStore } from '../stores/authStore';
import { createCourse } from '../services/api';
import { useCourseSearch, useMyActiveCourses } from '../hooks/useCourseSearch';
import { formatCourseLabel } from '../utils/courseSelection';

export interface CoursePickerProps {
  /** Selected course id (null/undefined = none). */
  value: string | null | undefined;
  onChange: (course: Course | null) => void;
  /** Narrow search to an institution; defaults to the signed-in student's. */
  institutionId?: string | null;
  placeholder?: string;
  /** Label to show when only the id is known (e.g. a listing's stored course code). */
  fallbackLabel?: string | null;
  allowClear?: boolean;
  disabled?: boolean;
  /** Sheet title. */
  title?: string;
  accessibilityLabel?: string;
  /**
   * Controlled mode for row action sheets ("Move to course…"): when `visible`
   * is given the trigger is not rendered and the sheet's open state is owned by
   * the parent, which hears dismissal through `onClose`.
   */
  visible?: boolean;
  onClose?: () => void;
}

export function CoursePicker({
  value,
  onChange,
  institutionId,
  placeholder = 'Choose a course (optional)',
  fallbackLabel,
  allowClear = true,
  disabled = false,
  title = 'Course',
  accessibilityLabel = 'Course',
  visible,
  onClose,
}: CoursePickerProps) {
  const { colors } = useTheme();
  const profileInstitutionId = useAuthStore(s => s.academicProfile?.institutionId ?? null);
  const effectiveInstitutionId = institutionId === undefined ? profileInstitutionId : institutionId;

  const controlled = visible !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? Boolean(visible) : selfOpen;
  const [query, setQuery] = useState('');
  const [known, setKnown] = useState<Record<string, Course>>({});
  const [creating, setCreating] = useState(false);
  const [createCode, setCreateCode] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const { myCourses } = useMyActiveCourses(true);
  const { options, searching, error, addCode } = useCourseSearch({
    query,
    institutionId: effectiveInstitutionId,
    enabled: open,
    myCourses,
  });

  // Remember every course we have seen so the trigger can label an id.
  useEffect(() => {
    if (!myCourses.length && !options.length) return;
    setKnown(prev => {
      // Idempotent: bail out (same reference → React skips the re-render) when
      // every id is already known, so this never loops even if `options` is a
      // fresh array.
      const allPresent =
        myCourses.every(row => prev[row.course.id]) && options.every(course => prev[course.id]);
      if (allPresent) return prev;
      const next = { ...prev };
      myCourses.forEach(row => {
        next[row.course.id] = row.course;
      });
      options.forEach(course => {
        next[course.id] = course;
      });
      return next;
    });
  }, [myCourses, options]);

  const selected = value ? known[value] : undefined;
  const triggerLabel = selected
    ? formatCourseLabel(selected)
    : value
      ? fallbackLabel || 'Course selected'
      : placeholder;

  const myIds = useMemo(() => new Set(myCourses.map(row => row.course.id)), [myCourses]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    if (controlled) onClose?.();
    else setSelfOpen(false);
    setQuery('');
    setCreateCode(null);
    setCreateTitle('');
    setCreateError(null);
  }, [controlled, onClose]);

  const select = useCallback(
    (course: Course | null) => {
      if (course) setKnown(prev => ({ ...prev, [course.id]: course }));
      onChange(course);
      close();
    },
    [onChange, close]
  );

  const submitCreate = useCallback(async () => {
    if (!createCode) return;
    const titleValue = createTitle.trim();
    if (titleValue.length < COURSE_TITLE_MIN_LENGTH) {
      setCreateError('Give the course a short title, e.g. "Introductory Biology".');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const course = await createCourse({
        institutionId: effectiveInstitutionId ?? null,
        code: createCode,
        title: titleValue,
      });
      select(course);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Could not add this course');
    } finally {
      setCreating(false);
    }
  }, [createCode, createTitle, effectiveInstitutionId, select]);

  const mine = options.filter(course => myIds.has(course.id));
  const others = options.filter(course => !myIds.has(course.id));

  return (
    <>
      {controlled ? null : (
      <Pressable
        onPress={() => {
          if (!disabled) setSelfOpen(true);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${triggerLabel}`}
        accessibilityState={{ disabled }}
        style={[
          styles.trigger,
          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, opacity: disabled ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="school-outline" size={18} color={value ? colors.primary : colors.inputPlaceholder} />
        <Text
          numberOfLines={1}
          style={[styles.triggerText, { color: value ? colors.inputText : colors.inputPlaceholder }]}
        >
          {triggerLabel}
        </Text>
        {value && allowClear && !disabled ? (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear course"
            style={styles.clearButton}
          >
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={16} color={colors.inputPlaceholder} />
        )}
      </Pressable>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close course picker" />
          <View style={[styles.sheet, { backgroundColor: colors.modalBackground }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={[styles.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
              <TextInput
                value={query}
                onChangeText={text => {
                  setQuery(text);
                  setCreateCode(null);
                  setCreateError(null);
                }}
                placeholder="Search by code or title, e.g. BIO 201"
                placeholderTextColor={colors.inputPlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                style={[styles.searchInput, { color: colors.inputText }]}
                accessibilityLabel="Search courses"
              />
              {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
              {value && allowClear ? (
                <Pressable
                  onPress={() => select(null)}
                  accessibilityRole="button"
                  style={[styles.row, { borderBottomColor: colors.border }]}
                >
                  <Ionicons name="remove-circle-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.rowText, { color: colors.textSecondary }]}>No course</Text>
                </Pressable>
              ) : null}

              {mine.length > 0 ? (
                <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>My courses</Text>
              ) : null}
              {mine.map(course => (
                <CourseRow key={course.id} course={course} selected={course.id === value} onPress={() => select(course)} />
              ))}

              {others.length > 0 ? (
                <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
                  {mine.length > 0 ? 'More courses' : 'Courses'}
                </Text>
              ) : null}
              {others.map(course => (
                <CourseRow key={course.id} course={course} selected={course.id === value} onPress={() => select(course)} />
              ))}

              {addCode && !createCode ? (
                <Pressable
                  onPress={() => {
                    setCreateCode(addCode);
                    setCreateTitle('');
                    setCreateError(null);
                  }}
                  accessibilityRole="button"
                  style={[styles.row, { borderBottomColor: colors.border }]}
                >
                  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={[styles.rowText, { color: colors.primary, fontWeight: '600' }]}>Add ‘{addCode}’</Text>
                </Pressable>
              ) : null}

              {createCode ? (
                <View style={[styles.createBox, { borderColor: colors.primary, backgroundColor: colors.primaryBackground }]}>
                  <Text style={[styles.createTitle, { color: colors.text }]}>Add {createCode}</Text>
                  <TextInput
                    value={createTitle}
                    onChangeText={setCreateTitle}
                    placeholder="Course title, e.g. Introductory Biology"
                    placeholderTextColor={colors.inputPlaceholder}
                    autoFocus
                    style={[
                      styles.createInput,
                      { color: colors.inputText, borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                    ]}
                    accessibilityLabel="Course title"
                    onSubmitEditing={() => void submitCreate()}
                  />
                  {createError ? <Text style={[styles.errorText, { color: colors.error }]}>{createError}</Text> : null}
                  <View style={styles.createActions}>
                    <Pressable onPress={() => setCreateCode(null)} style={styles.createCancel} accessibilityRole="button">
                      <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void submitCreate()}
                      disabled={creating}
                      accessibilityRole="button"
                      style={[styles.createSubmit, { backgroundColor: colors.primary, opacity: creating ? 0.6 : 1 }]}
                    >
                      {creating ? (
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      ) : (
                        <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Add course</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {!searching && options.length === 0 && !addCode && !createCode ? (
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {error
                    ? `Could not search courses: ${error}`
                    : query.trim()
                      ? 'No courses match. Type a full code like "BIO 201" to add it.'
                      : 'Type a course code or title to search.'}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function CourseRow({ course, selected, onPress }: { course: Course; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.row,
        { borderBottomColor: colors.border, backgroundColor: selected ? colors.primaryBackground : 'transparent' },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowCode, { color: selected ? colors.primary : colors.text }]}>{course.code}</Text>
        {course.title && course.title.toUpperCase() !== course.code ? (
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.textSecondary }]}>
            {course.title}
          </Text>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  triggerText: { flex: 1, fontSize: 15 },
  clearButton: { padding: 2 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 46,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  list: { marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  rowText: { fontSize: 15 },
  rowCode: { fontSize: 15, fontWeight: '600' },
  rowTitle: { fontSize: 13, marginTop: 2 },
  createBox: { marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  createTitle: { fontSize: 14, fontWeight: '700' },
  createInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  createActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  createCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  createSubmit: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minWidth: 110, alignItems: 'center' },
  errorText: { fontSize: 12 },
  emptyText: { fontSize: 13, paddingVertical: 16, textAlign: 'center' },
});

export default CoursePicker;
