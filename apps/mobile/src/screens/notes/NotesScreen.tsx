import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import {
  assertNoteUploadSize,
  formatFileSize,
  formatMaxNoteUploadLabel,
} from '@lantern/shared/utils/noteUpload';
import { markdownToPreviewText } from '@lantern/shared/utils/markdownPreview';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { parseYoutubeVideoId } from '@lantern/shared/utils/youtube';
import { useNotesStore } from '../../stores/notesStore';
import type { NoteFolder, StudyNote } from '../../services/notes';
import {
  createNoteFromYoutube,
  uploadNotePdfViaApi,
  uploadPresentationViaApi,
  uploadNoteImagesViaApi,
} from '../../services/notes';
import { trackNoteCreated } from '../../services/productAnalytics';
import { ActionSheet, Button, Card, ScreenHeader, type ActionSheetItem } from '../../components/ui';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { courseHasTopics } from '../../services/academic';
import { useUIStore } from '../../stores/uiStore';
import { matchesCourseFilter, matchesTopicFilter, UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import type { Course, CourseTopic } from '@lantern/shared/types';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import { confirmSheet } from '../../stores/confirmStore';
import { useTheme } from '../../theme';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import * as ImagePicker from 'expo-image-picker';

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
      mode: 'pdf' | 'presentation';
    }
  | {
      mode: 'photos';
      assets: PendingPhotoAsset[];
    };

function sourceBadge(note: StudyNote): string {
  if (note.sourceType === 'youtube') return 'YouTube';
  if (note.sourceType === 'pdf') return 'PDF';
  if (note.sourceType === 'presentation') return 'Slides';
  if (note.sourceType === 'photos') return 'Photos';
  if (note.sourceType === 'audio') return 'Audio';
  return 'Note';
}

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
          ? 'bg-lantern-primary'
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
        {folder.color ? (
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />
        ) : null}
        <Text
          className={`text-sm font-semibold ${
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
          <Ionicons
            name="ellipsis-horizontal"
            size={16}
            color={isActive ? '#ffffff' : '#64748b'}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function NoteCard({
  note,
  onPress,
  onLongPress,
  selectMode,
  selected,
}: {
  note: StudyNote;
  onPress: () => void;
  onLongPress?: () => void;
  selectMode?: boolean;
  selected?: boolean;
}) {
  const isShared = note.accessRole && note.accessRole !== 'owner';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="mb-3 active:opacity-90"
      accessibilityState={selectMode ? { selected: Boolean(selected) } : undefined}
    >
      <Card className={selected ? 'border-lantern-primary' : 'border-lantern-border'}>
        <View className="flex-row items-start justify-between gap-2 mb-2">
          <View className="flex-1 flex-row items-start gap-1.5 min-w-0">
            {selectMode ? (
              <Ionicons
                name={selected ? 'checkbox' : 'square-outline'}
                size={20}
                color={selected ? '#6366f1' : '#94a3b8'}
                style={{ marginTop: 1 }}
              />
            ) : null}
            {note.isPinned ? (
              <Ionicons name="bookmark" size={16} color="#6366f1" style={{ marginTop: 2 }} />
            ) : null}
            <Text className="flex-1 text-base font-semibold text-lantern-text" numberOfLines={2}>
              {note.title}
            </Text>
          </View>
          <View className="bg-lantern-primary-background px-2 py-0.5 rounded-full shrink-0">
            <Text className="text-[10px] font-semibold text-lantern-primary">
              {sourceBadge(note)}
            </Text>
          </View>
        </View>
        {isShared ? (
          <View className="flex-row items-center gap-1 mb-2">
            <Ionicons name="people-outline" size={13} color="#6366f1" />
            <Text className="text-xs text-lantern-text-secondary">
              Shared by {note.owner?.name || note.owner?.username || 'another member'} · {note.accessRole}
            </Text>
          </View>
        ) : (
          <Text className="text-xs text-lantern-text-tertiary mb-2">Mine</Text>
        )}
        <Text className="text-sm text-lantern-text-secondary" numberOfLines={3}>
          {markdownToPreviewText(note.summary || note.body) || 'Empty note'}
        </Text>
        {note.updatedAt ? (
          <Text className="text-xs text-lantern-text-tertiary mt-3">
            Updated {new Date(note.updatedAt).toLocaleDateString()}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

export function NotesScreen({ navigation, embedded = false, listQuery = '' }: Props) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(embedded ? 16 : 8);
  const { onScroll: chromeOnScroll } = useChrome();
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
  } = useNotesStore();
  // Library archive: course filter picked in the Library tree (uuid or 'null' = unfiled).
  const courseFilter = useUIStore((s) => s.libraryCourseFilter);
  const setCourseFilter = useUIStore((s) => s.setLibraryCourseFilter);
  const courseFilterId = courseFilter?.id ?? null;
  /** Topic inside that course (Phase 1 · A); only meaningful with a real course. */
  const topicFilterId = courseFilter?.topicId ?? null;
  /** New notes are filed under the active course filter (never under "Unfiled"). */
  const defaultCourseId =
    courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? courseFilterId : undefined;

  const [ownSearch, setOwnSearch] = useState('');
  // One box per screen: the Library's when embedded, this screen's otherwise.
  const search = embedded ? listQuery : ownSearch;
  const [refreshing, setRefreshing] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  /** The import menu; the four entry points used to sit inline above the list. */
  const [importOpen, setImportOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState<'mine' | 'shared'>('mine');
  const [listFilter, setListFilter] = useState<'active' | 'archived'>('active');
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
    list = list.filter((note) =>
      ownershipFilter === 'mine' ? !note.accessRole || note.accessRole === 'owner' : note.accessRole !== 'owner'
    );
    list = list.filter((note) =>
      listFilter === 'archived' ? Boolean(note.isArchived) : !note.isArchived,
    );
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
  }, [notes, selectedFolderId, search, ownershipFilter, listFilter, courseFilterId, topicFilterId]);

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
      Alert.alert('Could not move notes', e instanceof Error ? e.message : 'Try again.');
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
      Alert.alert(
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
      Alert.alert('Could not delete notes', e instanceof Error ? e.message : 'Try again.');
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
        Alert.alert(
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
        Alert.alert(
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

  const noteActionItems: ActionSheetItem[] = noteActions
    ? [
        ...(canManageNote(noteActions) ? ([
        {
          section: 'Organise',
          label: 'Move to folder',
          icon: 'folder-outline',
          // Let the sheet dismiss before the next modal mounts.
          onPress: () => setTimeout(() => openMovePickerForNotes([noteActions.id]), 50),
        },
        {
          section: 'Organise',
          label: 'Move to course…',
          icon: 'school-outline',
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
                icon: 'list-outline' as ActionSheetItem['icon'],
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
          icon: 'checkbox-outline',
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
                icon: (noteActions.isPinned ? 'bookmark' : 'bookmark-outline') as ActionSheetItem['icon'],
                onPress: () => {
                  void saveNote(noteActions.id, { isPinned: !noteActions.isPinned }).catch((e: unknown) => {
                    Alert.alert('Could not update pin', e instanceof Error ? e.message : 'Try again.');
                  });
                },
              },
            ]
          : []),
        {
          section: 'Note',
          label: noteActions.isArchived ? 'Unarchive' : 'Archive',
          icon: 'archive-outline',
          onPress: () => {
            void saveNote(noteActions.id, { isArchived: !noteActions.isArchived }).catch((e: unknown) => {
              Alert.alert('Could not update archive', e instanceof Error ? e.message : 'Try again.');
            });
          },
        },
        ...(canDeleteNote(noteActions)
          ? [
              {
                section: 'Note',
                label: 'Delete',
                icon: 'trash-outline' as ActionSheetItem['icon'],
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
                icon: 'flag-outline' as ActionSheetItem['icon'],
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
      Alert.alert('Could not rename', e instanceof Error ? e.message : 'Try again.');
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
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
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

    Alert.alert(folder.name, 'Manage this folder. Notes stay in All notes if you delete it.', [
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
    Alert.alert('Import photos', 'Choose a source', [
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
      icon: 'document-outline',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: () => void handlePickFile('pdf'),
    },
    {
      label: 'Import PowerPoint',
      icon: 'easel-outline',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: () => void handlePickFile('presentation'),
    },
    {
      label: 'Import photos',
      icon: 'images-outline',
      section: `From a file · ${formatMaxNoteUploadLabel()}`,
      onPress: handlePickPhotos,
    },
    {
      label: 'Photograph pages',
      icon: 'camera-outline',
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
      <Modal
        visible={!!renameFolder}
        transparent
        animationType="fade"
        onRequestClose={() => !renamingFolder && setRenameFolder(null)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-center px-6"
          onPress={() => !renamingFolder && setRenameFolder(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation?.()}>
            <Card className="border-0 shadow-lg">
              <Text className="text-lg font-bold text-lantern-text mb-3">Rename folder</Text>
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
      </Modal>

      <ActionSheet
        visible={!!noteActions}
        title={noteActions?.title || 'Note'}
        items={noteActionItems}
        onClose={() => setNoteActions(null)}
      />
      <ActionSheet
        visible={importOpen}
        title="Import a note"
        items={importActionItems}
        onClose={() => setImportOpen(false)}
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
              <Text className="text-lg font-bold text-lantern-text mb-1">Move to folder</Text>
              <Text className="text-sm text-lantern-text-secondary mb-3">
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
                  <Ionicons name="folder-outline" size={18} color="#64748b" />
                  <Text className="flex-1 text-sm font-medium text-lantern-text">All notes</Text>
                  <Text className="text-xs text-lantern-text-tertiary">Unfiled</Text>
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
                      style={{ backgroundColor: folder.color || '#6366f1' }}
                    />
                    <Text className="flex-1 text-sm font-medium text-lantern-text" numberOfLines={1}>
                      {folder.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {folders.length === 0 ? (
                <Text className="text-xs text-lantern-text-secondary mt-3">
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
      <View className="flex-row flex-wrap gap-1.5 justify-end px-4 pt-2 pb-1">
        <Button
          size="sm"
          variant="secondary"
          onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          {selectMode ? 'Cancel' : 'Select'}
        </Button>
        <Button size="sm" variant="secondary" onPress={handleCreateFolder}>
          Folder
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={importingFile}
          onPress={() => setImportOpen(true)}
        >
          Import
        </Button>
        <Button size="sm" onPress={handleCreateNote}>
          + Note
        </Button>
      </View>

      {selectMode ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2">
          <Text className="flex-1 text-sm text-lantern-text">
            {selectedNoteIds.length === 0
              ? 'Select notes'
              : `${selectedNoteIds.length} selected`}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedNoteIds.length === 0 || selectionBusy}
            loading={movingNotes}
            onPress={() => setMovePickerOpen(true)}
          >
            Move
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedNoteIds.length === 0 || selectionBusy}
            loading={movingCourse}
            onPress={() => setCourseMoveTarget({ noteIds: selectedNoteIds, currentCourseId: null })}
          >
            Course
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
        </View>
      ) : null}

      <View className="px-4 mb-1.5 flex-row items-center gap-1.5">
        <Pressable
          onPress={() => setSelectedFolderId(null)}
          className={`shrink-0 px-2.5 py-2 rounded-lg ${
            !selectedFolderId
              ? 'bg-lantern-primary'
              : 'bg-lantern-surface border border-lantern-border'
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              !selectedFolderId ? 'text-white' : 'text-lantern-text'
            }`}
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

      {courseFilter && !embedded ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2">
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
          {/* The topic narrows the list further, so it gets its own chip:
              the course chip alone makes a shorter list look like missing notes. */}
          {courseFilter.topicId ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary">
              <Ionicons name="bookmark-outline" size={13} color={colors.textSecondary} />
              <Text className="text-xs font-medium text-lantern-text-secondary" numberOfLines={1}>
                {courseFilter.topicId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : courseFilter.topicLabel || COURSE_TOPIC_COPY.filterLabel}
              </Text>
              <Pressable
                // Clear the topic, keep the course.
                onPress={() => setCourseFilter({ id: courseFilter.id, label: courseFilter.label })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear topic filter"
              >
                <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Two binary switches on one row: stacked, they spent 92px of an 844px
          screen on four words. */}
      <View className="mx-4 mb-2 flex-row items-center gap-2">
        <View className="flex-1 flex-row rounded-lg border border-lantern-border overflow-hidden">
          {(['mine', 'shared'] as const).map((filter) => (
            <Pressable
              key={filter}
              onPress={() => setOwnershipFilter(filter)}
              className={`flex-1 min-h-[44px] items-center justify-center ${
                ownershipFilter === filter ? 'bg-lantern-primary' : 'bg-lantern-surface'
              }`}
              accessibilityRole="button"
              accessibilityState={{ selected: ownershipFilter === filter }}
              accessibilityLabel={filter === 'mine' ? 'Show notes I own' : 'Show notes shared with me'}
            >
              <Text
                className={`text-sm font-semibold ${
                  ownershipFilter === filter ? 'text-white' : 'text-lantern-text'
                }`}
              >
                {filter === 'mine' ? 'Mine' : 'Shared'}
              </Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-1 flex-row rounded-lg border border-lantern-border overflow-hidden">
          {(['active', 'archived'] as const).map((filter) => (
            <Pressable
              key={filter}
              onPress={() => setListFilter(filter)}
              className={`flex-1 min-h-[44px] flex-row items-center justify-center gap-1 ${
                listFilter === filter ? 'bg-lantern-primary' : 'bg-lantern-surface'
              }`}
              accessibilityRole="button"
              accessibilityState={{ selected: listFilter === filter }}
              accessibilityLabel={filter === 'active' ? 'Show active notes' : 'Show archived notes'}
            >
              {filter === 'archived' ? (
                <Ionicons
                  name="archive-outline"
                  size={14}
                  color={listFilter === filter ? '#ffffff' : colors.textSecondary}
                />
              ) : null}
              <Text
                className={`text-sm font-semibold ${
                  listFilter === filter ? 'text-white' : 'text-lantern-text'
                }`}
                numberOfLines={1}
              >
                {filter === 'active' ? 'Active' : 'Archived'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Embedded, the Library's box drives this list instead (`listQuery`), so
          a second input here would be two boxes for one intent. */}
      {!embedded ? (
        <View className="mx-4 mb-1.5 flex-row items-center gap-2 px-3 py-1.5 rounded-lg border border-lantern-border bg-lantern-surface min-h-[44px]">
          <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
          <TextInput
            value={ownSearch}
            onChangeText={setOwnSearch}
            placeholder="Search notes..."
            className="flex-1 text-sm text-lantern-text py-0.5"
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
            <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
              {pendingImport.mode === 'photos'
                ? `${pendingImport.assets.length} photo${pendingImport.assets.length === 1 ? '' : 's'}`
                : pendingImport.name}
            </Text>
            <Text className="text-xs text-lantern-text-secondary mt-1">
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
                Upload
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
            <Text className="text-sm font-semibold text-lantern-text">Note from YouTube</Text>
            <Text className="text-xs text-lantern-text-secondary mt-1">
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
              className="mt-2 px-3 py-2 rounded-lg border border-lantern-border bg-lantern-background text-sm text-lantern-text"
              placeholderTextColor={colors.inputPlaceholder}
            />
            {youtubeUrl.trim() && !youtubeUrlValid ? (
              <Text className="text-xs text-red-500 mt-1">
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
          <Text className="text-xs text-red-700 dark:text-red-300">{error}</Text>
        </Pressable>
      ) : null}

      {isLoading && notes.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          data={filteredNotes}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Card className="items-center py-10 border-lantern-border">
              <Ionicons
                name={
                  search.trim()
                    ? 'search-outline'
                    : listFilter === 'archived'
                      ? 'archive-outline'
                      : 'document-text-outline'
                }
                size={40}
                color="#818cf8"
              />
              <Text className="text-sm text-lantern-text-secondary text-center mt-3 px-4">
                {/* A query that matches nothing is not an empty library:
                    "No notes yet" there reads as if the notes had gone. */}
                {search.trim()
                  ? `Nothing matches “${search.trim()}” in this list. The folder, Mine/Shared and Archived choices above still apply${embedded ? '; “Search everything” also covers your decks, cards and offline bundles' : ''}.`
                  : listFilter === 'archived'
                    ? 'No archived notes. Long-press a note to archive it.'
                    : ownershipFilter === 'shared'
                      ? 'No shared notes yet.'
                      : courseFilter
                        ? `No notes in ${courseFilter.label} yet. Create one here, or use “Move to course…” on an existing note.`
                        : 'No notes yet. Create one to get started.'}
              </Text>
              {search.trim() ? null : listFilter === 'archived' ? (
                <Button className="mt-4" size="sm" variant="secondary" onPress={() => setListFilter('active')}>
                  Back to active
                </Button>
              ) : ownershipFilter === 'mine' ? (
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
                selectMode={selectMode && manageable}
                selected={selected}
                onPress={() => {
                  if (selectMode) {
                    if (manageable) toggleNoteSelected(item.id);
                    return;
                  }
                  navigation.navigate('NoteEditor', { noteId: item.id });
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
