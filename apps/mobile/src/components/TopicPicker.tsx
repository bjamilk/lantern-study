/**
 * Single-select topic picker (bottom-sheet modal) — the sibling of
 * CoursePicker, and always rendered beneath one.
 *
 * A topic belongs to exactly one course, so this is disabled until a course is
 * chosen and the caller clears the selection when the course changes. The
 * outline is filtered client-side with an inline "Add ‘Gas exchange’" row that
 * find-or-creates via POST /courses/:courseId/topics. StyleSheet + useTheme so
 * it drops into both the NativeWind screens and the legacy StyleSheet modals.
 */
import React, { useCallback, useMemo, useState } from 'react';
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
import type { CourseTopic } from '@lantern/shared/types';
import { useTheme } from '../theme';
import { createCourseTopic } from '../services/academic';
import { useCourseTopics, useTopicSearch } from '../hooks/useTopicSearch';
import { formatTopicLabel } from '../utils/topicSelection';

export interface TopicPickerProps {
  /** Course the topic must belong to. Without one the picker is disabled. */
  courseId: string | null | undefined;
  /** Selected topic id (null/undefined = none). */
  value: string | null | undefined;
  onChange: (topic: CourseTopic | null) => void;
  placeholder?: string;
  /** Label to show when only the id is known (e.g. a restored draft). */
  fallbackLabel?: string | null;
  allowClear?: boolean;
  disabled?: boolean;
  /** Sheet title. */
  title?: string;
  accessibilityLabel?: string;
  /**
   * Controlled mode for row action sheets ("Move to topic…"): when `visible`
   * is given the trigger is not rendered and the sheet's open state is owned by
   * the parent, which hears dismissal through `onClose`.
   */
  visible?: boolean;
  onClose?: () => void;
}

export function TopicPicker({
  courseId,
  value,
  onChange,
  placeholder = 'Choose a topic (optional)',
  fallbackLabel,
  allowClear = true,
  disabled = false,
  title = 'Topic',
  accessibilityLabel = 'Topic',
  visible,
  onClose,
}: TopicPickerProps) {
  const { colors } = useTheme();

  const controlled = visible !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? Boolean(visible) : selfOpen;
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const noCourse = !courseId;
  const locked = disabled || noCourse;
  // In controlled mode there is no trigger to label, so only fetch while open.
  const { topics, loading, unavailable, addTopic } = useCourseTopics(
    courseId,
    controlled ? open : true
  );
  // `unavailable` suppresses the "Add ‘…’" row: offering a create that is
  // guaranteed to fail (the course_topics migration is not applied everywhere)
  // is worse than offering nothing.
  const { options, addTitle } = useTopicSearch({ query, topics, unavailable });

  const selected = useMemo(
    () => (value ? topics.find(topic => topic.id === value) : undefined),
    [topics, value]
  );
  const triggerLabel = noCourse
    ? 'Pick a course first'
    : selected
      ? formatTopicLabel(selected)
      : value
        ? fallbackLabel || 'Topic selected'
        : placeholder;

  const close = useCallback(() => {
    Keyboard.dismiss();
    if (controlled) onClose?.();
    else setSelfOpen(false);
    setQuery('');
    setCreateError(null);
  }, [controlled, onClose]);

  const select = useCallback(
    (topic: CourseTopic | null) => {
      if (topic) addTopic(topic);
      onChange(topic);
      close();
    },
    [addTopic, onChange, close]
  );

  const submitCreate = useCallback(
    async (rawTitle: string) => {
      if (!courseId) return;
      setCreating(true);
      setCreateError(null);
      try {
        select(await createCourseTopic(courseId, rawTitle));
      } catch (e: unknown) {
        setCreateError(e instanceof Error ? e.message : 'Could not add this topic');
      } finally {
        setCreating(false);
      }
    },
    [courseId, select]
  );

  return (
    <>
      {controlled ? null : (
        <Pressable
          onPress={() => {
            if (!locked) setSelfOpen(true);
          }}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityLabel}: ${triggerLabel}`}
          accessibilityState={{ disabled: locked }}
          style={[
            styles.trigger,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              opacity: locked ? 0.6 : 1,
            },
          ]}
        >
          <Ionicons
            name="list-outline"
            size={18}
            color={value && !noCourse ? colors.primary : colors.inputPlaceholder}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.triggerText,
              { color: value && !noCourse ? colors.inputText : colors.inputPlaceholder },
            ]}
          >
            {triggerLabel}
          </Text>
          {value && allowClear && !locked ? (
            <Pressable
              onPress={() => onChange(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear topic"
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
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close topic picker" />
          <View style={[styles.sheet, { backgroundColor: colors.modalBackground }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View
              style={[
                styles.searchRow,
                { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
              ]}
            >
              <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
              <TextInput
                value={query}
                onChangeText={text => {
                  setQuery(text);
                  setCreateError(null);
                }}
                placeholder={unavailable ? 'Search topics' : 'Search or type a new topic'}
                placeholderTextColor={colors.inputPlaceholder}
                autoCorrect={false}
                autoFocus
                style={[styles.searchInput, { color: colors.inputText }]}
                accessibilityLabel="Search topics"
              />
              {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              contentContainerStyle={styles.listContent}
            >
              {value && allowClear ? (
                <Pressable
                  onPress={() => select(null)}
                  accessibilityRole="button"
                  style={[styles.row, { borderBottomColor: colors.border }]}
                >
                  <Ionicons name="remove-circle-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.rowText, { color: colors.textSecondary }]}>No topic</Text>
                </Pressable>
              ) : null}

              {options.map(topic => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  selected={topic.id === value}
                  onPress={() => select(topic)}
                />
              ))}

              {addTitle ? (
                <Pressable
                  onPress={() => void submitCreate(addTitle)}
                  disabled={creating}
                  accessibilityRole="button"
                  style={[styles.row, { borderBottomColor: colors.border, opacity: creating ? 0.6 : 1 }]}
                >
                  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={[styles.rowText, { flex: 1, color: colors.primary, fontWeight: '600' }]}>
                    Add ‘{addTitle}’
                  </Text>
                  {creating ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                </Pressable>
              ) : null}

              {createError ? (
                <Text style={[styles.errorText, { color: colors.error }]}>{createError}</Text>
              ) : null}

              {/* The unavailable message is NOT gated on `addTitle`: typing must
                  not hide the one line that explains why nothing can be added. */}
              {!loading && options.length === 0 && (unavailable || !addTitle) ? (
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {unavailable
                    ? 'Topics aren’t available for this course yet.'
                    : query.trim()
                      ? 'No topic matches. Type a full title to add it.'
                      : 'No topics in this course yet — type a title to add the first one.'}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function TopicRow({
  topic,
  selected,
  onPress,
}: {
  topic: CourseTopic;
  selected: boolean;
  onPress: () => void;
}) {
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
      <Text
        numberOfLines={2}
        style={[styles.rowTitle, { flex: 1, color: selected ? colors.primary : colors.text }]}
      >
        {formatTopicLabel(topic)}
      </Text>
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
  rowTitle: { fontSize: 15, fontWeight: '500' },
  errorText: { fontSize: 12, paddingTop: 8 },
  emptyText: { fontSize: 13, paddingVertical: 16, textAlign: 'center' },
});

export default TopicPicker;
