import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, Text, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { featureAccents } from '@lantern/shared/design';
import type { LibraryOverview } from '@lantern/shared/types';
import { NotesScreen } from '../notes/NotesScreen';
import { FlashcardsScreen } from '../flashcards/FlashcardsScreen';
import { LibraryCourseTree, type LibraryTopicFilter } from '../../components/library/LibraryCourseTree';
import { LibrarySearchResults } from '../../components/library/LibrarySearchResults';
import { ManageOutlineSheet } from '../../components/library/ManageOutlineSheet';
import { useUIStore, type LibraryCourseFilter, type LibraryTab } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { refreshUserData } from '../../services/dataRefresh';
import { fetchLibraryOverview } from '../../services/api';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { serifDisplayStyle, useTheme } from '../../theme';
import { useLibrarySearch } from '../../hooks/useLibrarySearch';
import { navigate as navigateRootStack } from '../../navigation/navigationRef';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { Screen } from '../../components/layout';
import { StudyWorkspaceBar } from '../study/StudyWorkspaceBar';
import { useStudySetStore } from '../../stores/studySetStore';
import {
  buildLibraryTree,
  courseNodeLabel,
  isLibrarySearchable,
  LIBRARY_SEARCH_MIN_CHARS,
  UNFILED_COURSE_ID,
} from '../../utils/libraryArchive';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon';
import { ClassOfficialMaterials } from '../../components/classes/ClassOfficialMaterials';
import { readCachedOverview, writeCachedOverview } from './libraryOverviewCache';

import { toTab } from '../../navigation/nestedTab';

type Tab = LibraryTab;

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
  };
  route?: {
    params?: {
      tab?: Tab;
      /** Deep link from the readiness card: open this course's outline editor. */
      manageOutlineCourseId?: string;
      manageOutlineCourseLabel?: string;
    };
  };
}

const tabs: { id: Tab; label: string; icon: AppIconName }[] = [
  { id: 'notes', label: 'Notes', icon: 'document-text' },
  { id: 'flashcards', label: 'Flashcards', icon: 'layers' },
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
  const [overviewError, setOverviewError] = useState<unknown>(null);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  // True while the tree on screen came from the cache rather than this load —
  // the courses are real, they are just not freshly confirmed.
  const [overviewFromCache, setOverviewFromCache] = useState(false);
  // Course whose shared outline is being managed (rename/reorder/delete topics).
  const [manageCourse, setManageCourse] = useState<LibraryCourseFilter | null>(null);
  const tree = useMemo(() => (overview ? buildLibraryTree(overview) : null), [overview]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setOverviewLoading(true);
    try {
      const data = await fetchLibraryOverview();
      setOverview(data);
      setOverviewFromCache(false);
      setOverviewError(null);
      void writeCachedOverview(userId, data);
    } catch (e: unknown) {
      // Offline, this is the whole story: the courses this student already has
      // are on the device, so fall back to them rather than spinning at a list
      // that has not changed since the last time they opened it.
      const cached = await readCachedOverview(userId);
      if (cached) {
        setOverview(prev => prev ?? cached.overview);
        setOverviewFromCache(true);
      }
      setOverviewError(e ?? new Error('Could not load courses'));
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

  // ---- Topic filter (Phase 1 · A), the level below the course ----
  // The topic rides on the course filter itself, so the pair cannot drift: the
  // Notes and Flashcards tabs set the course filter too, and replacing it
  // replaces the topic with it rather than orphaning one.
  const activeTopic =
    courseFilter?.topicId
      ? { id: courseFilter.topicId, label: courseFilter.topicLabel ?? 'Topic', courseId: courseFilter.id }
      : null;

  const selectCourse = useCallback(
    (filter: LibraryCourseFilter | null) => {
      setCourseFilter(filter);
    },
    [setCourseFilter]
  );

  const selectTopic = useCallback(
    (course: LibraryCourseFilter, topic: LibraryTopicFilter | null) => {
      setCourseFilter(
        topic ? { ...course, topicId: topic.id, topicLabel: topic.label } : { ...course }
      );
    },
    [setCourseFilter]
  );

  // ---- Search ----
  const [query, setQuery] = useState('');
  /**
   * Whether `GET /library/search` has replaced the open tab.
   *
   * Typing no longer does this on its own: the server search needs the network
   * and two characters, and it knows nothing about the panel's folder,
   * Mine/Shared or Active/Archived selection — so those controls sat on screen
   * looking applied while the results ignored them. Typing now narrows the
   * panel in place (`listQuery` below), which is instant, works offline and
   * honours everything visible; this is the deliberate step out to decks, cards
   * and offline bundles. Web behaves the same way.
   */
  const [searchEverything, setSearchEverything] = useState(false);
  const search = useLibrarySearch({
    // Only the deliberate search hits the network; the panel filter is local.
    query: searchEverything ? query : '',
    courseId: courseFilter?.id ?? null,
    topicId: activeTopic?.id ?? null,
  });
  const trimmedQuery = query.trim();
  const canSearchEverything = isLibrarySearchable(query);
  useEffect(() => {
    if (!canSearchEverything) setSearchEverything(false);
  }, [canSearchEverything]);

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
      // The tests link hangs off the course row, so carry the live topic when it
      // belongs to that course — otherwise History would silently widen back to
      // the whole course the student had just narrowed.
      const topic = filter.topicId ?? (courseFilter?.id === filter.id ? courseFilter.topicId : null);
      const topicLabel = filter.topicLabel ?? (courseFilter?.id === filter.id ? courseFilter.topicLabel : undefined);
      navigation.navigate('TestsList', {
        tab: 'history',
        courseId: filter.id,
        courseLabel: filter.label,
        topicId: topic ?? null,
        topicLabel,
      });
    },
    [navigation, courseFilter]
  );

  const openOffline = useCallback(
    (filter: LibraryCourseFilter | null) => {
      // Offline is a root-stack modal, so go through the container ref rather
      // than this (Study-stack) navigator.
      if (!filter) {
        navigateRootStack('Offline');
        return;
      }
      // Downloads can't be narrowed by topic (offline_bundles has no topic_id),
      // but carry the live topic's label so the Offline screen can SAY the list
      // is the whole course instead of silently dropping the filter.
      const topicLabel =
        courseFilter?.id === filter.id && courseFilter?.topicId
          ? courseFilter.topicLabel ?? 'Topic'
          : null;
      navigateRootStack('Offline', { courseId: filter.id, courseLabel: filter.label, topicLabel });
    },
    [courseFilter]
  );

  /**
   * Draft a sellable study pack from a course (Phase 2 · H). Lives in each
   * course row's overflow sheet rather than beside the scope chips, so it is
   * reachable for any course instead of only the filtered one — and the scope
   * row stays a single line.
   *
   * The API validates `courseId` as a uuid, so only real course rows offer
   * this: UNFILED_COURSE_ID is the string 'null' (truthy!) with no course
   * behind it.
   */
  const openStudyPackDrafts = useCallback((filter: LibraryCourseFilter) => {
    // The market stack is nested under Main > MarketTab (there is no
    // root-level Market route), same shape as
    // navigationRef.navigateToChallengesInbox uses for ChatTab.
    navigateRootStack('Main', {
      screen: 'MarketTab',
      params: toTab('StudyProductDrafts', { source: { courseId: filter.id, title: filter.label } }),
    });
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

  // "Add your topics" on the readiness card lands here, and the outline editor
  // opens itself on arrival. Keyed on the param so the sheet re-opens if the
  // student comes back through the same door, and closed by hand (rather than
  // by the param going away) so dismissing it does not re-open it.
  const manageOutlineCourseId = route?.params?.manageOutlineCourseId;
  const manageOutlineCourseLabel = route?.params?.manageOutlineCourseLabel;
  useEffect(() => {
    if (!manageOutlineCourseId) return;
    setManageCourse({
      id: manageOutlineCourseId,
      label: manageOutlineCourseLabel ?? 'Course',
    });
  }, [manageOutlineCourseId, manageOutlineCourseLabel]);

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

  const openStudy = () => {
    useStudySetStore.getState().openPicker();
    navigation.navigate('StudyHub');
  };

  return (
    <Screen bottom="none">
      <StudyWorkspaceBar
        active="library"
        onSelect={(section) => {
          if (section === 'study') openStudy();
        }}
      />
      <View className="px-4 pt-2 bg-lantern-background">
        {/* The screen title shares the search row: the bottom tab bar already
            names this screen and carries its icon and due-card badge, so a hero
            block of its own bought nothing but height. The archive totals moved
            into the course tree's collapsed summary. */}
        <View className="mb-2 flex-row items-center gap-2">
          {/* The screen's h1 — a `title` display role, so the serif face
                  (theme/fonts.ts). It read sans while the headings inside the
                  page were Bitter. The style carries the family and resets the
                  weight the face already has; the class keeps the size. */}
              <Text style={serifDisplayStyle()} className="text-title text-lantern-text">Library</Text>
          <View className="flex-1 flex-row items-center gap-2 px-3 py-1.5 rounded-xl border border-lantern-border bg-lantern-surface min-h-[44px]">
            <AppIcon name="search" size={16} color={colors.inputPlaceholder} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              // Names the list this narrows: typing filters the open tab, and
              // reaching the rest of the archive is the "Search everything"
              // step below. "Search notes, decks, cards, bundles…" promised
              // something typing no longer does.
              placeholder={`Search ${tab === 'notes' ? 'notes' : 'flashcards'}${
                activeTopic ? ` in ${activeTopic.label}` : courseFilter ? ` in ${courseFilter.label}` : ''
              }…`}
              placeholderTextColor={colors.inputPlaceholder}
              autoCorrect={false}
              returnKeyType="search"
              // `body` 15/22: the search field and the list it filters read at the
              // same size. `text-sm` was 12.25 sp here.
              className="flex-1 text-body text-lantern-text py-1"
              accessibilityLabel={`Search ${tab === 'notes' ? 'notes' : 'flashcards'}`}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <AppIcon name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <LibraryCourseTree
          tree={tree}
          loading={overviewLoading}
          error={overviewError}
          stale={overviewFromCache}
          totalNotes={heroNotes}
          totalDecks={heroDecks}
          selectedCourseId={courseFilter?.id ?? null}
          selectedTopicId={activeTopic?.id ?? null}
          onSelectCourse={selectCourse}
          onSelectTopic={selectTopic}
          onOpenTests={openTests}
          onOpenOffline={openOffline}
          onManageTopics={setManageCourse}
          onCreateStudyPack={openStudyPackDrafts}
          onTurnSemesterIntoProducts={() =>
            navigateRootStack('Main', {
              screen: 'MarketTab',
              params: toTab('SemesterProducts'),
            })
          }
          onRetry={() => setOverviewAttempt(a => a + 1)}
          onManageCourses={() => navigateRootStack('AcademicSettings')}
        />

        {/* The one place the live filter is announced. The tree rows no longer
            highlight the selection, and the tree is collapsed by default, so
            without this a filtered list reads as missing notes. Kept to a
            single line — the per-course actions it used to carry moved into
            each row's overflow sheet. */}
        {courseFilter ? (
          <View className="mb-2 flex-row items-center gap-2">
            {/* Both chips shrink rather than wrap: two long labels used to push
                this row onto a second line and cost another 36px. */}
            <View className="shrink flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background">
              <AppIcon name="school" size={14} color={colors.primaryText} />
              <Text className="shrink text-caption font-semibold text-lantern-primary-text" numberOfLines={1}>
                {courseFilter.label}
              </Text>
              <Pressable
                onPress={() => selectCourse(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Clear course filter ${courseFilter.label}`}
              >
                <AppIcon name="close-circle" size={16} color={colors.primaryText} />
              </Pressable>
            </View>
            {activeTopic ? (
              <View className="shrink flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary">
                <AppIcon name="bookmark" size={13} color={colors.textSecondary} />
                <Text className="shrink text-caption font-medium text-lantern-text-secondary" numberOfLines={1}>
                  {activeTopic.label}
                </Text>
                <Pressable
                  // Clear the topic, keep the course.
                  onPress={() => courseFilter && setCourseFilter({ id: courseFilter.id, label: courseFilter.label })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear topic filter ${activeTopic.label}`}
                >
                  <AppIcon name="close-circle" size={15} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <ClassOfficialMaterials
          courseId={
            courseFilter?.id && courseFilter.id !== UNFILED_COURSE_ID ? courseFilter.id : null
          }
          onOpenNote={(noteId) => navigation.navigate('NoteEditor', { noteId })}
        />

        {/* Only while something is typed: the way out to decks, cards and
            bundles, and the way back. One line, and only then. */}
        {trimmedQuery ? (
          <View className="mb-2 flex-row items-center gap-2">
            {searchEverything ? (
              <Pressable hitSlop={10}
                onPress={() => setSearchEverything(false)}
                className="shrink flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary min-h-[36px]"
                accessibilityRole="button"
              >
                <AppIcon name="arrow-back" size={14} color={colors.textSecondary} />
                <Text className="shrink text-caption font-semibold text-lantern-text-secondary" numberOfLines={1}>
                  Back to {tab === 'notes' ? 'notes' : 'flashcards'}
                </Text>
              </Pressable>
            ) : canSearchEverything ? (
              <Pressable
                onPress={() => setSearchEverything(true)}
                className="shrink flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background min-h-[36px]"
                accessibilityRole="button"
                accessibilityHint="Searches decks, cards and offline bundles as well; the folder and Archived filters do not apply there"
              >
                <AppIcon name="search" size={14} color={colors.primaryText} />
                <Text className="shrink text-caption font-semibold text-lantern-primary-text" numberOfLines={1}>
                  Search everything
                </Text>
              </Pressable>
            ) : (
              // One character filters the list below just fine; only the server
              // search has a minimum, so say so rather than showing nothing.
              <Text className="shrink text-caption text-lantern-text-secondary" numberOfLines={1}>
                Type {LIBRARY_SEARCH_MIN_CHARS} characters to search decks, cards and bundles too.
              </Text>
            )}
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
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <AppIcon
                    name={icon}
                    size={16}
                    color={active ? featureAccents.library : colors.textTertiary}
                  />
                  <Text
                    className={`text-body font-medium ${
                      active ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'
                    }`}
                    style={active ? { color: featureAccents.library } : undefined}
                  >
                    {label}
                  </Text>
                  {id === 'flashcards' && dueCardsCount > 0 ? (
                    <View className="bg-lantern-error min-w-[18px] h-[18px] px-1 rounded-full items-center justify-center">
                      <Text className="text-label font-bold tracking-normal text-white">
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
            topicLabel={activeTopic?.label ?? null}
            bottomPadding={tabBarClearance}
            onOpenNote={noteId => navigation.navigate('NoteEditor', { noteId })}
            onOpenDeck={(deckId, deckName) => navigation.navigate('DeckDetail', { deckId, deckName })}
            onOpenBundle={openBundle}
          />
        ) : tab === 'notes' ? (
          <NotesScreen navigation={navigation} embedded listQuery={query} />
        ) : (
          <FlashcardsScreen navigation={navigation} embedded listQuery={query} />
        )}
      </View>

      <ManageOutlineSheet
        visible={!!manageCourse}
        courseId={manageCourse?.id ?? null}
        courseLabel={manageCourse?.label ?? null}
        onClose={() => setManageCourse(null)}
        // Counts and topic rows in the tree follow the outline that just changed.
        onChanged={() => setOverviewAttempt(a => a + 1)}
        // A deleted topic takes the filter with it. Left alone, the filter would
        // still hold a uuid nothing carries any more: Notes, Flashcards and
        // Tests would all show zero items under a chip naming a topic that no
        // longer exists. Widen back to the whole course instead.
        onTopicDeleted={topicId => {
          if (courseFilter?.topicId !== topicId) return;
          setCourseFilter({ id: courseFilter.id, label: courseFilter.label });
        }}
      />
    </Screen>
  );
}

export default LibraryScreen;
