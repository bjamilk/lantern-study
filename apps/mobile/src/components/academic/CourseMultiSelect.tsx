/**
 * Inline multi-select course typeahead: selected chips + search box +
 * dropdown (my courses first, then GET /courses) + "Add ‘BIO 201’" create row.
 * Used by the profile-setup modal and Academic settings.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Course } from '@lantern/shared/types';
import { COURSE_TITLE_MIN_LENGTH } from '@lantern/shared/academic';
import { useTheme } from '../../theme';
import { createCourse } from '../../services/api';
import { useCourseSearch, useMyActiveCourses } from '../../hooks/useCourseSearch';
import { formatCourseLabel, toggleCourseSelection } from '../../utils/courseSelection';

interface CourseMultiSelectProps {
  selected: Course[];
  onChange: (next: Course[]) => void;
  institutionId?: string | null;
  placeholder?: string;
  maxSelected?: number;
  disabled?: boolean;
  /** Hide "my courses" suggestions (e.g. when the list IS my courses). */
  includeMyCourses?: boolean;
  /** Fires when a single course is picked (used by "add one" flows). */
  onPick?: (course: Course) => void;
  /** Render the selected chips above the search box (off for "add one" flows). */
  showChips?: boolean;
}

export function CourseMultiSelect({
  selected,
  onChange,
  institutionId,
  placeholder = 'Search courses, e.g. BIO 201',
  maxSelected = 40,
  disabled = false,
  includeMyCourses = true,
  onPick,
  showChips = true,
}: CourseMultiSelectProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [createCode, setCreateCode] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { myCourses } = useMyActiveCourses(includeMyCourses);
  const showDropdown = focused || query.trim().length > 0 || !!createCode;
  const { options, searching, addCode } = useCourseSearch({
    query,
    institutionId,
    enabled: showDropdown,
    excludeIds: selected.map(c => c.id),
    myCourses: includeMyCourses ? myCourses : [],
    limit: 8,
  });

  const pick = useCallback(
    (course: Course) => {
      if (selected.length >= maxSelected && !selected.some(c => c.id === course.id)) return;
      onChange(toggleCourseSelection(selected, course));
      onPick?.(course);
      setQuery('');
      setCreateCode(null);
      setCreateTitle('');
      setCreateError(null);
    },
    [selected, maxSelected, onChange, onPick]
  );

  const remove = useCallback(
    (course: Course) => onChange(selected.filter(c => c.id !== course.id)),
    [selected, onChange]
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
      const course = await createCourse({ institutionId: institutionId ?? null, code: createCode, title: titleValue });
      pick(course);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Could not add this course');
    } finally {
      setCreating(false);
    }
  }, [createCode, createTitle, institutionId, pick]);

  return (
    <View>
      {showChips && selected.length > 0 ? (
        <View style={styles.chips}>
          {selected.map(course => (
            <View key={course.id} style={[styles.chip, { backgroundColor: colors.primaryBackground }]}>
              <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>
                {formatCourseLabel(course)}
              </Text>
              {!disabled ? (
                <Pressable
                  onPress={() => remove(course)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${course.code}`}
                >
                  <Ionicons name="close" size={14} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
        <TextInput
          value={query}
          onChangeText={text => {
            setQuery(text);
            setCreateCode(null);
            setCreateError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!disabled}
          style={[styles.searchInput, { color: colors.inputText }]}
          accessibilityLabel="Search courses"
        />
        {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

      {showDropdown && (options.length > 0 || addCode || createCode) ? (
        <View style={[styles.dropdown, { borderColor: colors.inputBorder, backgroundColor: colors.card }]}>
          {options.map(course => (
            <Pressable
              key={course.id}
              onPress={() => pick(course)}
              accessibilityRole="button"
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowCode, { color: colors.text }]}>{course.code}</Text>
                {course.title && course.title.toUpperCase() !== course.code ? (
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.textSecondary }]}>
                    {course.title}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            </Pressable>
          ))}

          {addCode && !createCode ? (
            <Pressable
              onPress={() => {
                setCreateCode(addCode);
                setCreateTitle('');
              }}
              accessibilityRole="button"
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={[styles.addText, { color: colors.primary }]}>Add ‘{addCode}’</Text>
            </Pressable>
          ) : null}

          {createCode ? (
            <View style={styles.createBox}>
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
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: '100%',
  },
  chipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  dropdown: { marginTop: 6, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowCode: { fontSize: 14, fontWeight: '600' },
  rowTitle: { fontSize: 12, marginTop: 1 },
  addText: { fontSize: 14, fontWeight: '600' },
  createBox: { padding: 12, gap: 8 },
  createTitle: { fontSize: 14, fontWeight: '700' },
  createInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  createActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  createCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  createSubmit: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minWidth: 110, alignItems: 'center' },
  errorText: { fontSize: 12 },
});

export default CourseMultiSelect;
