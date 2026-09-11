import React, { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  courseWorkspaceLabel,
  formatCourseMaterialCounts,
  isCalendarNote,
  isValidStudySetTitle,
  materialsForStudySet,
  normalizeStudySetTitle,
  STUDY_SET_TITLE_MAX,
  studySetLabel,
} from '@lantern/shared';
import type { UserCourse } from '@lantern/shared/types';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { Button, Card, FeatureRow, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { getMyActiveCourses } from '../../services/academic';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * The Study hub lists personal study sets first. A course is optional filing.
 * Import from here stays unfiled unless the student opens a set and imports there.
 */
export function StudyHubScreen({ navigation }: Props) {
  const { decks } = useFlashcardStore();
  const notes = useNotesStore((s) => s.notes);
  const userId = useAuthStore((s) => s.user?.id);
  const fetchTests = useTestStore((s) => s.fetchTests);
  const fetchAttempts = useTestStore((s) => s.fetchAttempts);
  const showToast = useToastStore((s) => s.showToast);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const createSet = useStudySetStore((s) => s.createSet);
  const sets = useStudySetStore((s) => s.sets);
  const tabBarClearance = useTabBarClearance(16);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createCourseId, setCreateCourseId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [courses, setCourses] = useState<UserCourse[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (userId) {
          void fetchTests(userId).catch(() => undefined);
          void fetchAttempts(userId).catch(() => undefined);
          void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
        }
        void useNotesStore.getState().loadNotes().catch(() => undefined);
        void loadSets({ force: true }).catch(() => undefined);
        const rows = await getMyActiveCourses().catch(() => [] as UserCourse[]);
        if (!cancelled) setCourses(rows);
      })();
      return () => {
        cancelled = true;
      };
    }, [userId, fetchTests, fetchAttempts, loadSets])
  );

  const openSet = (setId: string, title?: string) => {
    useStudySetStore.getState().touchOpened(setId);
    navigation.navigate('CourseRoom', {
      studySetId: setId,
      courseLabel: title,
    });
  };

  const submitCreate = async () => {
    const title = normalizeStudySetTitle(createTitle);
    if (!isValidStudySetTitle(title)) {
      showToast(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer.`, 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await createSet({ title, courseId: createCourseId });
      setCreateOpen(false);
      setCreateTitle('');
      setCreateCourseId(null);
      showToast('Study set created.', 'success');
      openSet(created.id, created.title);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create that study set.', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1 w-full"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: tabBarClearance,
        }}
      >
        <ScreenHeader
          title="Study"
          subtitle="A study set houses every activity you start — notes, quizzes, cards, lectures and games."
        />

        <Card className="mb-3">
          <View className="flex-row items-center justify-between mb-1">
            <T.Caption tone="secondary">Your study sets</T.Caption>
            <Button size="sm" onPress={() => setCreateOpen(true)}>
              New study set
            </Button>
          </View>
          {sets.length === 0 ? (
            <T.Body tone="secondary">
              Name a set to start. You can file it under a course later if you want.
            </T.Body>
          ) : (
            sets.map((set, index) => {
              const filed = set.courseId
                ? courses.find((row) => row.course.id === set.courseId)
                : null;
              return (
                <View
                  key={set.id}
                  className={index > 0 ? 'border-t border-lantern-border' : undefined}
                >
                  <FeatureRow
                    feature="notes"
                    icon="albums"
                    title={studySetLabel(set)}
                    subtitle={`${filed ? courseWorkspaceLabel(filed.course) : 'Standalone'} · ${formatCourseMaterialCounts({
                      notes: materialsForStudySet(notes, set.id).filter(
                        (note) => !isCalendarNote(note)
                      ).length,
                      decks: materialsForStudySet(decks, set.id).length,
                    })}`}
                    onPress={() => openSet(set.id, set.title)}
                  />
                </View>
              );
            })
          )}
        </Card>

        <Card>
          <FeatureRow
            feature="notes"
            icon="albums"
            title="All materials"
            subtitle="Unfiled notes and decks stay in Library"
            onPress={() => navigation.navigate('Library', { tab: 'notes' })}
          />
        </Card>
      </ScrollView>

      <Modal
        visible={createOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setCreateOpen(false)}
        >
          <Pressable
            className="bg-lantern-background rounded-t-2xl px-4 pt-4 pb-8"
            onPress={(event) => event.stopPropagation()}
          >
            <T.Heading className="mb-1">New study set</T.Heading>
            <T.Caption tone="secondary" className="mb-3">
              Name it first. Filing under a course is optional.
            </T.Caption>
            <TextInput
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="e.g. Midterm review"
              maxLength={STUDY_SET_TITLE_MAX}
              autoFocus
              className="min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-lantern-text mb-3"
            />
            <T.Caption tone="secondary" className="mb-2">
              Course (optional)
            </T.Caption>
            <View className="flex-row flex-wrap gap-2 mb-4">
              <Pressable
                onPress={() => setCreateCourseId(null)}
                className={`px-3 py-2 rounded-full border ${
                  createCourseId === null
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <T.Caption>Standalone</T.Caption>
              </Pressable>
              {courses.map((row) => (
                <Pressable
                  key={row.course.id}
                  onPress={() => setCreateCourseId(row.course.id)}
                  className={`px-3 py-2 rounded-full border ${
                    createCourseId === row.course.id
                      ? 'border-lantern-primary bg-lantern-primary-background'
                      : 'border-lantern-border'
                  }`}
                >
                  <T.Caption>{courseWorkspaceLabel(row.course)}</T.Caption>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-2">
              <Button variant="ghost" onPress={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onPress={() => void submitCreate()}
                disabled={!normalizeStudySetTitle(createTitle) || creating}
                loading={creating}
              >
                Create set
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

export default StudyHubScreen;
