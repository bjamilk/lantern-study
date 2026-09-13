/**
 * Everything filed in ONE set — cards, tests, lectures, notes.
 *
 * The room's Cards and Test doors used to open the global library and the
 * global tests list: a student inside "Pharmacology" tapped Cards and got every
 * deck they own (phone walk defect 14). These grids are set-scoped, and they
 * use the same filing rules the room does, so what the room counts and what
 * this screen lists can never disagree.
 *
 * Folders here are folders of SETS, as on web. The row used to be three chips
 * that threw the student out to the set picker; now it navigates in place —
 * "All" is this set's shelf, a folder tile opens that folder's sets, and Back
 * returns to All instead of leaving the screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  adoptSegmentRequest,
  initialSegment,
  readSegmentRequest,
} from '../../navigation/segmentParamSync';
import { useFocusEffect } from '@react-navigation/native';
import {
  isLectureNote,
  isCalendarNote,
  isEssayNote,
  isLessonNote,
  isRecapNote,
  materialsForStudySet,
  notePreviewText,
  studySetLabel,
  testsFiledInStudySet,
} from '@lantern/shared';
import { pluralize } from '@lantern/shared/utils/plural';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, Card, FeatureDisc, ScreenHeader, T } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { useAuthStore } from '../../stores/authStore';
import { useSetRoomUiStore } from '../../stores/setRoomUiStore';

type Props = NativeStackScreenProps<StudyStackParamList, 'StudySetLibrary'>;

export type ArtifactKind = 'cards' | 'tests' | 'lectures' | 'notes';

/** Route params are unknown shapes until proven otherwise. */
function isArtifactKind(value: unknown): value is ArtifactKind {
  return value === 'cards' || value === 'tests' || value === 'lectures' || value === 'notes';
}

const TABS: Array<{ id: ArtifactKind; label: string }> = [
  { id: 'cards', label: 'Cards' },
  { id: 'tests', label: 'Tests' },
  { id: 'lectures', label: 'Lectures' },
  { id: 'notes', label: 'Notes' },
];

interface GridItem {
  id: string;
  title: string;
  meta?: string;
  preview?: string;
  feature: 'flashcards' | 'tests' | 'recording' | 'notes';
  icon: 'layers' | 'clipboard' | 'mic' | 'document-text';
}

export function StudySetArtifactLibraryScreen({ navigation, route }: Props) {
  const { studySetId, courseId, courseLabel } = route.params;
  // Read whole, not destructured: the params object's identity is the ticket
  // that tells two presses of the same door apart (segmentParamSync.ts).
  const routeParams = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const { width: screenWidth } = useWindowDimensions();
  // The set row's Flashcards and Tests doors are THIS screen with a different
  // `kind`, so pressing Tests from the Cards list only merges params into the
  // focused route — `useState(kind ?? 'cards')` never heard it (build 204). The
  // param is a mirror of the visible tab, adopted and published both ways
  // (navigation/segmentParamSync.ts).
  const [tab, setTab] = useState<ArtifactKind>(() =>
    initialSegment(routeParams.kind, isArtifactKind, 'cards')
  );
  // The mount's params are an ask the seed above already answered.
  const adoptedTicket = useRef<unknown>(routeParams);
  // The row's pill reads the STORE, so the shelf on screen is published there —
  // and NEVER back into the params. Publishing into the params is what
  // crash-looped build 205: the publish effect ran in the same commit as the
  // adopt effect, off the same pre-adopt snapshot, and reverted it for ever
  // (navigation/segmentParamSync.ts).
  useEffect(() => {
    useSetRoomUiStore.getState().setKind(studySetId, tab);
  }, [studySetId, tab]);
  useEffect(() => {
    const adopted = adoptSegmentRequest({
      request: readSegmentRequest(routeParams, 'kind', isArtifactKind),
      lastTicket: adoptedTicket.current,
      current: tab,
    });
    if (!adopted) return;
    adoptedTicket.current = adopted.ticket;
    if (adopted.alreadyShown) return;
    setTab(adopted.segment);
  }, [routeParams, tab]);

  const userId = useAuthStore((s) => s.user?.id);
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);
  const tests = useTestStore((s) => s.tests);
  const loadNote = useNotesStore((s) => s.loadNote);
  const studySet = useStudySetStore((s) => s.resolveSet(studySetId));
  const folders = useStudySetStore((s) => s.folders);
  const sets = useStudySetStore((s) => s.sets);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const loadSets = useStudySetStore((s) => s.loadSets);

  /** null is "All" — this set's own shelf, which is what the screen is for. */
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void useNotesStore.getState().loadNotes().catch(() => undefined);
      void loadFolders().catch(() => undefined);
      void loadSets().catch(() => undefined);
      if (userId) {
        void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
        void useTestStore.getState().fetchTests(userId).catch(() => undefined);
      }
    }, [userId, loadFolders, loadSets])
  );

  // Back inside a folder returns to All rather than leaving the screen: having
  // just navigated one level in, being thrown two levels out is not back.
  useFocusEffect(
    useCallback(() => {
      if (!openFolderId) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setOpenFolderId(null);
        return true;
      });
      return () => subscription.remove();
    }, [openFolderId])
  );

  const openFolder = useMemo(
    () => folders.find((row) => row.id === openFolderId) ?? null,
    [folders, openFolderId]
  );
  const folderSets = useMemo(
    () => (openFolderId ? sets.filter((row) => row.folderId === openFolderId) : []),
    [sets, openFolderId]
  );

  const label = studySetLabel(studySet || { title: courseLabel || 'Study set' });

  const setNotes = useMemo(() => materialsForStudySet(notes, studySetId), [notes, studySetId]);
  const setDecks = useMemo(() => materialsForStudySet(decks, studySetId), [decks, studySetId]);
  const lectures = useMemo(() => setNotes.filter(isLectureNote), [setNotes]);
  const plainNotes = useMemo(
    () =>
      setNotes.filter(
        (note) =>
          !isCalendarNote(note) &&
          !isLectureNote(note) &&
          !isLessonNote(note) &&
          !isRecapNote(note) &&
          !isEssayNote(note)
      ),
    [setNotes]
  );
  const setTests = useMemo(() => {
    const noteIds = new Set(setNotes.map((row) => row.id));
    const deckIds = new Set(setDecks.map((row) => row.id));
    const rows = tests.map((test) => ({
      id: test.id,
      courseId: test.courseId,
      studySetId: undefined,
      sourceNoteId: test.sourceNoteId,
      sourceDeckId: undefined,
      deckId: test.deckId,
    }));
    return testsFiledInStudySet(rows, studySetId, noteIds, deckIds);
  }, [tests, setNotes, setDecks, studySetId]);

  const items: GridItem[] = useMemo(() => {
    if (tab === 'cards') {
      return setDecks.map((deck) => ({
        id: deck.id,
        title: deck.name || 'Deck',
        meta:
          typeof deck.card_count === 'number'
            ? pluralize(deck.card_count, 'card')
            : undefined,
        feature: 'flashcards' as const,
        icon: 'layers' as const,
      }));
    }
    if (tab === 'tests') {
      return setTests.map((row) => {
        const test = tests.find((t) => t.id === row.id);
        return {
          id: row.id,
          title: test?.name || 'Test',
          meta: test ? pluralize(test.questionCount, 'question') : undefined,
          feature: 'tests' as const,
          icon: 'clipboard' as const,
        };
      });
    }
    if (tab === 'lectures') {
      return lectures.map((note) => ({
        id: note.id,
        title: note.title || 'Lecture',
        preview: notePreviewText(note.body),
        feature: 'recording' as const,
        icon: 'mic' as const,
      }));
    }
    return plainNotes.map((note) => ({
      id: note.id,
      title: note.title || 'Untitled note',
      preview: notePreviewText(note.body),
      feature: 'notes' as const,
      icon: 'document-text' as const,
    }));
  }, [tab, setDecks, setTests, tests, lectures, plainNotes]);

  const openItem = (id: string) => {
    if (tab === 'cards') {
      const deck = setDecks.find((row) => row.id === id);
      navigation.navigate('DeckDetail', { deckId: id, deckName: deck?.name ?? 'Deck' });
      return;
    }
    if (tab === 'tests') {
      navigation.navigate('TestsList', { courseId, courseLabel: label });
      return;
    }
    if (tab === 'lectures') {
      void loadNote(id);
      navigation.navigate('LectureStudio', { courseId, courseLabel: label, noteId: id, studySetId });
      return;
    }
    void loadNote(id);
    navigation.navigate('NotesStudio', { courseId, courseLabel: label, noteId: id, studySetId });
  };

  const emptyLine =
    tab === 'cards'
      ? 'No decks in this set yet. Turn a note into cards, or import an export.'
      : tab === 'tests'
        ? 'No tests in this set yet. Turn a note into a practice test.'
        : tab === 'lectures'
          ? 'No lectures recorded in this set yet.'
          : 'No notes in this set yet. Add materials to start.';

  // Two up, from the measured screen rather than a percentage, so the cards
  // land on one gutter instead of whatever the class happened to be.
  const gutter = 12;
  const cardWidth = Math.floor((screenWidth - 32 - gutter) / 2);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16, paddingTop: 8 }}
      >
        <ScreenHeader
          title={openFolder ? openFolder.title : label}
          subtitle={openFolder ? 'Sets in this folder' : 'Filed in this set'}
          onBack={() => (openFolder ? setOpenFolderId(null) : navigation.goBack())}
        />

        {folders.length > 0 ? (
          <View className="flex-row flex-wrap gap-2 mb-3">
            <Pressable
              onPress={() => setOpenFolderId(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: openFolderId === null }}
              accessibilityLabel={`All. ${label}'s own materials`}
              className={`px-3 py-2 rounded-full border ${
                openFolderId === null
                  ? 'border-lantern-primary bg-lantern-primary-background'
                  : 'border-lantern-border'
              }`}
            >
              <T.Caption>All</T.Caption>
            </Pressable>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                onPress={() => setOpenFolderId(folder.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: openFolderId === folder.id }}
                accessibilityLabel={`${folder.title} folder`}
                className={`px-3 py-2 rounded-full border flex-row items-center gap-1.5 ${
                  openFolderId === folder.id
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <AppIcon name="folder" size={14} />
                <T.Caption>{folder.title}</T.Caption>
              </Pressable>
            ))}
          </View>
        ) : null}

        {openFolder ? (
          folderSets.length === 0 ? (
            <Card className="mb-3">
              <T.Body tone="secondary">No sets in this folder yet.</T.Body>
            </Card>
          ) : (
            <View className="flex-row flex-wrap" style={{ gap: gutter }}>
              {folderSets.map((row) => (
                <Pressable
                  key={row.id}
                  // push, not navigate: the folder's set opens its OWN shelf on
                  // top, so Back walks back to this folder.
                  onPress={() =>
                    navigation.push('StudySetLibrary', {
                      studySetId: row.id,
                      courseId: row.courseId ?? undefined,
                      courseLabel: row.title,
                      kind: 'cards',
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${studySetLabel(row)}. Opens this set's materials`}
                  style={{ width: cardWidth }}
                  className="rounded-2xl border border-lantern-border overflow-hidden"
                >
                  <View className="min-h-[84px] px-3 py-3 bg-lantern-background-secondary">
                    <FeatureDisc feature="notes" icon="document-text" size={40} />
                  </View>
                  <View className="px-3 py-2">
                    <T.Body numberOfLines={1}>{studySetLabel(row)}</T.Body>
                    {row.id === studySetId ? (
                      <T.Caption tone="tertiary">You are here</T.Caption>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )
        ) : (
          <>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {TABS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setTab(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === item.id }}
              className={`px-3 py-2 rounded-full border ${
                tab === item.id
                  ? 'border-lantern-primary bg-lantern-primary-background'
                  : 'border-lantern-border'
              }`}
            >
              <T.Caption>{item.label}</T.Caption>
            </Pressable>
          ))}
        </View>

        {items.length === 0 ? (
          <Card className="mb-3">
            <T.Body tone="secondary">{emptyLine}</T.Body>
            <Button
              size="sm"
              className="mt-3"
              onPress={() =>
                navigation.navigate('StudySetUpload', { studySetId, courseId, courseLabel: label })
              }
            >
              Add materials
            </Button>
          </Card>
        ) : (
          <View className="flex-row flex-wrap" style={{ gap: gutter }}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => openItem(item.id)}
                accessibilityRole="button"
                accessibilityLabel={[item.title, item.meta].filter(Boolean).join('. ')}
                style={{ width: cardWidth }}
                className="rounded-2xl border border-lantern-border overflow-hidden"
              >
                <View className="min-h-[84px] px-3 py-3 bg-lantern-background-secondary">
                  {item.preview ? (
                    <T.Caption tone="secondary" numberOfLines={4}>
                      {item.preview}
                    </T.Caption>
                  ) : (
                    <FeatureDisc feature={item.feature} icon={item.icon} size={40} />
                  )}
                </View>
                <View className="px-3 py-2">
                  <T.Body numberOfLines={1}>{item.title}</T.Body>
                  {item.meta ? (
                    <T.Caption tone="tertiary" numberOfLines={1}>
                      {item.meta}
                    </T.Caption>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default StudySetArtifactLibraryScreen;
