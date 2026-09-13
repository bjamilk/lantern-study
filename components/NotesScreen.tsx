import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReportContentModal from './moderation/ReportContentModal';
import { markdownToPreviewText } from '@lantern/shared/utils/markdownPreview';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import { parseYoutubeVideoId } from '@lantern/shared/utils/youtube';
import {
  NOTES_LIST_VIEW_OPTIONS,
  noteMatchesListView,
  noteRowMark,
  type NotesListView,
} from '@lantern/shared/learning';
import type { NoteFolder, StudyNote } from '../types';
import {
  ScreenHeader,
  Button,
  EmptyState,
  FeatureDisc,
  FolderNameModal,
  Modal,
  Input,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSeparator,
} from './ui';
import { useUIStore } from '../stores/uiStore';
import { useNotesStore } from '../stores/notesStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useAcademicStore } from '../stores/academicStore';
import { CourseChips, useCourseFilterShownAbove } from './academic/CourseChips';
import { TopicFilterChip } from './academic/TopicFilterChip';
import { useLibraryPanelSearch } from './library/libraryPanelSearch';
import { MoveToCourseModal } from './academic/MoveToCourseModal';
import { useIsMdUp } from '../hooks/useMediaQuery';
import { buildFolderTree, folderParentOptions, folderScopeIds } from '../utils/libraryArchive';
import { confirmDialog } from '../stores/confirmStore';
import { AppIcon } from './ui/AppIcon';
import { CoverMenuItems, CoverPickerDialog, CoverThumb } from './ui/CoverPicker';
import { coverErrorMessage } from './ui/coverPickerModel';
import { removeCover } from '../stores/coverActions';
import { useToastStore } from '../stores/toastStore';

interface NotesScreenProps {
  theme: 'light' | 'dark';
  folders: NoteFolder[];
  notes: StudyNote[];
  isLoading?: boolean;
  error?: string | null;
  onBack?: () => void;
  onCreateNote: () => void;
  /** `parentId` nests the new folder one level under an existing one (note_folders.parent_id). */
  onCreateFolder: (name: string, parentId?: string | null) => void;
  /** "Move to course…" on a note row (PATCH /notes/:id { courseId }); rejections surface in the dialog. */
  onMoveNoteToCourse?: (noteId: string, courseId: string | null, topicId: string | null) => void | Promise<void>;
  /** Bulk "Move to course…" from the selection toolbar. */
  onMoveNotesToCourse?: (noteIds: string[], courseId: string | null, topicId: string | null) => void | Promise<void>;
  onRenameFolder?: (folderId: string, name: string) => void | Promise<void>;
  onDeleteFolder?: (folderId: string) => void | Promise<void>;
  onTogglePinNote?: (noteId: string, isPinned: boolean) => void | Promise<void>;
  onArchiveNote?: (noteId: string, isArchived: boolean) => void | Promise<void>;
  /** Move one or more notes into a folder, or `null` for All notes (unfiled). */
  onMoveNotesToFolder?: (noteIds: string[], folderId: string | null) => void | Promise<void>;
  /** Permanently delete one or more owned notes (same DELETE path as single-note delete). */
  onDeleteNotes?: (noteIds: string[]) => void | Promise<void>;
  onSelectNote: (noteId: string) => void;
  onPdfImport: (file: File) => void;
  onPresentationImport?: (file: File) => void;
  onPhotosImport?: (files: File[]) => void;
  onYoutubeImport?: (url: string) => void;
  selectedFolderId?: string | null;
  onSelectFolder: (folderId: string | null) => void;
  /** When true, hides the page header (used inside Library tabs). */
  embedded?: boolean;
}

const folderButtonClass = (isActive: boolean, compact = false) =>
  `${compact ? 'w-full text-left px-2 py-1.5' : 'shrink-0 px-3 py-1.5'} rounded-full text-caption font-semibold transition-colors ${
    isActive
      ? 'bg-lantern-ink text-lantern-surface'
      : 'text-lantern-text-secondary bg-lantern-surface border border-lantern-border hover:bg-lantern-background-secondary'
  }`;

/**
 * Course chip row (Phase 1): the archive-wide selection lives in the library
 * store (the Library rail sets it too) and is mirrored into
 * notesStore.setCourseFilter, which reloads the list with
 * `GET /notes?courseId=` (`'null'` = unfiled); "All" clears both.
 */
const NotesCourseFilter: React.FC = () => {
  const shownAbove = useCourseFilterShownAbove();
  const courseFilterId = useNotesStore((s) => s.courseFilterId);
  const libraryCourseId = useLibraryStore((s) => s.courseFilterId);
  const libraryTopicId = useLibraryStore((s) => s.topicFilterId);
  const setLibraryCourseFilter = useLibraryStore((s) => s.setCourseFilter);
  // Mirror the archive-wide filter into the notes list on mount and whenever it
  // changes. Both halves are mirrored in one call: the Library rail can move the
  // topic while the course stays put, which setCourseFilter alone reads as a no-op.
  useEffect(() => {
    void useNotesStore.getState().setTopicFilter(libraryCourseId, libraryTopicId);
  }, [libraryCourseId, libraryTopicId]);
  const onChange = useCallback((courseId: string | null) => { setLibraryCourseFilter(courseId); }, [setLibraryCourseFilter]);
  // Leaving the screen drops the notes-store filter so other surfaces see every
  // note again; the library selection itself stays and is re-applied on return.
  useEffect(() => () => { void useNotesStore.getState().setTopicFilter(null, null); }, []);
  // The chips name the course; the topic gets its own chip, or the list is
  // shorter than anything on screen explains. Inside the Library both children
  // render nothing — but `display: contents` rather than an early return,
  // because a box here still collects the parent's `space-y` gap while
  // unmounting CourseChips would take its two effects with it: the one that
  // loads the course list this screen's labels resolve against, and the safety
  // net that drops a filter pointing at a deleted course.
  return (
    <div className={shownAbove ? 'contents' : 'flex flex-col gap-1.5'}>
      <CourseChips value={courseFilterId} onChange={onChange} ariaLabel="Filter notes by course" showUnfiled />
      <TopicFilterChip />
    </div>
  );
};

const NotesScreen: React.FC<NotesScreenProps> = ({
  theme,
  folders,
  notes,
  isLoading,
  error,
  onCreateNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onTogglePinNote,
  onArchiveNote,
  onMoveNotesToFolder,
  onMoveNoteToCourse,
  onMoveNotesToCourse,
  onDeleteNotes,
  onSelectNote,
  onPdfImport,
  onPresentationImport,
  onPhotosImport,
  onYoutubeImport,
  selectedFolderId,
  onSelectFolder,
  embedded = false,
}) => {
  const [ownSearch, setOwnSearch] = useState('');
  // Inside the Library there is one search box — the Library's — and it filters
  // this list rather than replacing the panel, so the folder and Mine/Shared/
  // Archived selection still on screen keeps applying. It is also the
  // only text search that works with the API down, which this app treats as a
  // first-class state (Offline Mode, offline bundles, lowDataMode).
  const panelSearch = useLibraryPanelSearch();
  const search = embedded ? panelSearch : ownSearch;
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<NoteFolder | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [listView, setListView] = useState<NotesListView>('mine');
  // Shared-with-me note being reported (content report to Lantern moderation).
  const [reportNote, setReportNote] = useState<StudyNote | null>(null);
  // The note whose cover the picker is editing. Row menus unmount on select,
  // so the dialog is owned by the screen.
  const [coverNote, setCoverNote] = useState<StudyNote | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movingNotes, setMovingNotes] = useState(false);
  const [deletingNotes, setDeletingNotes] = useState(false);
  const [movingCourse, setMovingCourse] = useState(false);
  /** One note from the row menu, or the current selection. */
  const [courseMoveTarget, setCourseMoveTarget] = useState<{
    noteIds: string[];
    currentCourseId: string | null;
    currentTopicId: string | null;
  } | null>(null);
  /** Parent folders the user collapsed (one-level tree, Phase 1 · B). */
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const canMoveToCourse = Boolean(onMoveNotesToCourse || onMoveNoteToCourse);
  const selectionEnabled = Boolean(onMoveNotesToFolder || onDeleteNotes || canMoveToCourse);
  const selectionBusy = movingNotes || deletingNotes || movingCourse;
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const parentFolderOptions = useMemo(() => folderParentOptions(folders), [folders]);
  const selectedFolder = useMemo(
    () => (selectedFolderId ? folders.find((f) => f.id === selectedFolderId) ?? null : null),
    [folders, selectedFolderId],
  );
  // New-folder default parent: the open folder (or its parent — one level only),
  // but only when that id is actually offered as a parent option.
  const defaultParentId = useMemo(() => {
    if (!selectedFolder) return null;
    const offered = (id: string | undefined | null) => Boolean(id && parentFolderOptions.some((o) => o.id === id));
    if (offered(selectedFolder.parentId)) return selectedFolder.parentId ?? null;
    if (offered(selectedFolder.id)) return selectedFolder.id;
    return null;
  }, [selectedFolder, parentFolderOptions]);
  // Course code badge on note cards; courses load lazily on first use.
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  void knownCourses; // subscribe so badges resolve once courses load
  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  // Mount only one folder surface: CSS-hidden Menus still portal and duplicate.
  const isMdUp = useIsMdUp();
  const youtubeUrlValid = Boolean(parseYoutubeVideoId(youtubeUrl));
  const importProgress = useUIStore((s) => s.importProgress);
  void theme;

  // Crossing the breakpoint swaps which folder buttons exist, so a menu opened
  // from the old set is orphaned — its portal would outlive its trigger.
  useEffect(() => {
    setFolderMenuId(null);
  }, [isMdUp]);

  const openRenameFolderPrompt = (folder: NoteFolder) => {
    // Close the portaled menu first; opening another dialog in the same click
    // often gets swallowed after the menu unmounts / dismiss handlers run.
    setFolderMenuId(null);
    window.setTimeout(() => setRenameFolder(folder), 50);
  };

  const confirmDeleteFolder = (folder: NoteFolder) => {
    setFolderMenuId(null);
    if (!onDeleteFolder) return;
    window.setTimeout(() => {
      void confirmDialog({
        title: 'Delete folder?',
        message: `“${folder.name}” will be removed. Notes inside stay in All notes.`,
        danger: true,
        confirmLabel: 'Delete',
      }).then((ok) => {
        if (ok) void onDeleteFolder(folder.id);
      });
    }, 50);
  };

  const filteredNotes = useMemo(() => {
    let list = notes;
    list = list.filter((note) => noteMatchesListView(note, listView));
    if (selectedFolderId) {
      // A parent folder also shows the notes in its (one level of) subfolders.
      const scope = new Set(folderScopeIds(folders, selectedFolderId));
      list = list.filter(n => Boolean(n.folderId) && scope.has(n.folderId as string));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          // Imported notes (PDF/slides/photos/YouTube) keep their content in
          // attachment text, surfaced by the list endpoint as `searchText`.
          Boolean(n.searchText && n.searchText.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDelta !== 0) return pinDelta;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, folders, selectedFolderId, search, listView]);

  const canManageNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner' || note.accessRole === 'editor';

  const canDeleteNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner';

  // Only notes somebody else shared with me are reportable (never my own).
  const canReportNote = (note: StudyNote) =>
    !!note.accessRole && note.accessRole !== 'owner';

  // Folder placement is a single global column owned by the note's owner, so
  // only the owner may move a note into a folder. Editors would corrupt the
  // owner's organization (see server-side guard in supabaseService.updateNote).
  const canMoveNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner';

  // A cover is the owner's presentation of their own note; the route refuses
  // an editor, so offering it to one would be a menu item that always 403s.
  const canSetNoteCover = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner';

  const handleRemoveNoteCover = async (noteId: string) => {
    try {
      await removeCover('note', noteId);
    } catch (err) {
      useToastStore.getState().showToast(coverErrorMessage(err).message, 'error');
    }
  };

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
    if (!onMoveNotesToFolder || noteIds.length === 0) return;
    setSelectedNoteIds(noteIds);
    setSelectMode(true);
    setNoteMenuId(null);
    setMovePickerOpen(true);
  };

  const handleMoveToFolder = async (folderId: string | null) => {
    if (!onMoveNotesToFolder || selectedNoteIds.length === 0) return;
    // Only owned notes can be moved; silently skip shared ones (mirrors delete).
    const ownedIds = selectedNoteIds.filter((id) => {
      const note = notes.find((n) => n.id === id);
      return note ? canMoveNote(note) : false;
    });
    if (ownedIds.length === 0) {
      void confirmDialog({
        title: 'Cannot move',
        message: "Only notes you own can be moved into folders. Shared notes stay in their owner's folders.",
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    setMovingNotes(true);
    try {
      await onMoveNotesToFolder(ownedIds, folderId);
      exitSelectMode();
    } finally {
      setMovingNotes(false);
    }
  };

  const handleDeleteNotesByIds = (noteIds: string[]) => {
    if (!onDeleteNotes || noteIds.length === 0 || deletingNotes) return;
    const ownedIds = noteIds.filter((id) => {
      const note = notes.find((n) => n.id === id);
      return note ? canDeleteNote(note) : false;
    });
    if (ownedIds.length === 0) {
      void confirmDialog({
        title: 'Cannot delete',
        message: 'Only notes you own can be deleted. Shared notes stay with their owner.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    void confirmDialog({
      title: ownedIds.length === 1 ? 'Delete note' : 'Delete notes',
      message:
        ownedIds.length === 1
          ? 'Delete this note? This cannot be undone.'
          : `Delete ${ownedIds.length} notes? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete',
    }).then(async (ok) => {
      if (!ok) return;
      setDeletingNotes(true);
      try {
        await onDeleteNotes(ownedIds);
        exitSelectMode();
      } finally {
        setDeletingNotes(false);
      }
    });
  };

  const handleDeleteSelected = () => {
    handleDeleteNotesByIds(selectedNoteIds);
  };

  const openCourseMoveForNotes = (noteIds: string[]) => {
    if (!canMoveToCourse || noteIds.length === 0) return;
    const ownedIds = noteIds.filter((id) => {
      const note = notes.find((n) => n.id === id);
      return note ? canMoveNote(note) : false;
    });
    if (ownedIds.length === 0) {
      void confirmDialog({
        title: 'Cannot move',
        message: "Only notes you own can be filed under a course. Shared notes stay in their owner's archive.",
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    const first = notes.find((n) => n.id === ownedIds[0]);
    const sameCourse = ownedIds.every((id) => {
      const note = notes.find((n) => n.id === id);
      return (note?.courseId ?? null) === (first?.courseId ?? null);
    });
    const sameTopic = sameCourse && ownedIds.every((id) => {
      const note = notes.find((n) => n.id === id);
      return (note?.topicId ?? null) === (first?.topicId ?? null);
    });
    setSelectedNoteIds(ownedIds);
    setSelectMode(true);
    setNoteMenuId(null);
    setCourseMoveTarget({
      noteIds: ownedIds,
      currentCourseId: sameCourse ? first?.courseId ?? null : null,
      currentTopicId: sameTopic ? first?.topicId ?? null : null,
    });
  };

  const handleMoveToCourse = async (courseId: string | null, topicId: string | null) => {
    if (!courseMoveTarget || courseMoveTarget.noteIds.length === 0) return;
    const ids = courseMoveTarget.noteIds;
    setMovingCourse(true);
    try {
      if (onMoveNotesToCourse && ids.length > 1) {
        await onMoveNotesToCourse(ids, courseId, topicId);
      } else if (onMoveNoteToCourse) {
        for (const id of ids) {
          await onMoveNoteToCourse(id, courseId, topicId);
        }
      }
      setCourseMoveTarget(null);
      exitSelectMode();
    } finally {
      setMovingCourse(false);
    }
  };

  // The three file pickers live behind one "Import" menu, so the inputs can no
  // longer be the `<label>`s that opened them: a menu item is a button, and the
  // menu unmounts as it closes. Keep them mounted outside it and click them.
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const presentationInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handlePdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onPdfImport(file);
    e.target.value = '';
  };

  const handlePresentation = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onPresentationImport) onPresentationImport(file);
    e.target.value = '';
  };

  const handlePhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onPhotosImport) onPhotosImport(files);
    e.target.value = '';
  };

  const handleYoutubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = youtubeUrl.trim();
    if (!url || !youtubeUrlValid || !onYoutubeImport) return;
    setYoutubeModalOpen(false);
    setYoutubeUrl('');
    onYoutubeImport(url);
  };

  const moreTriggerClass =
    'inline-flex items-center justify-center rounded-full border border-lantern-border bg-lantern-surface p-2 text-lantern-text hover:bg-lantern-background-secondary min-h-[36px] min-w-[36px]';

  const renderMoreMenu = () => (
    <Menu>
      <MenuTrigger aria-label="More note actions" className={moreTriggerClass}>
        <AppIcon name="ellipsis-horizontal" size={18} aria-hidden />
      </MenuTrigger>
      <MenuContent align="end" className="w-52">
        {selectionEnabled ? (
          <MenuItem
            icon={<AppIcon name="checkbox" size={18} aria-hidden />}
            onSelect={() => setSelectMode(true)}
          >
            Select
          </MenuItem>
        ) : null}
        <MenuItem
          icon={<AppIcon name="folder-add" size={18} aria-hidden />}
          onSelect={() => setFolderModalOpen(true)}
        >
          New folder
        </MenuItem>
        <MenuSeparator />
        <MenuSubmenu
          label="Import"
          icon={<AppIcon name="document-upload" size={18} aria-hidden />}
        >
          <MenuItem
            icon={<AppIcon name="document-upload" size={18} aria-hidden />}
            onSelect={() => pdfInputRef.current?.click()}
          >
            PDF
          </MenuItem>
          {onPresentationImport ? (
            <MenuItem
              icon={<AppIcon name="easel" size={18} aria-hidden />}
              onSelect={() => presentationInputRef.current?.click()}
            >
              PowerPoint
            </MenuItem>
          ) : null}
          {onPhotosImport ? (
            <MenuItem
              icon={<AppIcon name="image" size={18} aria-hidden />}
              onSelect={() => photosInputRef.current?.click()}
            >
              Photos
            </MenuItem>
          ) : null}
          {onPhotosImport ? (
            <MenuItem
              icon={<AppIcon name="camera" size={18} aria-hidden />}
              onSelect={() => cameraInputRef.current?.click()}
            >
              Photograph pages
            </MenuItem>
          ) : null}
          {onYoutubeImport ? (
            <MenuItem
              icon={<AppIcon name="play-circle" size={18} aria-hidden />}
              onSelect={() => setYoutubeModalOpen(true)}
            >
              YouTube
            </MenuItem>
          ) : null}
          <p className="px-4 pb-2 pt-1 text-caption text-lantern-text-secondary">
            {formatMaxNoteUploadLabel()}
          </p>
        </MenuSubmenu>
      </MenuContent>
    </Menu>
  );

  const renderPrimaryActions = () => (
    <div className="shrink-0 flex items-center gap-1.5">
      <Button size="sm" onClick={onCreateNote} aria-label="New note">
        <AppIcon name="add" size={16} className="sm:mr-0.5" />
        <span className="hidden sm:inline">New note</span>
      </Button>
      {renderMoreMenu()}
    </div>
  );

  const renderViewSwitch = () => (
    <div
      className="inline-flex w-full sm:w-auto rounded-full border border-lantern-border bg-lantern-surface p-0.5"
      role="tablist"
      aria-label="Notes view"
    >
      {NOTES_LIST_VIEW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={listView === option.id}
          onClick={() => setListView(option.id)}
          className={`flex-1 sm:flex-none rounded-full px-3 py-1.5 text-caption font-semibold transition-colors ${
            listView === option.id
              ? 'bg-lantern-ink text-lantern-surface'
              : 'text-lantern-text-secondary hover:text-lantern-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const renderFolderButton = (
    folder: NoteFolder | null,
    compact = false,
    tree?: { hasChildren?: boolean; expanded?: boolean; onToggle?: () => void; isChild?: boolean },
  ) => {
    const isActive = folder ? selectedFolderId === folder.id : !selectedFolderId;
    const menuOpen = folder ? folderMenuId === folder.id : false;
    return (
      <div key={folder?.id ?? 'all'} className={`${compact ? 'w-full' : 'shrink-0'}`}>
        <div className={`${folderButtonClass(isActive, compact)} flex items-center gap-1.5`}>
          {folder && tree?.hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                tree.onToggle?.();
              }}
              aria-expanded={tree.expanded}
              aria-label={`${tree.expanded ? 'Collapse' : 'Expand'} ${folder.name}`}
              className={`shrink-0 rounded p-0.5 ${isActive ? 'text-white/90 hover:bg-white/15' : 'text-lantern-text-tertiary hover:bg-lantern-background-secondary'}`}
            >
              {tree.expanded ? (
                <AppIcon name="chevron-down" size={14} aria-hidden />
              ) : (
                <AppIcon name="chevron-forward" size={14} aria-hidden />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setFolderMenuId(null);
              onSelectFolder(folder?.id ?? null);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {folder && tree?.isChild && !compact ? (
              <span className="text-lantern-text-tertiary shrink-0" aria-hidden>↳</span>
            ) : null}
            {folder && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: folder.color }}
              />
            )}
            <span className="truncate max-w-[96px] md:max-w-[120px]">
              {folder?.name ?? 'All notes'}
            </span>
          </button>
          {folder && (onRenameFolder || onDeleteFolder) ? (
            // Portaled menu avoids clipping inside the mobile horizontal folder scroller.
            <div
              className="shrink-0"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Menu
                open={menuOpen}
                onOpenChange={(open) => {
                  setNoteMenuId(null);
                  setFolderMenuId(open ? folder.id : null);
                }}
              >
                <MenuTrigger
                  aria-label={`Folder options for ${folder.name}`}
                  className={`rounded-md p-1.5 min-h-[40px] min-w-[40px] inline-flex items-center justify-center ${
                    isActive
                      ? 'text-white/90 hover:bg-white/15'
                      : 'text-lantern-text-tertiary hover:bg-lantern-background-secondary'
                  }`}
                >
                  <AppIcon name="ellipsis-horizontal" size={16} aria-hidden />
                </MenuTrigger>
                <MenuContent align="end" className="w-44">
                  {onRenameFolder ? (
                    <MenuItem onSelect={() => openRenameFolderPrompt(folder)}>
                      Rename
                    </MenuItem>
                  ) : null}
                  {onDeleteFolder ? (
                    <MenuItem
                      destructive
                      onSelect={() => confirmDeleteFolder(folder)}
                    >
                      Delete folder
                    </MenuItem>
                  ) : null}
                </MenuContent>
              </Menu>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${embedded ? '' : 'bg-lantern-background'}`}
      onClick={() => {
        setFolderMenuId(null);
        setNoteMenuId(null);
      }}
    >
      <FolderNameModal
        isOpen={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        onSubmit={(name, parentId) => onCreateFolder(name, parentId ?? null)}
        parentOptions={parentFolderOptions}
        initialParentId={defaultParentId}
      />
      <FolderNameModal
        isOpen={!!renameFolder}
        onClose={() => setRenameFolder(null)}
        title="Rename folder"
        initialName={renameFolder?.name || ''}
        submitLabel="Save"
        onSubmit={(name) => {
          if (renameFolder && onRenameFolder) {
            void onRenameFolder(renameFolder.id, name);
          }
        }}
      />

      <Modal
        isOpen={movePickerOpen}
        onClose={() => {
          if (!selectionBusy) setMovePickerOpen(false);
        }}
        ariaLabelledBy="move-notes-title"
        maxWidthClass="max-w-sm"
      >
        <h2 id="move-notes-title" className="text-heading font-bold text-lantern-text mb-1">
          Move to folder
        </h2>
        <p className="text-body text-lantern-text-secondary mb-4">
          {selectedNoteIds.length === 1
            ? 'Choose a folder for this note.'
            : `Choose a folder for ${selectedNoteIds.length} notes.`}
        </p>
        <div className="space-y-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Folders">
          <button
            type="button"
            role="option"
            disabled={selectionBusy}
            onClick={() => void handleMoveToFolder(null)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-body text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60"
          >
            <AppIcon name="folder" size={16} className="text-lantern-text-secondary shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">All notes</span>
            <span className="text-caption text-lantern-text-tertiary shrink-0">Unfiled</span>
          </button>
          {folderTree.flatMap((node) => [
            { folder: node.folder, isChild: false },
            ...node.children.map((child) => ({ folder: child, isChild: true })),
          ]).map(({ folder, isChild }) => (
            <button
              key={folder.id}
              type="button"
              role="option"
              disabled={selectionBusy}
              onClick={() => void handleMoveToFolder(folder.id)}
              className={`flex w-full items-center gap-2 rounded-lg py-2.5 pr-3 text-left text-body text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60 ${
                isChild ? 'pl-8' : 'pl-3'
              }`}
            >
              {isChild ? <span className="text-lantern-text-tertiary shrink-0" aria-hidden>↳</span> : null}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: folder.color || '#191919' }}
              />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </button>
          ))}
        </div>
        {folders.length === 0 ? (
          <p className="mt-3 text-caption text-lantern-text-secondary">
            No folders yet.{' '}
            <button
              type="button"
              className="font-medium text-lantern-primary underline-offset-2 hover:underline"
              onClick={() => {
                setMovePickerOpen(false);
                setFolderModalOpen(true);
              }}
            >
              Create a folder
            </button>
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={selectionBusy}
            onClick={() => setMovePickerOpen(false)}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
        </div>
      </Modal>

      {canMoveToCourse ? (
        <MoveToCourseModal
          isOpen={Boolean(courseMoveTarget)}
          onClose={() => {
            if (!selectionBusy) setCourseMoveTarget(null);
          }}
          currentCourseId={courseMoveTarget?.currentCourseId ?? null}
          currentTopicId={courseMoveTarget?.currentTopicId ?? null}
          title={
            courseMoveTarget && courseMoveTarget.noteIds.length > 1
              ? `Move ${courseMoveTarget.noteIds.length} notes to course`
              : 'Move to course'
          }
          onSubmit={handleMoveToCourse}
        />
      ) : null}

      <Modal
        isOpen={youtubeModalOpen}
        onClose={() => setYoutubeModalOpen(false)}
        ariaLabelledBy="youtube-import-title"
        maxWidthClass="max-w-sm"
      >
        <h2 id="youtube-import-title" className="text-heading font-bold text-lantern-text mb-1">
          Note from YouTube
        </h2>
        <p className="text-body text-lantern-text-secondary mb-4">
          Paste a video link — we'll fetch its transcript so you can summarize, quiz, and make
          flashcards from it.
        </p>
        <form onSubmit={handleYoutubeSubmit} className="space-y-4">
          <Input
            autoFocus
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="YouTube link"
          />
          {youtubeUrl.trim() && !youtubeUrlValid && (
            <p className="text-caption text-red-500">That doesn't look like a YouTube link.</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setYoutubeModalOpen(false)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!youtubeUrlValid} className="min-h-[44px]">
              Import
            </Button>
          </div>
        </form>
      </Modal>

      {!embedded && (
        <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 pb-2">
          <ScreenHeader
            title="Notes"
            subtitle="Capture lectures and turn notes into study tools"
            className="mb-0 sm:mb-2"
            actions={renderPrimaryActions()}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
        {/* Never inside the Library: it already owns a course rail, and a second
            vertical aside left the note list ~176px of a 768px viewport. Embedded,
            the folder filter moves to the chip strip below. */}
        {isMdUp && !embedded ? (
          <aside className="shrink-0 w-44 border-r border-lantern-border p-2 overflow-y-auto bg-lantern-surface">
            {renderFolderButton(null, true)}
            <div className="mt-1 space-y-1">
              {folderTree.map((node) => {
                const hasChildren = node.children.length > 0;
                const expanded = !collapsedFolderIds.has(node.folder.id);
                return (
                  <div key={node.folder.id} className="space-y-1">
                    {renderFolderButton(node.folder, true, {
                      hasChildren,
                      expanded,
                      onToggle: () => toggleFolderCollapsed(node.folder.id),
                    })}
                    {hasChildren && expanded ? (
                      <div className="ml-3 space-y-1 border-l border-lantern-border/60 pl-1.5">
                        {node.children.map((child) => renderFolderButton(child, true, { isChild: true }))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>
        ) : null}

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-3 sm:space-y-4">
          {/* Folders and the note actions share one line. The strip scrolls
              under a fixed set of buttons instead of pushing them onto a row of
              their own — embedded, that second row was ~50px of a panel that
              starts a third of the way down the viewport.
              The strip shows whenever the aside is hidden (small screens, or any
              width inside the Library), where it is the only route to a folder. */}
          <div className="flex items-center gap-2">
            {renderViewSwitch()}
            {!embedded ? (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-lantern-border min-w-0 flex-1 bg-lantern-surface">
                <AppIcon name="search" size={16} className="text-lantern-text-secondary shrink-0" />
                <input
                  value={ownSearch}
                  onChange={e => setOwnSearch(e.target.value)}
                  placeholder="Search notes..."
                  aria-label="Search notes"
                  className="flex-1 min-w-0 bg-transparent outline-none text-body text-lantern-text"
                />
              </div>
            ) : null}
            {embedded ? <div className="ml-auto">{renderPrimaryActions()}</div> : null}
          </div>

          {!embedded ? (
            <div className="flex sm:hidden items-center gap-2 px-3 py-2 rounded-full border border-lantern-border min-w-0 bg-lantern-surface">
              <AppIcon name="search" size={16} className="text-lantern-text-secondary shrink-0" />
              <input
                value={ownSearch}
                onChange={e => setOwnSearch(e.target.value)}
                placeholder="Search notes..."
                aria-label="Search notes"
                className="flex-1 min-w-0 bg-transparent outline-none text-body text-lantern-text"
              />
            </div>
          ) : null}

          {(!isMdUp || embedded) && folders.length > 0 ? (
            <div className="min-w-0 -mx-1 px-1 overflow-x-auto overflow-y-visible scrollbar-none">
              <div className="flex gap-2 pb-1 w-max max-w-none items-center">
                {selectedFolderId ? renderFolderButton(null) : null}
                {folderTree.map((node) => {
                  const hasChildren = node.children.length > 0;
                  const expanded = !collapsedFolderIds.has(node.folder.id);
                  return (
                    <React.Fragment key={node.folder.id}>
                      {renderFolderButton(node.folder, false, {
                        hasChildren,
                        expanded,
                        onToggle: () => toggleFolderCollapsed(node.folder.id),
                      })}
                      {hasChildren && expanded
                        ? node.children.map((child) => renderFolderButton(child, false, { isChild: true }))
                        : null}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ) : null}

          <NotesCourseFilter />

          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handlePdf}
            disabled={Boolean(importProgress)}
          />
          {onPresentationImport ? (
            <input
              ref={presentationInputRef}
              type="file"
              accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
              className="hidden"
              onChange={handlePresentation}
              disabled={Boolean(importProgress)}
            />
          ) : null}
          {onPhotosImport ? (
            <input
              ref={photosInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotos}
              disabled={Boolean(importProgress)}
            />
          ) : null}
          {onPhotosImport ? (
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotos}
              disabled={Boolean(importProgress)}
            />
          ) : null}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-body text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          {selectMode && selectionEnabled ? (
            <div
              className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2"
              role="toolbar"
              aria-label="Note selection"
            >
              <span className="text-body text-lantern-text">
                {selectedNoteIds.length === 0
                  ? 'Select notes'
                  : `${selectedNoteIds.length} selected`}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {onMoveNotesToFolder || canMoveToCourse ? (
                  <Menu>
                    <MenuTrigger
                      disabled={selectedNoteIds.length === 0 || selectionBusy}
                      aria-label="Move selected notes"
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-4 py-1.5 text-caption font-semibold text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-50"
                    >
                      <AppIcon name="folder" size={16} aria-hidden />
                      Move
                    </MenuTrigger>
                    <MenuContent align="end" className="w-44">
                      {onMoveNotesToFolder ? (
                        <MenuItem
                          icon={<AppIcon name="folder" size={18} aria-hidden />}
                          onSelect={() => setMovePickerOpen(true)}
                        >
                          To folder
                        </MenuItem>
                      ) : null}
                      {canMoveToCourse ? (
                        <MenuItem
                          icon={<AppIcon name="school" size={18} aria-hidden />}
                          onSelect={() => openCourseMoveForNotes(selectedNoteIds)}
                        >
                          To course
                        </MenuItem>
                      ) : null}
                    </MenuContent>
                  </Menu>
                ) : null}
                {onDeleteNotes ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={selectedNoteIds.length === 0 || selectionBusy}
                    onClick={handleDeleteSelected}
                    aria-label="Delete selected notes"
                  >
                    <AppIcon name="trash" size={16} className="sm:mr-1" aria-hidden />
                    Delete
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={exitSelectMode} disabled={selectionBusy}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <p className="text-body text-lantern-text-secondary">Loading notes...</p>
          ) : filteredNotes.length === 0 ? (
            // A query that matches nothing is not an empty library: offering
            // "New note" there reads as if the notes were gone.
            search.trim() ? (
              <EmptyState
                icon={<AppIcon name="search" size={32} />}
                title={`No notes match “${search.trim()}”`}
                description={
                  embedded
                    ? 'This searches the list below the filters, so the folder and Mine / Shared / Archived choice above still apply. “Search everything” looks across your decks, cards and offline bundles too.'
                    : 'Nothing here matches. Try a different word, or clear the folder and view filters above.'
                }
                {...(embedded
                  ? {}
                  : { actionLabel: 'Clear search', onAction: () => setOwnSearch('') })}
              />
            ) : listView === 'archived' ? (
              <EmptyState
                icon={<AppIcon name="archive" size={32} />}
                title="No archived notes"
                description="Archive a note from its menu to hide it from your active list."
                actionLabel="Back to mine"
                onAction={() => setListView('mine')}
              />
            ) : listView === 'shared' ? (
              <EmptyState
                icon={<AppIcon name="people" size={32} />}
                title="No shared notes"
                description="Notes someone shares with you will land here."
                actionLabel="Back to mine"
                onAction={() => setListView('mine')}
              />
            ) : (
              <EmptyState
                compact
                feature="notes"
                illustration="notes-stack"
                title="No notes yet"
                description="Create a note, upload a PDF, or import PowerPoint slides to get started."
                actionLabel="New note"
                onAction={onCreateNote}
                secondaryActionLabel="Import PDF"
                onSecondaryAction={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'application/pdf';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) onPdfImport(file);
                  };
                  input.click();
                }}
              />
            )
          ) : (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 pb-4">
              {filteredNotes.map(note => {
                const menuOpen = noteMenuId === note.id;
                const showMenu =
                  (canManageNote(note) &&
                    (onTogglePinNote || onArchiveNote || onMoveNotesToFolder || onDeleteNotes || canMoveToCourse)) ||
                  canSetNoteCover(note) ||
                  canReportNote(note);
                const isSelected = selectedNoteIds.includes(note.id);
                const selectable = selectMode && canManageNote(note) && selectionEnabled;
                const mark = noteRowMark(note.sourceType);
                const course = resolveCourse(note.courseId);
                return (
                  <div
                    key={note.id}
                    className={`relative text-left p-3 rounded-2xl border bg-lantern-surface min-w-0 ${
                      isSelected
                        ? 'border-lantern-text'
                        : 'border-lantern-border hover:bg-lantern-background-secondary'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (selectable) {
                          toggleNoteSelected(note.id);
                          return;
                        }
                        if (selectMode) return;
                        onSelectNote(note.id);
                      }}
                      aria-pressed={selectable ? isSelected : undefined}
                      aria-label={`${mark.label}. ${note.title || 'Untitled note'}`}
                      className="w-full flex items-start gap-3 text-left min-w-0"
                    >
                      {selectable ? (
                        <span
                          className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-lantern-text bg-lantern-ink text-lantern-surface'
                              : 'border-lantern-border bg-lantern-background'
                          }`}
                          aria-hidden
                        >
                          {isSelected ? <AppIcon name="checkmark" size={14} /> : null}
                        </span>
                      ) : null}
                      {/* The cover takes the tile's place; the mark it replaced
                          comes back as a badge, since the pastel square was the
                          only thing saying what kind of note this is. */}
                      <CoverThumb
                        coverPath={note.coverPath}
                        alt=""
                        badge={<AppIcon name={mark.icon} size={16} />}
                        fallback={
                          <FeatureDisc
                            feature={mark.feature}
                            icon={<AppIcon name={mark.icon} size={20} />}
                            size={40}
                          />
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {note.isPinned ? (
                            <AppIcon
                              name="bookmark"
                              size={14}
                              filled
                              className="shrink-0 text-lantern-text"
                              aria-label="Pinned"
                            />
                          ) : null}
                          <h3 className="truncate text-body font-semibold text-lantern-text">
                            {note.title || 'Untitled note'}
                          </h3>
                          {note.accessRole === 'viewer' || note.accessRole === 'editor' ? (
                            <span className="shrink-0 text-label text-lantern-text-secondary">Shared</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-caption text-lantern-text-secondary line-clamp-2">
                          {markdownToPreviewText(note.summary || note.body) || 'Empty note'}
                        </span>
                        <span className="mt-1 block text-caption text-lantern-text-tertiary">
                          {course?.code ? `${course.code} · ` : ''}
                          Updated {new Date(note.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </button>
                    {showMenu && !selectMode ? (
                      <div className="absolute right-2 top-2">
                        <button
                          type="button"
                          aria-label={`Options for ${note.title}`}
                          aria-expanded={menuOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderMenuId(null);
                            setNoteMenuId(menuOpen ? null : note.id);
                          }}
                          className="rounded-md p-1 text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text"
                        >
                          <AppIcon name="ellipsis-horizontal" size={20} aria-hidden />
                        </button>
                        {menuOpen ? (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-lg border border-lantern-border bg-lantern-surface py-1 shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onMoveNotesToFolder && canMoveNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => openMovePickerForNotes([note.id])}
                              >
                                <AppIcon name="folder" size={16} aria-hidden />
                                Move to folder
                              </button>
                            ) : null}
                            {onMoveNoteToCourse && canMoveNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  window.setTimeout(() => openCourseMoveForNotes([note.id]), 50);
                                }}
                              >
                                <AppIcon name="school" size={16} aria-hidden />
                                Move to course…
                              </button>
                            ) : null}
                            {canSetNoteCover(note) ? (
                              <CoverMenuItems
                                as="button"
                                hasCover={Boolean(note.coverPath)}
                                onChoose={() => {
                                  setNoteMenuId(null);
                                  setCoverNote(note);
                                }}
                                onRemove={() => {
                                  setNoteMenuId(null);
                                  void handleRemoveNoteCover(note.id);
                                }}
                              />
                            ) : null}
                            {onTogglePinNote && canManageNote(note) && !note.isArchived ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  void onTogglePinNote(note.id, !note.isPinned);
                                }}
                              >
                                <AppIcon name="bookmark" size={16} aria-hidden />
                                {note.isPinned ? 'Unpin' : 'Pin'}
                              </button>
                            ) : null}
                            {onArchiveNote && canManageNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  void onArchiveNote(note.id, !note.isArchived);
                                }}
                              >
                                <AppIcon name="archive" size={16} aria-hidden />
                                {note.isArchived ? 'Unarchive' : 'Archive'}
                              </button>
                            ) : null}
                            {canReportNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  window.setTimeout(() => setReportNote(note), 50);
                                }}
                              >
                                <AppIcon name="flag" size={16} aria-hidden />
                                Report…
                              </button>
                            ) : null}
                            {onDeleteNotes && canDeleteNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  window.setTimeout(() => handleDeleteNotesByIds([note.id]), 50);
                                }}
                              >
                                <AppIcon name="trash" size={16} aria-hidden />
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
      {coverNote ? (
        <CoverPickerDialog
          open
          kind="note"
          id={coverNote.id}
          hasCover={Boolean(coverNote.coverPath)}
          onClose={() => setCoverNote(null)}
        />
      ) : null}
      {reportNote ? (
        <ReportContentModal
          isOpen={!!reportNote}
          onClose={() => setReportNote(null)}
          targetType="note"
          targetId={reportNote.id}
          targetLabel={reportNote.title}
        />
      ) : null}
    </div>
  );
};

export default NotesScreen;
