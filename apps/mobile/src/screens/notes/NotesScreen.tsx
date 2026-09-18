/**
 * The Notes list — the standalone screen and, with `embedded`, the Library's
 * Notes tab. Folders, the Mine/Shared and Active/Archived filters, multi-select
 * (move, delete, file under a course or topic), the import doors (PDF, slides,
 * photos, YouTube), and the per-row action sheet.
 *
 * Main exports: `NotesScreen` (also the default). `NoteCard` and `FolderChip`
 * are local.
 * Touches: notesStore (folders, notes, create/save/move/remove, cover path),
 * uiStore (the Library course/topic filter), confirmStore; services/notes
 * (`createNoteFromYoutube`, the PDF/presentation/image uploads),
 * services/academic (`getMyActiveCourses`, `courseHasTopics`), productAnalytics,
 * and the moderation report sheet. Native: expo-document-picker,
 * expo-image-picker, and iOS's ActionSheetIOS for one platform-specific menu.
 *
 * Gotchas: notes are loaded UNFILTERED on purpose — the companion's note picker
 * reads `notesStore.notes` and only reloads when empty, so narrowing the store
 * by the Library course filter would leak that filter into the companion. All
 * narrowing happens client-side in `filteredNotes`. Search matches `searchText`
 * as well as the body, because imported notes keep their content in attachment
 * text. Sheets are sequenced with `SHEET_DISMISS_MS` so two modals are never up
 * at once. A shared note can be edited by an editor but deleted only by its
 * owner (`canManageNote` vs `canDeleteNote`).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import {
  assertNoteUploadSize,
  formatFileSize,
  formatMaxNoteUploadLabel,
} from '@lantern/shared/utils/noteUpload';
import { notePlainPreview } from '@lantern/shared/utils/noteBlocks';
import { humanizeFailureMessage } from '@lantern/shared/network';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { parseYoutubeVideoId } from '@lantern/shared/utils/youtube';
import { formatNoteUpdatedLabel } from './notesFormat';
import { useNotesStore } from '../../stores/notesStore';
import type { NoteFolder, StudyNote } from '../../services/notes';
import {
  createNoteFromYoutube,
  extractDocumentTextViaApi,
  uploadNotePdfViaApi,
  uploadPresentationViaApi,
  uploadNoteImagesViaApi,
} from '../../services/notes';
import {
  WORD_DOOR_LABEL,
  importWordDocument,
  pickWordDocument,
  wordDoorState,
} from '../../utils/wordImport';
import { useSyncStatus } from '../../hooks/useSync';
import { trackNoteCreated } from '../../services/productAnalytics';
import {
  ActionSheet,
  Button,
  Card,
  CourseChip,
  FeatureDisc,
  IconButton,
  ScreenHeader,
  Segmented,
  useSegmentSkin,
  type ActionSheetItem,
} from '../../components/ui';
import {
  CoverFailureLine,
  CoverPicker,
  CoverThumb,
  SHEET_DISMISS_MS,
  useCoverPicker,
} from '../../components/ui/CoverPicker';
import { readCoverPath } from '../../components/ui/coverPickerModel';
import { noteRowMark } from './noteRowMark';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { courseHasTopics, getMyActiveCourses } from '../../services/academic';
import { useUIStore } from '../../stores/uiStore';
import { matchesCourseFilter, matchesTopicFilter, UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import type { Course, CourseTopic } from '@lantern/shared/types';
import { COURSE_TOPIC_COPY, isLectureNote } from '@lantern/shared';
import {
  NOTES_LIST_VIEW_OPTIONS,
  noteMatchesListView,
  type NotesListView,
} from '@lantern/shared/learning';
import { toTab } from '../../navigation/nestedTab';
import { confirmSheet } from '../../stores/confirmStore';
import { brand, useTheme } from '../../theme';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { SCREEN_KEYBOARD_BEHAVIOR } from '../../components/layout';
import { useChrome, useScrollToTopRequest } from '../../components/layout/ChromeContext';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import * as ImagePicker from 'expo-image-picker';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  embedded?: boolean;
  /**
   * Embedded only: the Library's search box, which filters this list in place.
   *
   * The Library has one box for two jobs. Typing narrows what is on screen —
   * instantly, from the first character, client-side, and under the folder,
   * Mine/Shared and Active/Archived choices still showing above the list.
   * Searching decks, cards and bundles needs the network and two characters and
   * cannot honour those, so it replaces the panel and is a deliberate step
   * ("Search everything" in the Library's scope row), not something typing does.
   */
  listQuery?: string;
}

type PendingPhotoAsset = {
  uri: string;
  name: string;
  size: number;
  mimeType?: string | null;
};

type PendingImport =
  | {
      uri: string;
      name: string;
      size: number;
      /**
       * `document` is a Word file. It shares this staging card with the two
       * uploads but not their ending: the server returns TEXT for it, and the
       * note is created from that text — nothing is stored.
       */
      mode: 'pdf' | 'presentation' | 'document';
    }
  | {
      mode: 'photos';
      assets: PendingPhotoAsset[];
    };

function FolderChip({
  folder,
  isActive,
  onPress,
  onOpenOptions,
}: {
  folder: NoteFolder;
  isActive: boolean;
  onPress: () => void;
  onOpenOptions?: () => void;
}) {
  return (
    <View
      className={`shrink-0 rounded-lg flex-row items-center ${
        isActive
          ? 'bg-lantern-primary-fill'
          : 'bg-lantern-surface border border-lantern-border'
      }`}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onOpenOptions}
        delayLongPress={350}
        className="px-3 py-2 flex-row items-center gap-1.5"
        accessibilityRole="button"
        accessibilityLabel={`Select folder ${folder.name}`}
      >
        {/* The dot marks that this chip IS a folder; it is not a swatch.
            `folder.color` is stored data, and every folder made before the
            colour pivot holds the retired indigo — which is how build
            198's device pass found two indigo dots sitting in a nav row of an
            otherwise ink-and-cream app. A chip in a FILTER row is a control, so
            its dot takes the control's own foreground: the chip's inverse ink
            when the chip is lit, the muted outline when it is not. The stored
            colour still identifies the folder where the folder is the SUBJECT
            (the manage-folders list below). */}
        {folder.color ? (
          <View
            className={`w-2 h-2 rounded-full ${
              isActive ? 'bg-white' : 'bg-lantern-text-tertiary'
            }`}
          />
        ) : null}
        <Text
          className={`text-caption font-semibold ${
            isActive ? 'text-white' : 'text-lantern-text'
          }`}
          numberOfLines={1}
        >
          {folder.name}
        </Text>
      </Pressable>
      {onOpenOptions ? (
        <Pressable
          onPress={onOpenOptions}
          hitSlop={8}
          className="pr-2 pl-1 py-2 min-w-[36px] min-h-[40px] items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={`Folder options for ${folder.name}`}
        >
          <AppIcon
            name="ellipsis-horizontal"
            size={16}
            color={isActive ? '#ffffff' : '#64748b'}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One Library row. Spec v3 §5.7: a NEUTRAL card, a 40px feature disc on the
 * left saying what the thing is, the course chip on the right saying what it
 * is about, and no band — bands belong on heroes and doors, never in a list.
 *
 * The indigo "PDF"/"Slides" pill this replaced was a word doing an icon's job,
 * and it was the same indigo on every row, so it said nothing at a glance.
 */
function NoteCard({
  note,
  courseCode,
  onPress,
  onLongPress,
  selectMode,
  selected,
}: {
  note: StudyNote;
  /** `Course.code` for `note.courseId`, when the enrolment list knows it. */
  courseCode?: string;
  onPress: () => void;
  onLongPress?: () => void;
  selectMode?: boolean;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  const isShared = note.accessRole && note.accessRole !== 'owner';
  const mark = noteRowMark(note.sourceType);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="mb-3 active:opacity-90"
      accessibilityState={selectMode ? { selected: Boolean(selected) } : undefined}
    >
      <Card className={selected ? 'border-lantern-primary' : 'border-lantern-border'}>
        <View className="flex-row items-start gap-3">
          {selectMode ? (
            <AppIcon
              name={selected ? 'checkbox' : 'square'}
              size={20}
              color={selected ? brand.text : '#94a3b8'}
              style={{ marginTop: 10 }}
            />
          ) : null}
          {/* The type, as a shape — or, when the note has a cover, that
              picture filling the same tile with the type glyph demoted to a
              badge on it. `CoverThumb` falls back to this exact disc when
              there is no cover. */}
          <CoverThumb
            coverPath={readCoverPath(note)}
            feature={mark.feature}
            icon={mark.icon}
            label={mark.label}
          />
          <View className="flex-1 min-w-0">
            <View className="flex-row items-start gap-2">
              <View className="flex-1 flex-row items-start gap-1.5 min-w-0">
                {note.isPinned ? (
                  <AppIcon name="bookmark" size={16} color={brand.text} style={{ marginTop: 2 }} />
                ) : null}
                <Text
                  className="flex-1 text-body font-semibold text-lantern-text"
                  numberOfLines={2}
                >
                  {note.title}
                </Text>
              </View>
              <CourseChip code={courseCode} />
              {/* The row's actions were long-press only, which is a gesture
                  with no affordance: nothing on screen said the menu existed.
                  The overflow opens the SAME sheet, and long-press still
                  works for anyone who already knows it. */}
              {onLongPress && !selectMode ? (
                <IconButton
                  icon="ellipsis-vertical"
                  size={18}
                  padding={4}
                  color={colors.textSecondary}
                  onPress={onLongPress}
                  accessibilityLabel={`More actions for ${note.title}`}
                />
              ) : null}
            </View>
            {isShared ? (
              <View className="flex-row items-center gap-1 mt-1">
                <AppIcon name="people" size={13} color={brand.text} />
                <Text className="text-caption text-lantern-text-secondary">
                  Shared by {note.owner?.name || note.owner?.username || 'another member'}
                </Text>
              </View>
            ) : null}
            <Text className="text-body text-lantern-text-secondary mt-1" numberOfLines={2}>
              {notePlainPreview(note.summary || note.body) || 'Empty note'}
            </Text>
            {formatNoteUpdatedLabel(note.updatedAt) ? (
              <Text className="text-caption text-lantern-text-tertiary mt-3">
                Updated {formatNoteUpdatedLabel(note.updatedAt)}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export function NotesScreen({ navigation, embedded = false, listQuery = '' }: Props) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(embedded ? 16 : 8);
  const { onScroll: chromeOnScroll } = useChrome();
  // The contextual row's re-tap (spec v3 §7.2): pressing Library while on
  // Library sends this list back to the top rather than re-navigating.
  const listRef = useRef<FlatList>(null);
  useScrollToTopRequest(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  const {
    folders,
    notes,
    isLoading,
    error,
    selectedFolderId,
    loadFolders,
    loadNotes,
    createNote,
    createFolder,
    updateFolder,
    removeFolder,
    saveNote,
    moveNotesToFolder,
    removeNotes,
    setSelectedFolderId,
    setError,
    setNoteCoverPath,
  } = useNotesStore();
  // The "All notes" chip is one of the same family of filters as the two
  // Segmented switches below it, so it borrows their skin rather than a class.
  const allNotesSkin = useSegmentSkin(!selectedFolderId);
  // Library archive: course filter picked in the Library tree (uuid or 'null' = unfiled).
  const courseFilter = useUIStore((s) => s.libraryCourseFilter);
  const setCourseFilter = useUIStore((s) => s.setLibraryCourseFilter);
  const courseFilterId = courseFilter?.id ?? null;
  /** Topic inside that course (Phase 1 · A); only meaningful with a real course. */
  const topicFilterId = courseFilter?.topicId ?? null;
  /** New notes are filed under the active course filter (never under "Unfiled"). */
  const defaultCourseId =
    courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? courseFilterId : undefined;

  /**
   * `courseId` → the printed code ("BIO 201") for the row chips.
   *
   * Read from the enrolment list, which `getMyActiveCourses` already caches
   * for a minute behind every course picker in the app — so this costs the
   * screen nothing on a warm cache and one request on a cold one. A note filed
   * under a course this student is no longer enrolled in simply has no chip;
   * an empty chip would be a label on an absence.
   */
  const [courseCodes, setCourseCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    getMyActiveCourses()
      .then((rows) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const row of rows) {
          if (row.course?.id && row.course.code) map[row.course.id] = row.course.code;
        }
        setCourseCodes(map);
      })
      // A chip is decoration on a row that already reads correctly without
      // it: a failed lookup must never banner or block the Library.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [ownSearch, setOwnSearch] = useState('');
  // One box per screen: the Library's when embedded, this screen's otherwise.
  const search = embedded ? listQuery : ownSearch;
  const [refreshing, setRefreshing] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const { isOnline } = useSyncStatus();
  const wordDoor = wordDoorState(isOnline);
  /** The import menu; the four entry points used to sit inline above the list. */
  const [moreOpen, setMoreOpen] = useState(false);
  const [moveKindOpen, setMoveKindOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [listView, setListView] = useState<NotesListView>('mine');
  const [renameFolder, setRenameFolder] = useState<NoteFolder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movingNotes, setMovingNotes] = useState(false);
  const [deletingNotes, setDeletingNotes] = useState(false);
  /** Note whose row action sheet is open. */
  const [noteActions, setNoteActions] = useState<StudyNote | null>(null);
  /** "Move to course…" target: one note from the row sheet, or the selection. */
  const [courseMoveTarget, setCourseMoveTarget] = useState<{
    noteIds: string[];
    currentCourseId: string | null;
  } | null>(null);
  const [movingCourse, setMovingCourse] = useState(false);
  /**
   * "Move to topic…" target. A topic needs its course, so this opens either
   * straight from the row sheet (note already filed) or as the second step of
   * a course move.
   */
  const [topicMoveTarget, setTopicMoveTarget] = useState<{
    noteIds: string[];
    courseId: string;
    currentTopicId: string | null;
  } | null>(null);
  const [movingTopic, setMovingTopic] = useState(false);
  const selectionBusy = movingNotes || deletingNotes || movingCourse || movingTopic;
  const youtubeUrlValid = Boolean(parseYoutubeVideoId(youtubeUrl));

  // Load notes UNFILTERED so every consumer keeps the full list — the AI
  // companion's note picker reads notesStore.notes and only reloads when empty,
  // so narrowing the store by the Library course filter here used to leak that
  // filter into the companion. The course/folder/ownership/search filters are
  // all applied client-side in `filteredNotes` below (FlashcardsScreen does the
  // same with decks).
  const loadData = useCallback(async () => {
    await Promise.all([loadFolders(), loadNotes()]);
  }, [loadFolders, loadNotes]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Recover collaborator/share updates missed while another screen was focused.
  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const filteredNotes = useMemo(() => {
    let list = notes;
    list = list.filter((note) => noteMatchesListView(note, listView));
    // Notes load unfiltered (shared store), so the Library course/topic filter
    // is applied HERE, client-side — this is the only place narrowing happens.
    if (courseFilterId) {
      list = list.filter((note) => matchesCourseFilter(note.courseId, courseFilterId));
      if (topicFilterId) {
        list = list.filter((note) => matchesTopicFilter(note.topicId, topicFilterId));
      }
    }
    if (selectedFolderId) {
      list = list.filter(n => n.folderId === selectedFolderId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          // Imported notes (PDF/slides/photos/YouTube) keep their content in
          // attachment text, surfaced by the list endpoint as `searchText` —
          // the web list matches on it too.
          Boolean(n.searchText && n.searchText.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDelta !== 0) return pinDelta;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [notes, selectedFolderId, search, listView, courseFilterId, topicFilterId]);

  const canManageNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner' || note.accessRole === 'editor';

  const canDeleteNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner';

  /** Shared with me (editor or viewer) — reportable to Lantern moderation (Phase 1 · E). */
  const isSharedNote = (note: StudyNote) => !!note.accessRole && note.accessRole !== 'owner';
  const [reportNote, setReportNote] = useState<StudyNote | null>(null);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedNoteIds([]);
    setMovePickerOpen(false);
  };

  const toggleNoteSelected = (noteId: string) => {
    setSelectedNoteIds((prev) =>
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId],
    );
  };

  const openMovePickerForNotes = (noteIds: string[]) => {
    if (noteIds.length === 0) return;
    setSelectedNoteIds(noteIds);
    setSelectMode(true);
    setMovePickerOpen(true);
  };

  const handleMoveToFolder = async (folderId: string | null) => {
    if (selectedNoteIds.length === 0) return;
    setMovingNotes(true);
    try {
      await moveNotesToFolder(selectedNoteIds, folderId);
      exitSelectMode();
    } catch (e: unknown) {
      appAlert('Could not move notes', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setMovingNotes(false);
    }
  };

  const handleDeleteNotesByIds = async (noteIds: string[]) => {
    if (noteIds.length === 0 || deletingNotes) return;
    const ownedIds = noteIds.filter((id) => {
      const note = notes.find((n) => n.id === id);
      return note ? canDeleteNote(note) : false;
    });
    if (ownedIds.length === 0) {
      appAlert(
        'Cannot delete',
        'Only notes you own can be deleted. Shared notes stay with their owner.',
      );
      return;
    }
    const confirmed = await confirmSheet({
      title: ownedIds.length === 1 ? 'Delete note' : 'Delete notes',
      message:
        ownedIds.length === 1
          ? 'Delete this note? This cannot be undone.'
          : `Delete ${ownedIds.length} notes? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    setDeletingNotes(true);
    try {
      await removeNotes(ownedIds);
      exitSelectMode();
    } catch (e: unknown) {
      appAlert('Could not delete notes', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setDeletingNotes(false);
    }
  };

  const handleDeleteSelected = async () => {
    await handleDeleteNotesByIds(selectedNoteIds);
  };

  /**
   * PATCH /notes/:id { courseId, topicId } for every targeted note (null
   * clears). The topic always goes with the course: a note landing in a new
   * course cannot keep a topic from the old one.
   */
  const handleMoveToCourse = async (course: Course | null) => {
    const target = courseMoveTarget;
    if (!target || target.noteIds.length === 0) return;
    const nextCourseId = course?.id ?? null;
    setMovingCourse(true);
    try {
      const results = await Promise.allSettled(
        target.noteIds.map((noteId) =>
          saveNote(noteId, { courseId: nextCourseId, topicId: null }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        appAlert(
          'Could not move to course',
          failed === target.noteIds.length
            ? 'Try again.'
            : `${failed} of ${target.noteIds.length} notes could not be moved.`,
        );
        return;
      }
      if (selectMode) exitSelectMode();
      // Second step: now the course is known, offer its syllabus outline — but
      // only when there is one. Filing a note under a course is a complete
      // action on its own, so a course with no outline must not cost an extra
      // dismissal. Let this sheet dismiss before the next one mounts.
      if (nextCourseId) {
        const noteIds = target.noteIds;
        void courseHasTopics(nextCourseId).then(hasTopics => {
          if (!hasTopics) return;
          setTimeout(
            () => setTopicMoveTarget({ noteIds, courseId: nextCourseId, currentTopicId: null }),
            50,
          );
        });
      }
    } finally {
      setMovingCourse(false);
      setCourseMoveTarget(null);
    }
  };

  /** PATCH /notes/:id { topicId } for every targeted note (null clears). */
  const handleMoveToTopic = async (topic: CourseTopic | null) => {
    const target = topicMoveTarget;
    if (!target || target.noteIds.length === 0) return;
    const nextTopicId = topic?.id ?? null;
    setMovingTopic(true);
    try {
      const results = await Promise.allSettled(
        target.noteIds.map((noteId) => saveNote(noteId, { topicId: nextTopicId })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        appAlert(
          'Could not move to topic',
          failed === target.noteIds.length
            ? 'Try again.'
            : `${failed} of ${target.noteIds.length} notes could not be moved.`,
        );
      } else if (selectMode) {
        exitSelectMode();
      }
    } finally {
      setMovingTopic(false);
      setTopicMoveTarget(null);
    }
  };

  // One ActionSheet for both platforms. This used to be Alert.alert, which on
  // Android caps at three buttons and silently drops the rest — so Pin,
  // Archive and Delete were unreachable there (and "Move to course…" would
  // have pushed Pin off too).
  const handleNoteOptions = (note: StudyNote) => {
    if (!canManageNote(note) && !isSharedNote(note)) return;
    if (selectMode) {
      if (canManageNote(note)) toggleNoteSelected(note.id);
      return;
    }
    setNoteActions(note);
  };

  /**
   * The cover sheet, owned once by the screen.
   *
   * A hook cannot live inside `NoteCard` and still be driven from the row's
   * action sheet, so the target is whichever note opened that sheet.
   */
  const [coverNote, setCoverNote] = useState<StudyNote | null>(null);
  const coverNoteId = coverNote?.id ?? '';
  const coverNoteHasCover = Boolean(readCoverPath(coverNote));
  const coverTarget = useMemo(
    () => ({ kind: 'note' as const, id: coverNoteId }),
    [coverNoteId],
  );
  const applyNoteCover = useCallback(
    (coverPath: string | null) => {
      if (coverNoteId) setNoteCoverPath(coverNoteId, coverPath);
    },
    [coverNoteId, setNoteCoverPath],
  );
  const coverPicker = useCoverPicker(coverTarget, {
    hasCover: coverNoteHasCover,
    onApplied: applyNoteCover,
  });

  const noteActionItems: ActionSheetItem[] = noteActions
    ? [
        ...(canManageNote(noteActions) ? ([
        {
          section: 'Organise',
          label: readCoverPath(noteActions) ? 'Change cover…' : 'Add cover…',
          icon: 'image',
          hint: 'A picture on this note in the list',
          // Latch the note HERE: `ActionSheet` calls onClose (which clears
          // `noteActions`) before this handler runs, and the upload happens
          // later still — reading the id then produced `/notes//cover`.
          onPress: () => {
            const note = noteActions;
            setTimeout(() => {
              setCoverNote(note);
              coverPicker.open();
            }, SHEET_DISMISS_MS);
          },
        },
        {
          section: 'Organise',
          label: 'Move to folder',
          icon: 'folder',
          // Let the sheet dismiss before the next modal mounts.
          onPress: () => setTimeout(() => openMovePickerForNotes([noteActions.id]), 50),
        },
        {
          section: 'Organise',
          label: 'Move to course…',
          icon: 'school',
          hint: noteActions.courseId ? 'Filed under a course — pick another or clear it' : 'File this note under a course',
          onPress: () =>
            setTimeout(
              () => setCourseMoveTarget({ noteIds: [noteActions.id], currentCourseId: noteActions.courseId ?? null }),
              50,
            ),
        },
        // Only offered once the note has a course: a topic without its course
        // is rejected server-side.
        ...(noteActions.courseId
          ? [
              {
                section: 'Organise',
                label: 'Move to topic…',
                icon: 'list' as ActionSheetItem['icon'],
                hint: 'Where this sits in the course outline',
                onPress: () =>
                  setTimeout(
                    () =>
                      setTopicMoveTarget({
                        noteIds: [noteActions.id],
                        courseId: noteActions.courseId as string,
                        currentTopicId: noteActions?.topicId ?? null,
                      }),
                    50,
                  ),
              },
            ]
          : []),
        {
          section: 'Organise',
          label: 'Select',
          icon: 'checkbox',
          hint: 'Move or delete several notes at once',
          onPress: () => {
            setSelectMode(true);
            setSelectedNoteIds([noteActions.id]);
          },
        },
        ...(!noteActions.isArchived
          ? [
              {
                section: 'Note',
                label: noteActions.isPinned ? 'Unpin' : 'Pin',
                icon: 'bookmark' as ActionSheetItem['icon'],
                iconFilled: noteActions.isPinned,
                onPress: () => {
                  void saveNote(noteActions.id, { isPinned: !noteActions.isPinned }).catch((e: unknown) => {
                    appAlert('Could not update pin', e instanceof Error ? e.message : 'Try again.');
                  });
                },
              },
            ]
          : []),
        {
          section: 'Note',
          label: noteActions.isArchived ? 'Unarchive' : 'Archive',
          icon: 'archive',
          onPress: () => {
            void saveNote(noteActions.id, { isArchived: !noteActions.isArchived }).catch((e: unknown) => {
              appAlert('Could not update archive', e instanceof Error ? e.message : 'Try again.');
            });
          },
        },
        ...(canDeleteNote(noteActions)
          ? [
              {
                section: 'Note',
                label: 'Delete',
                icon: 'trash' as ActionSheetItem['icon'],
                destructive: true,
                onPress: () =>
                  setTimeout(() => {
                    void handleDeleteNotesByIds([noteActions.id]);
                  }, 50),
              },
            ]
          : []),
        ] as ActionSheetItem[]) : []),
        ...(isSharedNote(noteActions)
          ? [
              {
                section: 'Note',
                label: 'Report note',
                icon: 'flag' as ActionSheetItem['icon'],
                hint: 'Leaked exam, plagiarism, copyright or inappropriate content',
                // Let the sheet dismiss before the report sheet mounts.
                onPress: () => setTimeout(() => setReportNote(noteActions), 50),
              },
            ]
          : []),
      ]
    : [];

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  /**
   * Which door a note row opens.
   *
   * A lecture is not a body of text — it is typed notes, enhanced notes, a
   * transcript and a recording. Opening one in the plain editor showed the
   * transcript dumped into the note and hid the audio entirely (build 192).
   * A lecture that belongs to a set or course goes to the studio, which can
   * also resume the take; a loose one goes to the editor, which now renders
   * the same tabs. Nested navigates use `toTab` so the Study tab keeps its
   * own root underneath (navigation/nestedTab.ts).
   */
  const openNoteRow = (note: StudyNote) => {
    if (isLectureNote(note) && (note.studySetId || note.courseId)) {
      navigation.navigate(
        'StudyTab',
        toTab('LectureStudio', {
          noteId: note.id,
          ...(note.courseId ? { courseId: note.courseId } : {}),
          ...(note.studySetId ? { studySetId: note.studySetId } : {}),
        })
      );
      return;
    }
    navigation.navigate('NoteEditor', { noteId: note.id });
  };

  const handleCreateNote = async () => {
    const note = await createNote({
      title: 'Untitled Note',
      body: '',
      folderId: selectedFolderId || undefined,
      courseId: defaultCourseId,
    });
    trackNoteCreated('editor');
    navigation.navigate('NoteEditor', { noteId: note.id });
  };

  const openRenameFolder = (folder: NoteFolder) => {
    setRenameFolder(folder);
    setRenameValue(folder.name);
  };

  const handleRenameFolderSubmit = async () => {
    if (!renameFolder) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameFolder.name) {
      setRenameFolder(null);
      return;
    }
    setRenamingFolder(true);
    try {
      await updateFolder(renameFolder.id, { name: trimmed });
      setRenameFolder(null);
    } catch (e: unknown) {
      appAlert('Could not rename', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setRenamingFolder(false);
    }
  };

  const confirmDeleteFolder = async (folder: NoteFolder) => {
    const ok = await confirmSheet({
      title: 'Delete folder?',
      message: `“${folder.name}” will be removed. Notes inside stay in All notes.`,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await removeFolder(folder.id);
    } catch (e: unknown) {
      appAlert('Could not delete', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const handleFolderOptions = (folder: NoteFolder) => {
    const runRename = () => {
      // Let the action sheet dismiss before mounting the rename modal.
      setTimeout(() => openRenameFolder(folder), 50);
    };
    const runDelete = () => {
      setTimeout(() => {
        void confirmDeleteFolder(folder);
      }, 50);
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: folder.name,
          message: 'Manage this folder. Notes stay in All notes if you delete it.',
          options: ['Rename', 'Delete folder', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) runRename();
          else if (buttonIndex === 1) runDelete();
        },
      );
      return;
    }

    appAlert(folder.name, 'Manage this folder. Notes stay in All notes if you delete it.', [
      { text: 'Rename', onPress: runRename },
      { text: 'Delete folder', style: 'destructive', onPress: runDelete },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleCreateFolder = async () => {
    const name = `Folder ${folders.length + 1}`;
    await createFolder(name);
  };

  const handlePickFile = async (mode: 'pdf' | 'presentation') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type:
          mode === 'pdf'
            ? 'application/pdf'
            : [
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/vnd.ms-powerpoint',
              ],
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const fileName = asset.name || (mode === 'pdf' ? 'document.pdf' : 'slides.pptx');
      const size = asset.size ?? 0;

      try {
        assertNoteUploadSize(size, fileName);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'File is too large');
        return;
      }

      setPendingImport({ uri: asset.uri, name: fileName, size, mode });
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open file picker');
    }
  };

  /**
   * The Word (.docx) door. The picker asks for the docx mime alone, and a
   * legacy `.doc` or an oversized file is refused here — before the file is
   * read into memory — with a sentence the student can act on.
   */
  const handlePickWordDocument = async () => {
    try {
      const picked = await pickWordDocument(DocumentPicker.getDocumentAsync);
      if (!picked) return;
      setPendingImport({ ...picked, mode: 'document' });
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open that document');
    }
  };

  const mapImageAssets = (assets: ImagePicker.ImagePickerAsset[]): PendingPhotoAsset[] =>
    assets.map((asset, index) => ({
      uri: asset.uri,
      name: asset.fileName || `photo-${index + 1}.jpg`,
      size: asset.fileSize ?? 0,
      mimeType: asset.mimeType,
    }));

  const handlePickPhotosFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setError('Photo library permission is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.85,
        exif: false,
      });
      if (result.canceled || !result.assets.length) return;
      const assets = mapImageAssets(result.assets);
      for (const asset of assets) {
        try {
          assertNoteUploadSize(asset.size, asset.name);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'File is too large');
          return;
        }
      }
      setPendingImport({ mode: 'photos', assets });
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open photo library');
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setError('Camera permission is required.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
      if (result.canceled || !result.assets[0]) return;
      const assets = mapImageAssets(result.assets);
      setPendingImport({ mode: 'photos', assets });
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open camera');
    }
  };

  const handlePickPhotos = () => {
    appAlert('Import photos', 'Choose a source', [
      { text: 'Photo library', onPress: () => void handlePickPhotosFromLibrary() },
      { text: 'Camera', onPress: () => void handleTakePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /**
   * The import entry points, behind the one "Import" button in the header row.
   * Inline they were four buttons plus a size hint above every list — ~134px
   * of a 844px screen spent on something most sessions never touch.
   */
  const importActionItems: ActionSheetItem[] = [
    {
      label: 'Import PDF',
      icon: 'document',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: () => void handlePickFile('pdf'),
    },
    {
      label: 'Import PowerPoint',
      icon: 'easel',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: () => void handlePickFile('presentation'),
    },
    {
      label: WORD_DOOR_LABEL,
      icon: 'document',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      // Disabled, visibly and with the reason, when there is no connection: a
      // Word document is read on the server, so offline the picker would open
      // and the request would die after the upload with a generic message.
      disabled: wordDoor.disabled,
      hint: wordDoor.disabled ? wordDoor.hint : 'Text is read out of the document',
      onPress: () => void handlePickWordDocument(),
    },
    {
      label: 'Import photos',
      icon: 'images',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: handlePickPhotos,
    },
    {
      label: 'Photograph pages',
      icon: 'camera',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      hint: 'Camera — text is read off the photo',
      onPress: () => void handleTakePhoto(),
    },
    {
      label: 'From YouTube',
      icon: 'logo-youtube',
      section: 'From a link',
      hint: "We'll fetch the transcript so AI tools can use it",
      onPress: () => setYoutubeOpen(true),
    },
  ];

  const moreActionItems: ActionSheetItem[] = [
    {
      label: 'Select',
      icon: 'checkbox',
      onPress: () => setSelectMode(true),
    },
    {
      label: 'New folder',
      icon: 'folder',
      onPress: () => void handleCreateFolder(),
    },
    ...importActionItems,
  ];

  const moveKindItems: ActionSheetItem[] = [
    {
      label: 'To folder',
      icon: 'folder',
      onPress: () => setMovePickerOpen(true),
    },
    {
      label: 'To course',
      icon: 'school',
      onPress: () => setCourseMoveTarget({ noteIds: selectedNoteIds, currentCourseId: null }),
    },
  ];

  const handleYoutubeImport = async () => {
    const url = youtubeUrl.trim();
    if (!url || !youtubeUrlValid) return;
    try {
      setImportingFile(true);
      setError(null);
      const result = await createNoteFromYoutube(url, selectedFolderId || undefined);
      trackNoteCreated('youtube');
      setYoutubeOpen(false);
      setYoutubeUrl('');
      if (result.status === 'failed') {
        setError(
          result.transcriptError ||
            'Note created, but the transcript could not be fetched for this video.'
        );
      }
      await loadNotes();
      navigation.navigate('NoteEditor', { noteId: result.note.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'YouTube import failed');
    } finally {
      setImportingFile(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    try {
      setImportingFile(true);
      setError(null);

      const importResult =
        pendingImport.mode === 'photos'
          ? await uploadNoteImagesViaApi(
              pendingImport.assets.map((asset) => ({
                uri: asset.uri,
                fileName: asset.name,
                mimeType: asset.mimeType,
                size: asset.size,
              })),
              selectedFolderId || undefined,
              defaultPhotoNoteTitle()
            )
          : pendingImport.mode === 'document'
          ? // Not an upload: the server returns the document's text and the
            // note is created from it, through the same `createNote` the paste
            // path uses. Nothing is stored, so there is no attachment to wait
            // for and no OCR to poll.
            {
              note: await importWordDocument({
                file: pendingImport,
                extractDocumentText: extractDocumentTextViaApi,
                createNote: (payload) =>
                  createNote({
                    ...payload,
                    folderId: selectedFolderId || undefined,
                    courseId: defaultCourseId,
                  }),
              }),
            }
          : pendingImport.mode === 'pdf'
          ? await uploadNotePdfViaApi(
              pendingImport.uri,
              pendingImport.name,
              selectedFolderId || undefined
            )
          : await uploadPresentationViaApi(
              pendingImport.uri,
              pendingImport.name,
              selectedFolderId || undefined
            );

      setPendingImport(null);
      await loadNotes();
      navigation.navigate('NoteEditor', { noteId: importResult.note.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImportingFile(false);
    }
  };

  const Wrapper = embedded ? View : SafeAreaView;
  const wrapperProps = embedded ? { className: 'flex-1 bg-lantern-background' } : { className: 'flex-1 bg-lantern-background', edges: ['top'] as const };

  return (
    <Wrapper {...wrapperProps}>
      {/* A cover failure belongs where the press happened, not in a toast
          that scrolls past: at the top of the list, in the server's words. */}
      <CoverFailureLine failure={coverPicker.failure} onDismiss={coverPicker.dismissFailure} />
      <Modal
        visible={!!renameFolder}
        transparent
        animationType="fade"
        onRequestClose={() => !renamingFolder && setRenameFolder(null)}
      >
        {/* The input autoFocuses, so the keyboard is up the moment this opens
            and Rename/Cancel sit in the band it covers. The window does not
            resize itself on Android 15+, so the card has to be lifted. */}
        <KeyboardAvoidingView behavior={SCREEN_KEYBOARD_BEHAVIOR} style={{ flex: 1 }}>
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => !renamingFolder && setRenameFolder(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation?.()}>
            <Card className="border-0 shadow-lg">
              <Text className="text-heading font-bold text-lantern-text mb-3">Rename folder</Text>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Folder name"
                placeholderTextColor="#94a3b8"
                maxLength={80}
                autoFocus
                className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-4"
              />
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={renamingFolder}
                  onPress={() => setRenameFolder(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={renamingFolder}
                  disabled={!renameValue.trim()}
                  onPress={() => void handleRenameFolderSubmit()}
                >
                  Save
                </Button>
              </View>
            </Card>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <ActionSheet
        visible={!!noteActions}
        title={noteActions?.title || 'Note'}
        items={noteActionItems}
        onClose={() => setNoteActions(null)}
      />
      <CoverPicker controller={coverPicker} title={coverNote?.title || 'Cover image'} />
      <ActionSheet
        visible={moreOpen}
        title="Notes"
        items={moreActionItems}
        onClose={() => setMoreOpen(false)}
      />
      <ActionSheet
        visible={moveKindOpen}
        title="Move selected"
        items={moveKindItems}
        onClose={() => setMoveKindOpen(false)}
      />
      <ReportContentSheet
        visible={!!reportNote}
        targetType="note"
        targetId={reportNote?.id ?? ''}
        targetLabel={reportNote?.title || undefined}
        onClose={() => setReportNote(null)}
      />

      <CoursePicker
        visible={!!courseMoveTarget}
        onClose={() => {
          if (!movingCourse) setCourseMoveTarget(null);
        }}
        value={courseMoveTarget?.currentCourseId ?? null}
        onChange={(course) => void handleMoveToCourse(course)}
        title={
          courseMoveTarget && courseMoveTarget.noteIds.length > 1
            ? `Move ${courseMoveTarget.noteIds.length} notes to course`
            : 'Move to course'
        }
        placeholder="Choose a course"
      />

      <TopicPicker
        visible={!!topicMoveTarget}
        onClose={() => {
          if (!movingTopic) setTopicMoveTarget(null);
        }}
        courseId={topicMoveTarget?.courseId ?? null}
        value={topicMoveTarget?.currentTopicId ?? null}
        onChange={(topic) => void handleMoveToTopic(topic)}
        title={
          topicMoveTarget && topicMoveTarget.noteIds.length > 1
            ? `Move ${topicMoveTarget.noteIds.length} notes to topic`
            : 'Move to topic'
        }
        placeholder="Choose a topic"
      />

      <Modal
        visible={movePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !movingNotes && setMovePickerOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => !movingNotes && setMovePickerOpen(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation?.()}>
            <Card className="border-0 shadow-lg max-h-[70%]">
              <Text className="text-heading font-bold text-lantern-text mb-1">Move to folder</Text>
              <Text className="text-body text-lantern-text-secondary mb-3">
                {selectedNoteIds.length === 1
                  ? 'Choose a folder for this note.'
                  : `Choose a folder for ${selectedNoteIds.length} notes.`}
              </Text>
              <ScrollView className="max-h-72">
                <Pressable
                  disabled={movingNotes}
                  onPress={() => void handleMoveToFolder(null)}
                  className="flex-row items-center gap-2 py-3 border-b border-lantern-border"
                  accessibilityRole="button"
                  accessibilityLabel="Move to All notes"
                >
                  <AppIcon name="folder" size={18} color="#64748b" />
                  <Text className="flex-1 text-body font-medium text-lantern-text">All notes</Text>
                  <Text className="text-caption text-lantern-text-tertiary">Unfiled</Text>
                </Pressable>
                {folders.map((folder) => (
                  <Pressable
                    key={folder.id}
                    disabled={movingNotes}
                    onPress={() => void handleMoveToFolder(folder.id)}
                    className="flex-row items-center gap-2 py-3 border-b border-lantern-border"
                    accessibilityRole="button"
                    accessibilityLabel={`Move to ${folder.name}`}
                  >
                    <View
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: folder.color || brand.text }}
                    />
                    <Text className="flex-1 text-body font-medium text-lantern-text" numberOfLines={1}>
                      {folder.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {folders.length === 0 ? (
                <Text className="text-caption text-lantern-text-secondary mt-3">
                  No folders yet. Create one from the Folder button, then move notes here.
                </Text>
              ) : null}
              <Button
                variant="secondary"
                className="mt-4"
                disabled={movingNotes}
                onPress={() => setMovePickerOpen(false)}
              >
                Cancel
              </Button>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>

      {!embedded && (
        <ScreenHeader
          onBack={() => navigation.goBack()}
          title="Notes"
          subtitle="Capture lectures and turn notes into study tools"
          className="pb-1"
        />
      )}
      {/* One action row for both modes — the standalone screen used to carry
          these in the header while the embedded panel had its own copy. */}
      <View className="flex-row items-center gap-2 px-4 pt-2 pb-1">
        <Segmented
          className="flex-1"
          value={listView}
          onChange={setListView}
          options={NOTES_LIST_VIEW_OPTIONS.map((option) => ({
            id: option.id,
            label: option.label,
            accessibilityLabel:
              option.id === 'mine'
                ? 'Show notes I own'
                : option.id === 'shared'
                  ? 'Show notes shared with me'
                  : 'Show archived notes',
          }))}
        />
        <Button size="sm" onPress={handleCreateNote} accessibilityLabel="New note">
          New
        </Button>
        <Pressable
          onPress={() => setMoreOpen(true)}
          hitSlop={8}
          className="min-h-[36px] min-w-[36px] items-center justify-center rounded-full border border-lantern-border bg-lantern-surface"
          accessibilityRole="button"
          accessibilityLabel="More note actions"
        >
          <AppIcon name="ellipsis-horizontal" size={18} color={colors.text} />
        </Pressable>
      </View>

      {selectMode ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2">
          <Text className="flex-1 text-body text-lantern-text">
            {selectedNoteIds.length === 0
              ? 'Select notes'
              : `${selectedNoteIds.length} selected`}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedNoteIds.length === 0 || selectionBusy}
            loading={movingNotes || movingCourse}
            onPress={() => setMoveKindOpen(true)}
          >
            Move
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={selectedNoteIds.length === 0 || selectionBusy}
            loading={deletingNotes}
            onPress={() => {
              void handleDeleteSelected();
            }}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" disabled={selectionBusy} onPress={exitSelectMode}>
            Done
          </Button>
        </View>
      ) : null}

      {folders.length > 0 ? (
      <View className="px-4 mb-1.5 flex-row items-center gap-1.5">
        {/* The folder row's "everything" chip. Selected, it wears the same ink
            ground the `Segmented` halves below it do (`useSegmentSkin`), not
            the old indigo `primary-fill`: two selected controls on one screen
            may not be two different colours. */}
        <Pressable
          onPress={() => setSelectedFolderId(null)}
          style={{ backgroundColor: allNotesSkin.backgroundColor }}
          className={`shrink-0 px-2.5 py-2 rounded-lg ${
            selectedFolderId ? 'border border-lantern-border' : ''
          }`}
          accessibilityRole="button"
          accessibilityState={{ selected: !selectedFolderId }}
        >
          <Text
            style={{ color: allNotesSkin.color }}
            className="text-caption font-semibold"
            numberOfLines={1}
          >
            All notes
          </Text>
        </Pressable>
        {folders.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerClassName="gap-1.5 items-center"
          >
            {folders.map(folder => (
              <FolderChip
                key={folder.id}
                folder={folder}
                isActive={selectedFolderId === folder.id}
                onPress={() => setSelectedFolderId(folder.id)}
                onOpenOptions={() => handleFolderOptions(folder)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
      ) : null}

      {courseFilter && !embedded ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2">
          <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background">
            <AppIcon name="school" size={14} color={colors.primaryText} />
            <Text className="text-caption font-semibold text-lantern-primary-text" numberOfLines={1}>
              {courseFilter.label}
            </Text>
            <Pressable
              onPress={() => setCourseFilter(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear course filter ${courseFilter.label}`}
            >
              <AppIcon name="close-circle" size={16} color={colors.primaryText} />
            </Pressable>
          </View>
          {/* The topic narrows the list further, so it gets its own chip:
              the course chip alone makes a shorter list look like missing notes. */}
          {courseFilter.topicId ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary">
              <AppIcon name="bookmark" size={13} color={colors.textSecondary} />
              <Text className="text-caption font-medium text-lantern-text-secondary" numberOfLines={1}>
                {courseFilter.topicId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : courseFilter.topicLabel || COURSE_TOPIC_COPY.filterLabel}
              </Text>
              <Pressable
                // Clear the topic, keep the course.
                onPress={() => setCourseFilter({ id: courseFilter.id, label: courseFilter.label })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear topic filter"
              >
                <AppIcon name="close-circle" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Embedded, the Library's box drives this list instead (`listQuery`), so
          a second input here would be two boxes for one intent. */}
      {!embedded ? (
        <View className="mx-4 mb-1.5 flex-row items-center gap-2 px-3 py-1.5 rounded-lg border border-lantern-border bg-lantern-surface min-h-[44px]">
          <AppIcon name="search" size={16} color={colors.inputPlaceholder} />
          <TextInput
            value={ownSearch}
            onChangeText={setOwnSearch}
            placeholder="Search notes..."
            className="flex-1 text-body text-lantern-text py-0.5"
            placeholderTextColor={colors.inputPlaceholder}
            accessibilityLabel="Search notes"
          />
        </View>
      ) : null}

      {/* Only the in-progress import takes space; the menu itself is behind the
          Import button above. */}
      {pendingImport || youtubeOpen ? (
      <View className="mx-4 mb-1.5">
        {pendingImport ? (
          <Card className="border-lantern-primary/30 mb-2">
            <Text className="text-body font-semibold text-lantern-text" numberOfLines={2}>
              {pendingImport.mode === 'photos'
                ? `${pendingImport.assets.length} photo${pendingImport.assets.length === 1 ? '' : 's'}`
                : pendingImport.name}
            </Text>
            <Text className="text-caption text-lantern-text-secondary mt-1">
              {pendingImport.mode === 'photos'
                ? formatMaxNoteUploadLabel()
                : `${formatFileSize(pendingImport.size)} · ${formatMaxNoteUploadLabel()}`}
            </Text>
            <View className="flex-row gap-2 mt-3">
              <Button
                size="sm"
                loading={importingFile}
                onPress={() => void handleConfirmImport()}
                className="flex-1"
              >
                {/* A Word document is not uploaded anywhere — its text is read
                    and a note is made — so the button does not say Upload. */}
                {pendingImport.mode === 'document' ? 'Import' : 'Upload'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={importingFile}
                onPress={() => setPendingImport(null)}
                className="flex-1"
              >
                Cancel
              </Button>
            </View>
          </Card>
        ) : youtubeOpen ? (
          <Card className="border-lantern-primary/30 mb-2">
            <Text className="text-body font-semibold text-lantern-text">Note from YouTube</Text>
            <Text className="text-caption text-lantern-text-secondary mt-1">
              Paste a video link — we'll fetch its transcript so AI tools can use it.
            </Text>
            <TextInput
              value={youtubeUrl}
              onChangeText={setYoutubeUrl}
              placeholder="https://www.youtube.com/watch?v=…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!importingFile}
              className="mt-2 px-3 py-2 rounded-lg border border-lantern-border bg-lantern-background text-body text-lantern-text"
              placeholderTextColor={colors.inputPlaceholder}
            />
            {youtubeUrl.trim() && !youtubeUrlValid ? (
              <Text className="text-caption text-red-500 mt-1">
                That doesn't look like a YouTube link.
              </Text>
            ) : null}
            <View className="flex-row gap-2 mt-3">
              <Button
                size="sm"
                loading={importingFile}
                disabled={!youtubeUrlValid}
                onPress={() => void handleYoutubeImport()}
                className="flex-1"
              >
                Import
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={importingFile}
                onPress={() => {
                  setYoutubeOpen(false);
                  setYoutubeUrl('');
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </View>
          </Card>
        ) : null}
      </View>
      ) : null}

      {error ? (
        <Pressable
          onPress={() => setError(null)}
          className="mx-4 mb-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800"
        >
          <Text className="text-caption text-red-700 dark:text-red-300">
            {humanizeFailureMessage(error)}
          </Text>
        </Pressable>
      ) : null}

      {isLoading && notes.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primaryText} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          data={filteredNotes}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
          // The search box sits above this list; without this the first tap on
          // a note row is swallowed dismissing the keyboard.
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryText} />
          }
          ListEmptyComponent={
            <Card className="items-center py-10 border-lantern-border">
              <AppIcon
                name={
                  search.trim()
                    ? 'search'
                    : listView === 'archived'
                      ? 'archive'
                      : 'document-text'
                }
                size={40}
                color={brand.text}
              />
              <Text className="text-body text-lantern-text-secondary text-center mt-3 px-4">
                {/* A query that matches nothing is not an empty library:
                    "No notes yet" there reads as if the notes had gone. */}
                {search.trim()
                    ? `Nothing matches “${search.trim()}” in this list. The folder and Mine / Shared / Archived choice above still apply${embedded ? '; “Search everything” also covers your decks, cards and offline bundles' : ''}.`
                  : listView === 'archived'
                    ? 'No archived notes. Long-press a note to archive it.'
                    : listView === 'shared'
                      ? 'No shared notes yet.'
                      : courseFilter
                        ? `No notes in ${courseFilter.label} yet. Create one here, or use “Move to course…” on an existing note.`
                        : 'No notes yet. Create one to get started.'}
              </Text>
              {search.trim() ? null : listView === 'archived' || listView === 'shared' ? (
                <Button className="mt-4" size="sm" variant="secondary" onPress={() => setListView('mine')}>
                  Back to mine
                </Button>
              ) : listView === 'mine' ? (
                <>
                  <Button className="mt-4" size="sm" onPress={handleCreateNote}>
                    New note
                  </Button>
                  <Button className="mt-2" size="sm" variant="secondary" onPress={() => void handlePickFile('pdf')}>
                    Import PDF
                  </Button>
                </>
              ) : null}
            </Card>
          }
          renderItem={({ item }) => {
            const manageable = canManageNote(item);
            const selected = selectedNoteIds.includes(item.id);
            return (
              <NoteCard
                note={item}
                courseCode={item.courseId ? courseCodes[item.courseId] : undefined}
                selectMode={selectMode && manageable}
                selected={selected}
                onPress={() => {
                  if (selectMode) {
                    if (manageable) toggleNoteSelected(item.id);
                    return;
                  }
                  openNoteRow(item);
                }}
                onLongPress={manageable || isSharedNote(item) ? () => handleNoteOptions(item) : undefined}
              />
            );
          }}
        />
      )}
    </Wrapper>
  );
}

export default NotesScreen;
