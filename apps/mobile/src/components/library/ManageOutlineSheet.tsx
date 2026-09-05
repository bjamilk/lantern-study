/**
 * Manage a course's syllabus outline (Phase 1 · A) — rename, reorder and delete
 * topics, at parity with web. Opened from a course row in the Library tree.
 *
 * Everything here edits SHARED course data: the outline every student on the
 * course sees. Renaming and reordering change it for all of them (the hints say
 * so), and deleting confirms out loud — but a delete only UNFILES artefacts
 * (ON DELETE SET NULL); it never destroys anyone's notes, decks or tests.
 *
 * Reorder is up/down, not drag: a bottom-sheet over a scrolling tree is the
 * wrong place to fight a pan gesture, and the outcome — the position the server
 * stores — is identical.
 *
 * StyleSheet + useTheme to match TopicPicker, its sibling modal.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CourseTopic } from '@lantern/shared/types';
import {
  COURSE_TOPIC_COPY,
  TOPIC_TITLE_MAX,
  formatDeleteTopicTitle,
  upsertCourseTopic,
} from '@lantern/shared';
import { useTheme } from '../../theme';
import {
  deleteCourseTopic,
  getCourseTopics,
  invalidateCourseTopicsCache,
  renameCourseTopic,
  reorderCourseTopics,
} from '../../services/academic';
import { SCREEN_KEYBOARD_BEHAVIOR } from '../layout';
import { AppIcon } from '../ui/AppIcon';

export interface ManageOutlineSheetProps {
  courseId: string | null;
  /** Course code/label for the sheet header. */
  courseLabel?: string | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Fired after any successful mutation so the Library overview refetches — the
   * tree's topic rows and their counts follow the outline that just changed.
   */
  onChanged?: () => void;
  /**
   * A topic was deleted. The Library filter can be pointing AT it, and a filter
   * on a dead uuid matches nothing — every tab would empty out under a chip
   * still naming the topic. The screen that owns the filter clears it.
   */
  onTopicDeleted?: (topicId: string) => void;
}

export function ManageOutlineSheet({
  courseId,
  courseLabel,
  visible,
  onClose,
  onChanged,
  onTopicDeleted,
}: ManageOutlineSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The outline could not be READ, as opposed to a mutation that failed. Kept
   * apart from `error` so the empty state can say "this course has no outline
   * we can show" instead of claiming the course has no topics — it may have
   * twelve. Mirrors web's `loadError`.
   */
  const [loadError, setLoadError] = useState(false);
  /** A mutation is in flight; the whole list is inert until it settles. */
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Fresh outline every time the sheet opens; force past the picker cache so a
  // topic added in a picker moments ago is already here.
  //
  // This sheet is mounted for the whole Library screen, so `topics` OUTLIVES a
  // close. Clearing it up front is load-bearing, not tidiness: rename and delete
  // act on the row the student taps, and rows left over from the previously
  // managed course would aim those writes at ANOTHER course's shared outline
  // while the header names the new one.
  useEffect(() => {
    setTopics([]);
    setEditingId(null);
    setError(null);
    setLoadError(false);
    if (!visible || !courseId) return;
    let cancelled = false;
    setLoading(true);
    getCourseTopics(courseId, { force: true })
      .then(rows => {
        if (!cancelled) setTopics(rows);
      })
      .catch(() => {
        // Never leave a stale list behind an error — an unreadable outline must
        // show as unreadable, not as the last course's topics.
        if (cancelled) return;
        setTopics([]);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, courseId]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    setEditingId(null);
    onClose();
  }, [onClose]);

  // Every mutation drops the shared picker cache so no other surface keeps a
  // stale outline, then asks the overview to refetch.
  const afterMutation = useCallback(() => {
    if (courseId) invalidateCourseTopicsCache(courseId);
    onChanged?.();
  }, [courseId, onChanged]);

  const startRename = useCallback((topic: CourseTopic) => {
    setError(null);
    setEditingId(topic.id);
    setEditingTitle(topic.title);
  }, []);

  const submitRename = useCallback(async () => {
    if (!courseId || !editingId) return;
    const next = editingTitle.trim();
    const current = topics.find(t => t.id === editingId);
    // Nothing to save if it is blank or unchanged — just leave edit mode.
    if (!next || next === current?.title) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await renameCourseTopic(courseId, editingId, next);
      setTopics(prev => upsertCourseTopic(prev, saved));
      setEditingId(null);
      afterMutation();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : COURSE_TOPIC_COPY.renameFailed);
    } finally {
      setBusy(false);
    }
  }, [courseId, editingId, editingTitle, topics, afterMutation]);

  const move = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (!courseId || busy) return;
      const target = index + direction;
      if (target < 0 || target >= topics.length) return;
      const reordered = [...topics];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      setBusy(true);
      setError(null);
      try {
        const saved = await reorderCourseTopics(
          courseId,
          reordered.map(t => t.id)
        );
        setTopics(saved);
        afterMutation();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : COURSE_TOPIC_COPY.reorderFailed);
      } finally {
        setBusy(false);
      }
    },
    [courseId, busy, topics, afterMutation]
  );

  const runDelete = useCallback(
    async (topic: CourseTopic) => {
      if (!courseId) return;
      setBusy(true);
      setError(null);
      try {
        await deleteCourseTopic(courseId, topic.id);
        setTopics(prev => prev.filter(t => t.id !== topic.id));
        // Before the overview refetch: a live filter on this topic now points at
        // a uuid that no longer exists, and would silently empty every tab.
        onTopicDeleted?.(topic.id);
        afterMutation();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : COURSE_TOPIC_COPY.deleteFailed);
      } finally {
        setBusy(false);
      }
    },
    [courseId, afterMutation, onTopicDeleted]
  );

  const confirmDelete = useCallback(
    (topic: CourseTopic) => {
      // Both halves of deleteBody are load-bearing: shared (it disappears for
      // everyone) and no-work-lost (artefacts only unfile).
      Alert.alert(formatDeleteTopicTitle(topic.title), COURSE_TOPIC_COPY.deleteBody, [
        { text: COURSE_TOPIC_COPY.deleteCancel, style: 'cancel' },
        { text: COURSE_TOPIC_COPY.deleteConfirm, style: 'destructive', onPress: () => void runDelete(topic) },
      ]);
    },
    [runDelete]
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* Bottom-anchored sheet + an add/rename topic field: on Android 15+
          (this app targets SDK 36) the window is not resized, so the keyboard
          covered the field being typed into and the Save row beneath it.
          The KeyboardAvoidingView IS the overlay, so the sheet lifts and its
          85% max-height resolves against the keyboard-free box. */}
      <KeyboardAvoidingView behavior={SCREEN_KEYBOARD_BEHAVIOR} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close manage topics" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12, backgroundColor: colors.modalBackground }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <View style={styles.headerText}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{COURSE_TOPIC_COPY.manageTitle}</Text>
              {courseLabel ? (
                <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {courseLabel}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <AppIcon name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={[styles.shared, { color: colors.textSecondary }]}>{COURSE_TOPIC_COPY.shared}</Text>

          {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

          {/* `loading` alone, never "loading AND empty": a list that is still
              arriving must not be interactive, or a tap lands on whatever rows
              happen to be on screen. Same gate as web's skeleton. */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.centerText, { color: colors.textSecondary }]}>{COURSE_TOPIC_COPY.loading}</Text>
            </View>
          ) : loadError ? (
            <View style={styles.center}>
              <Text style={[styles.centerText, { color: colors.textSecondary }]}>{COURSE_TOPIC_COPY.unavailable}</Text>
            </View>
          ) : topics.length === 0 ? (
            <View style={styles.center}>
              {/* Not the picker's "type a title" line — there is no title field here. */}
              <Text style={[styles.centerText, { color: colors.textSecondary }]}>{COURSE_TOPIC_COPY.manageEmpty}</Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              contentContainerStyle={styles.listContent}
            >
              {topics.map((topic, index) => {
                const editing = editingId === topic.id;
                return (
                  <View key={topic.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                    {editing ? (
                      <>
                        <TextInput
                          value={editingTitle}
                          onChangeText={setEditingTitle}
                          autoFocus
                          maxLength={TOPIC_TITLE_MAX}
                          placeholder={COURSE_TOPIC_COPY.rename}
                          placeholderTextColor={colors.inputPlaceholder}
                          onSubmitEditing={() => void submitRename()}
                          returnKeyType="done"
                          style={[
                            styles.renameInput,
                            { color: colors.inputText, backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                          ]}
                          accessibilityLabel={COURSE_TOPIC_COPY.rename}
                        />
                        <Pressable
                          onPress={() => void submitRename()}
                          disabled={busy}
                          hitSlop={6}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={COURSE_TOPIC_COPY.rename}
                        >
                          <AppIcon name="checkmark" size={20} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => setEditingId(null)}
                          disabled={busy}
                          hitSlop={6}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={COURSE_TOPIC_COPY.deleteCancel}
                        >
                          <AppIcon name="close" size={20} color={colors.textSecondary} />
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
                          {topic.title || COURSE_TOPIC_COPY.untitled}
                        </Text>
                        <Pressable
                          onPress={() => move(index, -1)}
                          disabled={busy || index === 0}
                          hitSlop={6}
                          style={[styles.iconButton, { opacity: index === 0 ? 0.3 : 1 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${topic.title} up`}
                        >
                          <AppIcon name="chevron-up" size={20} color={colors.textSecondary} />
                        </Pressable>
                        <Pressable
                          onPress={() => move(index, 1)}
                          disabled={busy || index === topics.length - 1}
                          hitSlop={6}
                          style={[styles.iconButton, { opacity: index === topics.length - 1 ? 0.3 : 1 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${topic.title} down`}
                        >
                          <AppIcon name="chevron-down" size={20} color={colors.textSecondary} />
                        </Pressable>
                        <Pressable
                          onPress={() => startRename(topic)}
                          disabled={busy}
                          hitSlop={6}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={`${COURSE_TOPIC_COPY.rename} ${topic.title}`}
                        >
                          <AppIcon name="pencil" size={18} color={colors.textSecondary} />
                        </Pressable>
                        <Pressable
                          onPress={() => confirmDelete(topic)}
                          disabled={busy}
                          hitSlop={6}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel={`${COURSE_TOPIC_COPY.delete} ${topic.title}`}
                        >
                          <AppIcon name="trash" size={18} color={colors.error} />
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              })}

              <Text style={[styles.footerHint, { color: colors.textTertiary }]}>{COURSE_TOPIC_COPY.reorderHint}</Text>
            </ScrollView>
          )}

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  headerText: { flex: 1, paddingRight: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSubtitle: { fontSize: 13, marginTop: 2 },
  shared: { fontSize: 12, paddingHorizontal: 16, paddingTop: 12 },
  errorText: { fontSize: 12, paddingHorizontal: 16, paddingTop: 8 },
  center: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  centerText: { fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  list: { marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '500', paddingRight: 4 },
  renameInput: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  iconButton: { padding: 6, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  footerHint: { fontSize: 12, paddingTop: 12 },
  busyRow: { alignItems: 'center', paddingVertical: 10 },
});

export default ManageOutlineSheet;
