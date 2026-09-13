import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  courseWorkspaceLabel,
  isCalendarNote,
  isLectureNote,
  isValidStudySetTitle,
  materialsForStudySet,
  normalizeStudySetTitle,
  sortStudySets,
  studySetLabel,
  studySetPlanProgress,
  STUDY_SET_SORTS,
  STUDY_SET_TITLE_MAX,
  type StudySetSortId,
} from '@lantern/shared';
import type { UserCourse } from '@lantern/shared/types';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useStudySetStore } from '../../stores/studySetStore';
import {
  ActionSheet,
  AppIcon,
  Button,
  ScreenHeader,
  SheetShell,
  T,
  type ActionSheetItem,
} from '../../components/ui';
import { confirmAsync } from '../../components/ui/appDialog';
import { StudySetCard } from '../../components/study/StudySetCard';
import { shareStudySet } from '../../components/study/shareStudySet';
import { relativeStudiedLabel } from '../../components/study/setPresentation';
import { studySetProgress } from '../../components/dashboard/homeSections';
import { StudyWorkspaceBar } from './StudyWorkspaceBar';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useTheme } from '../../theme';
import { getMyActiveCourses } from '../../services/academic';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * The Study hub: the LIST of study sets, and nothing that jumps off it.
 *
 * Two things changed here in the StudyFetch pass (SF2 §3, §6).
 *
 * 1. THE HUB NO LONGER OPENS A SET FOR YOU. On focus it used to resolve
 *    `pickOpenStudySetId` and navigate straight into the last room, so tapping
 *    "Study" landed in a lecture studio for a set you had finished with and the
 *    list of sets was a screen you could not actually reach. The tab is named
 *    after the list; it shows the list.
 *
 * 2. A SET ROW SAYS WHAT HOME SAYS. It was a `FeatureRow` — one mint disc
 *    repeated down the screen, one grey meta line — while Home drew tile art, a
 *    progress bar, counts and "last studied" for the same object. That card now
 *    lives in `components/study/StudySetCard.tsx` and this screen feeds it.
 *
 * The toolbar (search, sort, create) is the other half: four rows over 900px of
 * dead cream was the measured state, and a list you cannot search or order is
 * one a student with a dozen sets scrolls rather than uses.
 */
export function StudyHubScreen({ navigation }: Props) {
  const { decks } = useFlashcardStore();
  const notes = useNotesStore((s) => s.notes);
  const tests = useTestStore((s) => s.tests);
  const userId = useAuthStore((s) => s.user?.id);
  const fetchTests = useTestStore((s) => s.fetchTests);
  const fetchAttempts = useTestStore((s) => s.fetchAttempts);
  const showToast = useToastStore((s) => s.showToast);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const createSet = useStudySetStore((s) => s.createSet);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const sets = useStudySetStore((s) => s.sets);
  const plans = useStudySetStore((s) => s.plans);
  const lastOpenedId = useStudySetStore((s) => s.lastOpenedId);
  const status = useStudySetStore((s) => s.status);
  const tabBarClearance = useTabBarClearance(16);
  const { colors } = useTheme();
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createCourseId, setCreateCourseId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [courses, setCourses] = useState<UserCourse[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StudySetSortId>('lastAccessed');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuSetId, setMenuSetId] = useState<string | null>(null);

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
        // Load the list and STOP. No `pickOpenStudySetId`, no navigate: see
        // the note at the top of the file.
        await loadSets({ force: true }).catch(() => undefined);
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

  /**
   * What each set holds, and how far along it is.
   *
   * Computed here rather than in the card so the card stays a view: this screen
   * is the only thing that knows a "material" is a non-calendar note, that a
   * lecture is a note flagged as one, and that a personal test belongs to a set
   * by way of the note it was generated from (tests carry no set id).
   */
  const rows = useMemo(() => {
    const now = Date.now();
    return sets.map((set) => {
      const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
      const noteIds = new Set(setNotes.map((note) => note.id));
      const setDecks = materialsForStudySet(decks, set.id);
      const counts = {
        materials: setNotes.length,
        lectures: setNotes.filter(isLectureNote).length,
        decks: setDecks.length,
        tests: tests.filter((test) => test.sourceNoteId && noteIds.has(test.sourceNoteId)).length,
      };
      const plan = plans[set.id];
      const progress = studySetProgress({
        plan: plan?.loaded && plan.topics.length > 0 ? studySetPlanProgress(plan.topics) : null,
        counts: { materials: counts.materials, decks: counts.decks, lectures: counts.lectures },
        hasExamDate: Boolean((set.examDate || '').trim()),
        studied: Boolean(set.lastStudiedAt),
      });
      // Only a loaded plan can name a topic. Deriving one from note titles is
      // what made a topic ticked on a laptop come back unticked here, so an
      // unloaded plan simply draws no resume pill.
      const resumeTopic =
        plan?.loaded && set.lastStudiedAt
          ? plan.topics.find((topic) => topic.status !== 'mastered')?.title ?? null
          : null;
      return {
        set,
        counts,
        progress,
        resumeTopic,
        studiedLabel: relativeStudiedLabel(set.lastStudiedAt, new Date(now)),
      };
    });
  }, [sets, notes, decks, tests, plans]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) => studySetLabel(row.set).toLowerCase().includes(needle))
      : rows;
    // The shared comparator, so a set's place in the list is the same on the
    // phone and in the browser.
    const ordered = sortStudySets(
      filtered.map((row) => row.set),
      sort,
      sort === 'lastAccessed' ? lastOpenedId : null
    );
    const byId = new Map(filtered.map((row) => [row.set.id, row]));
    return ordered.map((set) => byId.get(set.id)!).filter(Boolean);
  }, [rows, query, sort, lastOpenedId]);

  const sortLabel =
    STUDY_SET_SORTS.find((option) => option.id === sort)?.label ?? 'Last accessed';

  const menuSet = menuSetId ? sets.find((row) => row.id === menuSetId) ?? null : null;
  const menuItems: ActionSheetItem[] = menuSet
    ? [
        {
          label: 'Edit',
          icon: 'pencil',
          onPress: () => {
            setMenuSetId(null);
            // Rename lives in the set's own settings screen — the one place
            // that validates a title — rather than in a second inline form.
            navigation.navigate('StudySetSettings', { studySetId: menuSet.id });
          },
        },
        {
          // Sharing a set started here on web (the hub card's kebab), so it
          // starts here on mobile too. The sheet's text says what the link
          // actually does today — see `components/study/shareStudySet.ts`.
          label: 'Share',
          icon: 'share',
          onPress: () => {
            const target = menuSet;
            setMenuSetId(null);
            void shareStudySet({
              setId: target.id,
              title: studySetLabel(target),
              visibility: target.visibility,
            });
          },
        },
        {
          label: 'Delete',
          icon: 'trash',
          destructive: true,
          onPress: () => {
            const target = menuSet;
            setMenuSetId(null);
            void (async () => {
              // Never one tap. The set is the box every note, deck, test and
              // lecture in it is filed in.
              const ok = await confirmAsync(
                `Delete ${studySetLabel(target)}?`,
                'The set and its filing go. Your notes and decks stay in your library.',
                { confirmLabel: 'Delete', destructive: true }
              );
              if (!ok) return;
              try {
                await removeSet(target.id);
                showToast('Study set deleted.', 'success');
              } catch (error) {
                showToast(
                  error instanceof Error ? error.message : 'Could not delete that study set.',
                  'error'
                );
              }
            })();
          },
        },
      ]
    : [];

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

  const openLibrary = () => navigation.navigate('Library', { tab: 'notes' });

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <StudyWorkspaceBar
        active="study"
        onSelect={(section) => {
          if (section === 'library') openLibrary();
        }}
      />
      <ScrollView
        className="flex-1 w-full"
        keyboardShouldPersistTaps="handled"
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

        {/* The toolbar: find one, order them, make one. */}
        <View
          style={{ borderColor: colors.border, backgroundColor: colors.surface }}
          className="flex-row items-center gap-2 rounded-full border px-3 mb-2 min-h-[44px]"
        >
          <AppIcon name="search" size={16} color={colors.textSecondary} importantForAccessibility="no" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search study sets"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="Search study sets"
            returnKeyType="search"
            className="flex-1 text-body text-lantern-text py-2"
            style={{ color: colors.text }}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              className="active:opacity-60"
            >
              <AppIcon name="close-circle" size={16} color={colors.textSecondary} importantForAccessibility="no" />
            </Pressable>
          ) : null}
        </View>

        <View className="flex-row items-center justify-between gap-2 mb-3">
          <Pressable
            onPress={() => setSortOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sort study sets. Currently ${sortLabel}`}
            testID="study-hub-sort"
            style={{ borderColor: colors.border, backgroundColor: colors.surface }}
            className="flex-row items-center gap-1 rounded-full border px-3 min-h-[44px] active:opacity-80"
          >
            <T.Caption numberOfLines={1}>{sortLabel}</T.Caption>
            <AppIcon name="chevron-down" size={14} color={colors.textSecondary} importantForAccessibility="no" />
          </Pressable>
          <Button size="sm" onPress={() => setCreateOpen(true)} testID="study-hub-new-set">
            New study set
          </Button>
        </View>

        {visible.length === 0 ? (
          query.trim() ? (
            <T.Body tone="secondary" className="mt-2">
              {`No study set matches "${query.trim()}".`}
            </T.Body>
          ) : status === 'ready' ? (
            // The empty state is the create control, not a sentence about one.
            <Pressable
              onPress={() => setCreateOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Create study set"
              testID="study-hub-empty-create"
              style={{ borderColor: colors.border, borderStyle: 'dashed' }}
              className="rounded-lantern-xl border-2 items-center justify-center py-8 px-4 active:opacity-80"
            >
              <AppIcon name="create" size={22} color={colors.textSecondary} importantForAccessibility="no" />
              <T.Body style={{ fontWeight: '600' }} className="mt-2">
                Create study set
              </T.Body>
              <T.Caption tone="secondary" className="mt-1 text-center">
                A set keeps a subject's notes, decks, tests and lectures in one place.
              </T.Caption>
            </Pressable>
          ) : (
            // Not "you have no sets" — "we have not been told yet". An offline
            // cold start must never invite a student with four sets to start
            // their library.
            <T.Body tone="secondary" className="mt-2">
              {status === 'loading'
                ? 'Loading your study sets…'
                : status === 'offline'
                ? "You're offline — your sets will appear when you reconnect."
                : "Couldn't load your study sets. Pull down to try again."}
            </T.Body>
          )
        ) : (
          visible.map((row) => (
            <StudySetCard
              key={row.set.id}
              setId={row.set.id}
              title={studySetLabel(row.set)}
              coverPath={row.set.coverPath}
              counts={row.counts}
              percent={row.progress.percent}
              progressBasis={row.progress.basis}
              studiedLabel={row.studiedLabel}
              resumeTopic={row.resumeTopic}
              onPress={() => openSet(row.set.id, row.set.title)}
              onMenu={() => setMenuSetId(row.set.id)}
              testID={`study-set-${row.set.id}`}
            />
          ))
        )}
      </ScrollView>

      <ActionSheet
        visible={sortOpen}
        title="Sort study sets"
        onClose={() => setSortOpen(false)}
        items={STUDY_SET_SORTS.map((option) => ({
          label: option.label,
          icon: option.id === sort ? ('checkmark' as const) : undefined,
          onPress: () => {
            setSort(option.id);
            setSortOpen(false);
          },
        }))}
      />

      <ActionSheet
        visible={Boolean(menuSet)}
        title={menuSet ? studySetLabel(menuSet) : undefined}
        onClose={() => setMenuSetId(null)}
        items={menuItems}
      />

      {/* The one sheet shell (components/ui/SheetShell.tsx): grabber, 23 dp
          corners, cream ground, serif heading — and a keyboard-safe body, which
          this sheet had no form of at all. Its title field is `autoFocus`, so
          the IME is up the moment it opens and "Create set" sat under it on
          Android, where the window does not resize. */}
      <SheetShell visible={createOpen} onClose={() => setCreateOpen(false)} title="New study set">
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
      </SheetShell>
    </SafeAreaView>
  );
}

export default StudyHubScreen;
