import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { featureAccents } from '@lantern/shared/design';
import type { LibraryOverview } from '@lantern/shared/types';
import { NotesScreen } from '../notes/NotesScreen';
import { FlashcardsScreen } from '../flashcards/FlashcardsScreen';
import { FeatureHero } from '../../components/ui';
import { LibraryCourseTree } from '../../components/library/LibraryCourseTree';
import { LibrarySearchResults } from '../../components/library/LibrarySearchResults';
import { useUIStore, type LibraryCourseFilter, type LibraryTab } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { refreshUserData } from '../../services/dataRefresh';
import { fetchLibraryOverview } from '../../services/api';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useTheme } from '../../theme';
import { useLibrarySearch } from '../../hooks/useLibrarySearch';
import { navigate as navigateRootStack } from '../../navigation/navigationRef';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { buildLibraryTree, courseNodeLabel, UNFILED_COURSE_ID } from '../../utils/libraryArchive';

type Tab = LibraryTab;

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { tab?: Tab } };
}

const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'notes', label: 'Notes', icon: 'document-text-outline' },
  { id: 'flashcards', label: 'Flashcards', icon: 'layers-outline' },
];

export function LibraryScreen({ navigation, route }: Props) {
  const tab = useUIStore(s => s.libraryTab);
  const setLibraryTab = useUIStore(s => s.setLibraryTab);
  const courseFilter = useUIStore(s => s.libraryCourseFilter);
  const setCourseFilter = useUIStore(s => s.setLibraryCourseFilter);
  const userId = useAuthStore(s => s.user?.id);
  const decks = useFlashcardStore(s => s.decks);
  const notes = useNotesStore(s => s.notes);
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(16);
  const dueCardsCount = decks.reduce((sum, d) => sum + (d.due_count || 0), 0);

  // ---- Library archive tree (GET /library/overview) ----
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const tree = useMemo(() => (overview ? buildLibraryTree(overview) : null), [overview]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setOverviewLoading(true);
    try {
      const data = await fetchLibraryOverview();
      setOverview(data);
      setOverviewError(null);
    } catch (e: unknown) {
      setOverviewError(e instanceof Error ? e.message : 'Could not load courses');
    } finally {
      setOverviewLoading(false);
    }
  }, [userId]);

  // Counts change whenever a note/deck/test is filed elsewhere, so refresh on
  // every focus (one cheap round trip); keep the previous tree while loading.
  useFocusEffect(
    useCallback(() => {
      void loadOverview();
    }, [loadOverview, overviewAttempt])
  );

  // ---- Search (GET /library/search) ----
  const [query, setQuery] = useState('');
  const search = useLibrarySearch({ query, courseId: courseFilter?.id ?? null });

  /** Label for a course id: selected filter first, then the loaded tree. */
  const labelForCourse = useCallback(
    (courseId: string | null): string | undefined => {
      if (!courseId) return 'Unfiled';
      if (courseFilter?.id === courseId) return courseFilter.label;
      if (!tree) return undefined;
      for (const node of tree.thisSemester) if (node.course.id === courseId) return courseNodeLabel(node);
      for (const year of tree.pastSemesters) {
        for (const node of year.courses) if (node.course.id === courseId) return courseNodeLabel(node);
      }
      return undefined;
    },
    [courseFilter, tree]
  );

  const openTests = useCallback(
    (filter: LibraryCourseFilter) => {
      navigation.navigate('TestsList', { tab: 'history', courseId: filter.id, courseLabel: filter.label });
    },
    [navigation]
  );

  const openOffline = useCallback((filter: LibraryCourseFilter | null) => {
    // Offline is a root-stack modal, so go through the container ref rather
    // than this (Study-stack) navigator.
    navigateRootStack('Offline', filter ? { courseId: filter.id, courseLabel: filter.label } : undefined);
  }, []);

  const openBundle = useCallback(
    (_bundleId: string, bundleCourseId: string | null) => {
      const id = bundleCourseId ?? UNFILED_COURSE_ID;
      openOffline({ id, label: labelForCourse(bundleCourseId) ?? 'Course' });
    },
    [openOffline, labelForCourse]
  );

  useEffect(() => {
    const paramTab = route?.params?.tab;
    if (paramTab === 'notes' || paramTab === 'flashcards') {
      setLibraryTab(paramTab);
    }
  }, [route?.params?.tab, setLibraryTab]);

  useFocusEffect(
    React.useCallback(() => {
      const paramTab = route?.params?.tab;
      if (paramTab === 'notes' || paramTab === 'flashcards') {
        setLibraryTab(paramTab);
      }
    }, [route?.params?.tab, setLibraryTab])
  );

  // Decks and their due counts are only fetched at login bootstrap, so without
  // this a card reviewed on the web still reads as due here (and a deck created
  // elsewhere never appears) until the app is force-quit. Throttled internally.
  useFocusEffect(
    React.useCallback(() => {
      void refreshUserData(userId, { only: ['flashcards'] });
    }, [userId])
  );

  // Getting-started checklist: visiting the Library counts as "open library".
  useFocusEffect(
    React.useCallback(() => {
      const store = useFeatureTipStore.getState();
      if (!store.hydrated) {
        void store.hydrate().then(() => {
          useFeatureTipStore.getState().markChecklist('openLibrary');
        });
      } else {
        store.markChecklist('openLibrary');
      }
    }, [])
  );

  const heroNotes = tree ? tree.totals.notes : notes.length;
  const heroDecks = tree ? tree.totals.decks : decks.length;

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 bg-lantern-background">
        <FeatureHero
          title="Library"
          subtitle="Your archive: notes, decks, tests and offline packs, filed by course"
          accentColor={featureAccents.library}
          right={<Ionicons name="library-outline" size={24} color={featureAccents.library} />}
          className="mb-2"
        >
          <View className="flex-row flex-wrap gap-2">
            <View className="px-2.5 py-1 rounded-full bg-lantern-primary-background">
              <Text className="text-xs font-medium text-lantern-primary">{heroNotes} {heroNotes === 1 ? 'note' : 'notes'}</Text>
            </View>
            <View className="px-2.5 py-1 rounded-full bg-lantern-accent-background">
              <Text className="text-xs font-medium text-lantern-accent">{heroDecks} {heroDecks === 1 ? 'deck' : 'decks'}</Text>
            </View>
            {tree && tree.totals.tests > 0 ? (
              <View className="px-2.5 py-1 rounded-full bg-lantern-background-secondary">
                <Text className="text-xs font-medium text-lantern-text-secondary">{tree.totals.tests} {tree.totals.tests === 1 ? 'test' : 'tests'}</Text>
              </View>
            ) : null}
            {dueCardsCount > 0 ? (
              <View className="px-2.5 py-1 rounded-full bg-lantern-error/10">
                <Text className="text-xs font-medium text-lantern-error">{dueCardsCount} due</Text>
              </View>
            ) : null}
          </View>
        </FeatureHero>

        <LibraryCourseTree
          tree={tree}
          loading={overviewLoading}
          error={overviewError}
          selectedCourseId={courseFilter?.id ?? null}
          onSelectCourse={setCourseFilter}
          onOpenTests={openTests}
          onOpenOffline={openOffline}
          onRetry={() => setOverviewAttempt(a => a + 1)}
          onManageCourses={() => navigateRootStack('AcademicSettings')}
        />

        <View className="mb-2 flex-row items-center gap-2 px-3 py-1.5 rounded-xl border border-lantern-border bg-lantern-surface min-h-[44px]">
          <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={courseFilter ? `Search in ${courseFilter.label}…` : 'Search notes, decks, cards, bundles…'}
            placeholderTextColor={colors.inputPlaceholder}
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 text-sm text-lantern-text py-1"
            accessibilityLabel="Search library"
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        {courseFilter ? (
          <View className="mb-2 flex-row items-center gap-2">
            <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background">
              <Ionicons name="school-outline" size={14} color={colors.primary} />
              <Text className="text-xs font-semibold text-lantern-primary" numberOfLines={1}>
                {courseFilter.label}
              </Text>
              <Pressable
                onPress={() => setCourseFilter(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Clear course filter ${courseFilter.label}`}
              >
                <Ionicons name="close-circle" size={16} color={colors.primary} />
              </Pressable>
            </View>
            <Text className="text-[11px] text-lantern-text-secondary flex-1" numberOfLines={1}>
              Notes and Flashcards below are filtered
            </Text>
          </View>
        ) : null}

        {!search.active ? (
          <View className="flex-row gap-1 border-b border-lantern-border mb-0">
            {tabs.map(({ id, label, icon }) => {
              const active = tab === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setLibraryTab(id)}
                  className={`flex-row items-center gap-2 px-4 py-2.5 rounded-t-xl border border-b-0 min-h-[44px] ${
                    active
                      ? 'bg-lantern-surface border-lantern-border'
                      : 'border-transparent'
                  }`}
                  style={active ? { borderTopWidth: 3, borderTopColor: featureAccents.library } : undefined}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={icon}
                    size={16}
                    color={active ? featureAccents.library : colors.textTertiary}
                  />
                  <Text
                    className={`text-sm font-medium ${
                      active ? 'text-lantern-primary' : 'text-lantern-text-secondary'
                    }`}
                    style={active ? { color: featureAccents.library } : undefined}
                  >
                    {label}
                  </Text>
                  {id === 'flashcards' && dueCardsCount > 0 ? (
                    <View className="bg-lantern-error min-w-[18px] h-[18px] px-1 rounded-full items-center justify-center">
                      <Text className="text-[10px] font-bold text-white">
                        {dueCardsCount > 99 ? '99+' : dueCardsCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      <View className="flex-1 min-h-0">
        {search.active ? (
          <LibrarySearchResults
            results={search.results}
            searching={search.searching}
            error={search.error}
            query={query}
            courseLabel={courseFilter?.label ?? null}
            bottomPadding={tabBarClearance}
            onOpenNote={noteId => navigation.navigate('NoteEditor', { noteId })}
            onOpenDeck={(deckId, deckName) => navigation.navigate('DeckDetail', { deckId, deckName })}
            onOpenBundle={openBundle}
          />
        ) : tab === 'notes' ? (
          <NotesScreen navigation={navigation} embedded />
        ) : (
          <FlashcardsScreen navigation={navigation} embedded />
        )}
      </View>
    </SafeAreaView>
  );
}

export default LibraryScreen;
