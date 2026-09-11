import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { courseWorkspaceLabel } from '@lantern/shared';
import type { UserCourse } from '@lantern/shared/types';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { Card, FeatureRow, FeatureTile, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { getMyActiveCourses } from '../../services/academic';
import { navigate as navigateRootStack } from '../../navigation/navigationRef';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * The Study hub is the list of course workspaces, plus Import.
 *
 * Individual tools (notes, cards, tests, record) live inside a course room.
 * Unfiled work is still reachable through All materials → Library.
 */
export function StudyHubScreen({ navigation }: Props) {
  const { decks } = useFlashcardStore();
  const userId = useAuthStore((s) => s.user?.id);
  const fetchTests = useTestStore((s) => s.fetchTests);
  const fetchAttempts = useTestStore((s) => s.fetchAttempts);
  const showToast = useToastStore((s) => s.showToast);
  const tabBarClearance = useTabBarClearance(16);
  const [importOpen, setImportOpen] = useState(false);
  const [courses, setCourses] = useState<UserCourse[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void fetchTests(userId).catch(() => undefined);
        void fetchAttempts(userId).catch(() => undefined);
      }
      void getMyActiveCourses().then(setCourses).catch(() => undefined);
    }, [userId, fetchTests, fetchAttempts])
  );

  const dueCardsCount = useMemo(
    () => decks.reduce((sum, d) => sum + (d.due_count || 0), 0),
    [decks]
  );

  const startDueReview = () => {
    const best = [...decks].sort((a, b) => (b.due_count || 0) - (a.due_count || 0))[0];
    if (best) {
      navigation.navigate('DeckDetail', { deckId: best.id, deckName: best.name });
    } else {
      navigation.navigate('Library', { tab: 'flashcards' });
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
        <ScreenHeader title="Study" subtitle="Open a course, or import material" />

        {dueCardsCount > 0 ? (
          <Card className="mb-3">
            <FeatureRow
              feature="flashcards"
              icon="layers"
              title={`${dueCardsCount} card${dueCardsCount === 1 ? '' : 's'} ready`}
              subtitle="Spaced repetition"
              onPress={startDueReview}
            />
          </Card>
        ) : null}

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-1">
            Your courses
          </T.Caption>
          {courses.length === 0 ? (
            <FeatureRow
              feature="notes"
              icon="school"
              title="Add a course"
              subtitle="Academic settings — then open it as a workspace"
              onPress={() => navigateRootStack('AcademicSettings')}
            />
          ) : (
            courses.map((row, index) => (
              <View
                key={row.course.id}
                className={index > 0 ? 'border-t border-lantern-border' : undefined}
              >
                <FeatureRow
                  feature="notes"
                  icon="library"
                  title={courseWorkspaceLabel(row.course)}
                  subtitle="Notes, cards, tests and lectures"
                  onPress={() =>
                    navigation.navigate('CourseRoom', {
                      courseId: row.course.id,
                      courseLabel: courseWorkspaceLabel(row.course),
                    })
                  }
                />
              </View>
            ))
          )}
        </Card>

        <View className="flex-row mb-3">
          <FeatureTile
            feature="notes"
            icon="cloud-upload"
            title="Import & study"
            subtitle="Paste or upload material and get cards and a test back"
            onPress={() => setImportOpen(true)}
            illustration="import-tray"
            testID="study-tile-import"
          />
        </View>

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

      <ImportAndStudyModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onOpenNote={(noteId) => {
          setImportOpen(false);
          navigation.navigate('NoteEditor', { noteId });
        }}
        onComplete={() => {
          showToast('Imported — generating study materials.', 'success');
        }}
      />
    </SafeAreaView>
  );
}

export default StudyHubScreen;
