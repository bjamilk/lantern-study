import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFocusEffect } from '@react-navigation/native';
import { useTestStore } from '../../stores/testStore';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { Card, FeatureRow, FeatureTile, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { recorderDoorPrompt, shouldCreateLectureNote } from './recorderDoor';
import { confirmSheet } from '../../stores/confirmStore';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * The Study hub is a set of DOORS, not a dashboard.
 *
 * Spec §5.7: five feature tiles, each in its own hue, each promising what it
 * does rather than naming a noun — Library (notes teal), Flashcards (lime,
 * carrying the due count), Tests (sky, carrying the saved count), Record
 * (recording fuchsia) and the creation door, Import & study (teal).
 *
 * The old hub painted every tile and every chevron in `featureAccents.groups`
 * emerald, which made hue mean "this is a tile" instead of "this is Notes".
 */
export function StudyHubScreen({ navigation }: Props) {
  const { decks } = useFlashcardStore();
  const tests = useTestStore((s) => s.tests);
  /**
   * History is part of the Tests door's honest state: a student with 34 sat
   * attempts and no SAVED test was still told "Make your first test" (device
   * pass on build 159, D9), which reads as if the results had gone.
   */
  const attempts = useTestStore((s) => s.attempts);
  const userId = useAuthStore((s) => s.user?.id);
  const fetchTests = useTestStore((s) => s.fetchTests);
  const fetchAttempts = useTestStore((s) => s.fetchAttempts);
  // The hub used to read whatever last populated the store, so a cold-opened
  // hub told a 34-attempt account "Make your first test" (build 160). Refresh
  // both piles on focus; failures fall back to the cached values.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void fetchTests(userId).catch(() => undefined);
      void fetchAttempts(userId).catch(() => undefined);
    }, [userId, fetchTests, fetchAttempts])
  );
  const createNote = useNotesStore((s) => s.createNote);
  const showToast = useToastStore((s) => s.showToast);
  const tabBarClearance = useTabBarClearance(16);
  const [importOpen, setImportOpen] = useState(false);
  const [openingRecorder, setOpeningRecorder] = useState(false);

  const dueCardsCount = useMemo(
    () => decks.reduce((sum, d) => sum + (d.due_count || 0), 0),
    [decks]
  );

  /**
   * Saved tests and sat attempts are different piles, and the door has to
   * acknowledge whichever exists. Only a student with neither is starting
   * from nothing.
   */
  const testsSubtitle = useMemo(() => {
    const saved = tests.length;
    const sat = attempts.length;
    if (saved > 0 && sat > 0) return `${saved} saved · ${sat} in history`;
    if (saved > 0 || sat > 0) return 'Practise and review';
    return 'Make your first test';
  }, [tests.length, attempts.length]);

  const startDueReview = () => {
    const best = [...decks].sort((a, b) => (b.due_count || 0) - (a.due_count || 0))[0];
    if (best) {
      navigation.navigate('DeckDetail', { deckId: best.id, deckName: best.name });
    } else {
      navigation.navigate('FlashcardsList');
    }
  };

  /**
   * Recording has no screen of its own: a lecture is recorded INTO a note, and
   * the recorder lives in the note editor. So the door asks, then creates the
   * note and lands on the editor with the mic ALREADY RUNNING — the note that
   * appears in the library is one with a recording in it, never an empty
   * "Lecture — 6 Sep" left by a stray tap.
   */
  const openRecorder = async () => {
    if (openingRecorder) return;
    // Ask before writing anything: the door used to leave an empty
    // "Lecture — 6 Sep" in the library on every stray tap (D4). The flag is
    // held across the prompt so a second tap cannot stack two of them.
    setOpeningRecorder(true);
    try {
      const prompt = recorderDoorPrompt();
      const confirmed = await confirmSheet({
        title: prompt.title,
        message: prompt.message,
        confirmLabel: prompt.confirmLabel,
        cancelLabel: prompt.cancelLabel,
      });
      if (!shouldCreateLectureNote(confirmed)) return;
      const note = await createNote({ title: prompt.noteTitle, body: '' });
      navigation.navigate('NoteEditor', { noteId: note.id, startRecording: true });
    } catch {
      showToast('Could not start a lecture note. Check your connection and try again.', 'error');
    } finally {
      setOpeningRecorder(false);
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
        <ScreenHeader title="Study" subtitle="Pick a door and start" />

        <View className="flex-row gap-3 mb-3">
          <FeatureTile
            feature="notes"
            icon="document-text"
            title="Library"
            subtitle="Turn slides into cards"
            onPress={() => navigation.navigate('Library', { tab: 'notes' })}
            testID="study-tile-library"
          />
          <FeatureTile
            feature="flashcards"
            icon="layers"
            title="Flashcards"
            subtitle={dueCardsCount > 0 ? 'Review what is due' : 'Nothing due right now'}
            count={dueCardsCount}
            countLabel={`${dueCardsCount} due`}
            onPress={startDueReview}
            testID="study-tile-flashcards"
          />
        </View>

        <View className="flex-row gap-3 mb-3">
          <FeatureTile
            feature="tests"
            icon="clipboard"
            title="Tests"
            subtitle={testsSubtitle}
            count={tests.length}
            countLabel={`${tests.length} saved`}
            onPress={() => navigation.navigate('TestsList')}
            testID="study-tile-tests"
          />
          <FeatureTile
            feature="recording"
            icon="mic"
            title="Record"
            subtitle="Capture a lecture as notes"
            onPress={() => void openRecorder()}
            testID="study-tile-record"
          />
        </View>

        {/* The creation door. Full width because it is the one thing an empty
            account can do, and the only tile that opens a sheet rather than a
            screen. */}
        <View className="flex-row mb-4">
          <FeatureTile
            feature="notes"
            icon="cloud-upload"
            title="Import & study"
            subtitle="Paste or upload material and get cards and a quiz back"
            onPress={() => setImportOpen(true)}
            testID="study-tile-import"
          />
        </View>

        {decks.length > 0 ? (
          <Card>
            <T.Caption tone="secondary" className="mb-1">
              Jump back in
            </T.Caption>
            {decks.slice(0, 4).map((deck, index) => (
              <View
                key={deck.id}
                className={index > 0 ? 'border-t border-lantern-border' : undefined}
              >
                <FeatureRow
                  feature="flashcards"
                  icon="layers"
                  title={deck.name}
                  subtitle={deck.description || 'Flashcard deck'}
                  onPress={() =>
                    navigation.navigate('DeckDetail', { deckId: deck.id, deckName: deck.name })
                  }
                />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <ImportAndStudyModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onOpenNote={(noteId) => {
          setImportOpen(false);
          navigation.navigate('NoteEditor', { noteId });
        }}
      />
    </SafeAreaView>
  );
}

export default StudyHubScreen;
