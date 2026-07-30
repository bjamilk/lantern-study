import React, { useEffect, useMemo, useState } from 'react';
import {
  PlusIcon,
  FolderPlusIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  DocumentArrowUpIcon,
  PlayCircleIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  XMarkIcon,
  EllipsisHorizontalIcon,
  BookmarkIcon,
  ArchiveBoxIcon,
  CheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import { parseYoutubeVideoId } from '@lantern/shared/utils/youtube';
import type { NoteFolder, StudyNote } from '../types';
import {
  ScreenHeader,
  Button,
  EmptyState,
  FolderNameModal,
  Modal,
  Input,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
} from './ui';
import { useUIStore } from '../stores/uiStore';
import { useNoteUploadStore, getVisibleUploadJobs } from '../stores/noteUploadStore';
import { confirmDialog } from '../stores/confirmStore';

interface NotesScreenProps {
  theme: 'light' | 'dark';
  folders: NoteFolder[];
  notes: StudyNote[];
  isLoading?: boolean;
  error?: string | null;
  onBack?: () => void;
  onCreateNote: () => void;
  onCreateFolder: (name: string) => void;
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
  `${compact ? 'w-full text-left px-2 py-1.5' : 'shrink-0 px-3 py-1.5'} rounded-lg text-xs sm:text-sm font-medium transition-colors ${
    isActive
      ? 'bg-lantern-primary text-white'
      : 'text-lantern-text-secondary bg-lantern-surface border border-lantern-border hover:bg-lantern-background-secondary'
  }`;

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
  const [search, setSearch] = useState('');
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<NoteFolder | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [accessFilter, setAccessFilter] = useState<'mine' | 'shared'>('mine');
  const [listFilter, setListFilter] = useState<'active' | 'archived'>('active');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movingNotes, setMovingNotes] = useState(false);
  const [deletingNotes, setDeletingNotes] = useState(false);
  const selectionEnabled = Boolean(onMoveNotesToFolder || onDeleteNotes);
  const selectionBusy = movingNotes || deletingNotes;
  // Mount only one folder surface: CSS-hidden Menus still portal and duplicate.
  const [isMdUp, setIsMdUp] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  const youtubeUrlValid = Boolean(parseYoutubeVideoId(youtubeUrl));
  const importProgress = useUIStore((s) => s.importProgress);
  const uploadJobList = useNoteUploadStore((s) => s.jobs);
  const uploadJobs = useMemo(() => getVisibleUploadJobs(uploadJobList), [uploadJobList]);
  const dismissUploadJob = useNoteUploadStore((s) => s.dismissJob);
  const isDark = theme === 'dark';

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setIsMdUp(mq.matches);
      setFolderMenuId(null);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
    list = list.filter((note) =>
      accessFilter === 'mine' ? (note.accessRole === 'owner' || !note.accessRole) : note.accessRole === 'viewer' || note.accessRole === 'editor'
    );
    list = list.filter((note) =>
      listFilter === 'archived' ? Boolean(note.isArchived) : !note.isArchived,
    );
    if (selectedFolderId) list = list.filter(n => n.folderId === selectedFolderId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDelta !== 0) return pinDelta;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, selectedFolderId, search, accessFilter, listFilter]);

  const canManageNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner' || note.accessRole === 'editor';

  const canDeleteNote = (note: StudyNote) =>
    !note.accessRole || note.accessRole === 'owner';

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
    setMovingNotes(true);
    try {
      await onMoveNotesToFolder(selectedNoteIds, folderId);
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

  const sourceBadge = (note: StudyNote) => {
    if (note.sourceType === 'youtube') return 'YouTube';
    if (note.sourceType === 'pdf') return 'PDF';
    if (note.sourceType === 'presentation') return 'Slides';
    if (note.sourceType === 'photos') return 'Photos';
    if (note.sourceType === 'audio') return 'Audio';
    return 'Note';
  };

  const renderFolderButton = (folder: NoteFolder | null, compact = false) => {
    const isActive = folder ? selectedFolderId === folder.id : !selectedFolderId;
    const menuOpen = folder ? folderMenuId === folder.id : false;
    return (
      <div key={folder?.id ?? 'all'} className={`${compact ? 'w-full' : 'shrink-0'}`}>
        <div className={`${folderButtonClass(isActive, compact)} flex items-center gap-1.5`}>
          <button
            type="button"
            onClick={() => {
              setFolderMenuId(null);
              onSelectFolder(folder?.id ?? null);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
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
                  <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden />
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
        onSubmit={onCreateFolder}
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
        <h2 id="move-notes-title" className="text-lg font-bold text-lantern-text mb-1">
          Move to folder
        </h2>
        <p className="text-sm text-lantern-text-secondary mb-4">
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
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60"
          >
            <FolderIcon className="h-4 w-4 text-lantern-text-secondary shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">All notes</span>
            <span className="text-xs text-lantern-text-tertiary shrink-0">Unfiled</span>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="option"
              disabled={selectionBusy}
              onClick={() => void handleMoveToFolder(folder.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-60"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: folder.color || '#6366f1' }}
              />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </button>
          ))}
        </div>
        {folders.length === 0 ? (
          <p className="mt-3 text-xs text-lantern-text-secondary">
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

      <Modal
        isOpen={youtubeModalOpen}
        onClose={() => setYoutubeModalOpen(false)}
        ariaLabelledBy="youtube-import-title"
        maxWidthClass="max-w-sm"
      >
        <h2 id="youtube-import-title" className="text-lg font-bold text-lantern-text mb-1">
          Note from YouTube
        </h2>
        <p className="text-sm text-lantern-text-secondary mb-4">
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
            <p className="text-xs text-red-500">That doesn't look like a YouTube link.</p>
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
            actions={
              <div className="flex gap-1.5 sm:gap-2">
                {selectionEnabled ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                    aria-pressed={selectMode}
                    aria-label={selectMode ? 'Cancel selection' : 'Select notes'}
                  >
                    {selectMode ? 'Cancel' : 'Select'}
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => setFolderModalOpen(true)} aria-label="New folder">
                  <FolderPlusIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Folder</span>
                </Button>
                <Button size="sm" onClick={onCreateNote} aria-label="New note">
                  <PlusIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">New note</span>
                </Button>
              </div>
            }
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
        {isMdUp ? (
          <aside className="shrink-0 w-44 border-r border-lantern-border p-2 overflow-y-auto bg-lantern-surface">
            {renderFolderButton(null, true)}
            <div className="mt-1 space-y-1">
              {folders.map(folder => renderFolderButton(folder, true))}
            </div>
          </aside>
        ) : null}

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-3 sm:space-y-4">
          {embedded && (
            <div className="flex gap-1.5 sm:gap-2 justify-end">
              {selectionEnabled ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  aria-pressed={selectMode}
                >
                  {selectMode ? 'Cancel' : 'Select'}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setFolderModalOpen(true)}>
                <FolderPlusIcon className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Folder</span>
              </Button>
              <Button size="sm" onClick={onCreateNote}>
                <PlusIcon className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">New note</span>
              </Button>
            </div>
          )}

          {!isMdUp ? (
            <div className="-mx-1 px-1 overflow-x-auto overflow-y-visible scrollbar-none">
              <div className="flex gap-2 pb-1 w-max max-w-none items-center">
                {renderFolderButton(null)}
                {folders.map(folder => renderFolderButton(folder))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
            <div className="inline-flex w-full sm:w-auto rounded-lg border border-lantern-border bg-lantern-surface p-1">
              {(['mine', 'shared'] as const).map((filter) => (
                <button key={filter} type="button" onClick={() => setAccessFilter(filter)} className={`flex-1 sm:flex-none rounded-md px-3 py-1.5 text-sm font-medium ${accessFilter === filter ? 'bg-lantern-primary text-white' : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'}`}>
                  {filter === 'mine' ? 'Mine' : 'Shared'}
                </button>
              ))}
            </div>
            <div className="inline-flex w-full sm:w-auto rounded-lg border border-lantern-border bg-lantern-surface p-1">
              {(['active', 'archived'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setListFilter(filter)}
                  className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                    listFilter === filter
                      ? 'bg-lantern-primary text-white'
                      : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
                  }`}
                >
                  {filter === 'archived' ? (
                    <ArchiveBoxIcon className="h-4 w-4" aria-hidden />
                  ) : null}
                  {filter === 'active' ? 'Active' : 'Archived'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-lantern-border min-w-0 w-full sm:flex-1 sm:min-w-[200px] bg-lantern-surface">
              <MagnifyingGlassIcon className="w-5 h-5 text-lantern-text-secondary shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search notes..."
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-lantern-text"
              />
            </div>
            <p className="text-xs text-lantern-text-secondary w-full sm:w-auto sm:self-center">
              {formatMaxNoteUploadLabel()}
            </p>
            <label className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto border-lantern-border ${
              importProgress
                ? 'bg-lantern-background-secondary text-lantern-text-secondary cursor-not-allowed opacity-60'
                : 'bg-lantern-surface text-lantern-text cursor-pointer hover:bg-lantern-background-secondary'
            }`}>
              <DocumentArrowUpIcon className="w-5 h-5" />
              Import PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handlePdf} disabled={Boolean(importProgress)} />
            </label>
            {onPresentationImport && (
              <label className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto border-lantern-border ${
                importProgress
                  ? 'bg-lantern-background-secondary text-lantern-text-secondary cursor-not-allowed opacity-60'
                  : 'bg-lantern-surface text-lantern-text cursor-pointer hover:bg-lantern-background-secondary'
              }`}>
                <DocumentArrowUpIcon className="w-5 h-5" />
                Import PowerPoint
                <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={handlePresentation} disabled={Boolean(importProgress)} />
              </label>
            )}
            {onPhotosImport && (
              <label className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto border-lantern-border ${
                importProgress
                  ? 'bg-lantern-background-secondary text-lantern-text-secondary cursor-not-allowed opacity-60'
                  : 'bg-lantern-surface text-lantern-text cursor-pointer hover:bg-lantern-background-secondary'
              }`}>
                <DocumentArrowUpIcon className="w-5 h-5" />
                Import photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotos} disabled={Boolean(importProgress)} />
              </label>
            )}
            {onYoutubeImport && (
              <button
                type="button"
                onClick={() => setYoutubeModalOpen(true)}
                disabled={Boolean(importProgress)}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto border-lantern-border ${
                  importProgress
                    ? 'bg-lantern-background-secondary text-lantern-text-secondary cursor-not-allowed opacity-60'
                    : 'bg-lantern-surface text-lantern-text cursor-pointer hover:bg-lantern-background-secondary'
                }`}
              >
                <PlayCircleIcon className="w-5 h-5" />
                From YouTube
              </button>
            )}
          </div>

          {uploadJobs.length > 0 && (
            <div className="space-y-2" role="status" aria-live="polite">
              {uploadJobs.map((job) => (
                <div
                  key={job.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                    job.status === 'failed'
                      ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
                      : job.status === 'complete'
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                        : 'border-lantern-primary/40 bg-lantern-primary-background'
                  }`}
                >
                  {job.status === 'failed' ? (
                    <ExclamationCircleIcon className="w-5 h-5 text-red-500 shrink-0" />
                  ) : job.status === 'complete' ? (
                    <CheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : (
                    <ArrowPathIcon className="w-5 h-5 text-lantern-primary shrink-0 animate-spin" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-lantern-text">{job.label}</p>
                    <p className="text-xs truncate text-lantern-text-secondary">
                      {job.fileName}
                      {job.error ? ` — ${job.error}` : ''}
                    </p>
                  </div>
                  {(job.status === 'complete' || job.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => dismissUploadJob(job.id)}
                      className="shrink-0 p-1 rounded text-lantern-text-secondary hover:text-lantern-text"
                      aria-label="Dismiss"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          {selectMode && selectionEnabled ? (
            <div
              className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2"
              role="toolbar"
              aria-label="Note selection"
            >
              <span className="text-sm text-lantern-text">
                {selectedNoteIds.length === 0
                  ? 'Select notes'
                  : `${selectedNoteIds.length} selected`}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {onMoveNotesToFolder ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={selectedNoteIds.length === 0 || selectionBusy}
                    onClick={() => setMovePickerOpen(true)}
                  >
                    <FolderIcon className="w-4 h-4 sm:mr-1" aria-hidden />
                    Move to folder
                  </Button>
                ) : null}
                {onDeleteNotes ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={selectedNoteIds.length === 0 || selectionBusy}
                    onClick={handleDeleteSelected}
                    aria-label="Delete selected notes"
                  >
                    <TrashIcon className="w-4 h-4 sm:mr-1" aria-hidden />
                    Delete
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={exitSelectMode} disabled={selectionBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <p className="text-sm text-lantern-text-secondary">Loading notes...</p>
          ) : filteredNotes.length === 0 ? (
            listFilter === 'archived' ? (
              <EmptyState
                icon={<ArchiveBoxIcon className="w-8 h-8" />}
                title="No archived notes"
                description="Archive a note from its menu to hide it from your active list."
                actionLabel="Back to active"
                onAction={() => setListFilter('active')}
              />
            ) : (
              <EmptyState
                icon={<DocumentTextIcon className="w-8 h-8" />}
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
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 pb-4">
              {filteredNotes.map(note => {
                const menuOpen = noteMenuId === note.id;
                const showMenu =
                  canManageNote(note) &&
                  (onTogglePinNote || onArchiveNote || onMoveNotesToFolder || onDeleteNotes);
                const isSelected = selectedNoteIds.includes(note.id);
                const selectable = selectMode && canManageNote(note) && selectionEnabled;
                return (
                  <div
                    key={note.id}
                    className={`relative text-left p-3 sm:p-4 rounded-xl border bg-lantern-surface transition hover:shadow-md min-w-0 ${
                      isSelected
                        ? 'border-lantern-primary ring-1 ring-lantern-primary/40'
                        : 'border-lantern-border hover:border-lantern-primary'
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
                      className={`w-full text-left min-w-0 ${showMenu && !selectMode ? 'pr-8' : ''} ${
                        selectable ? 'pl-8' : ''
                      }`}
                    >
                      {selectable ? (
                        <span
                          className={`absolute left-3 top-3.5 flex h-5 w-5 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-lantern-primary bg-lantern-primary text-white'
                              : 'border-lantern-border bg-lantern-background'
                          }`}
                          aria-hidden
                        >
                          {isSelected ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                        </span>
                      ) : null}
                      <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                        <h3 className="font-semibold line-clamp-2 sm:line-clamp-1 min-w-0 text-lantern-text inline-flex items-center gap-1.5">
                          {note.isPinned ? (
                            <BookmarkSolidIcon
                              className="h-4 w-4 shrink-0 text-lantern-primary"
                              aria-label="Pinned"
                            />
                          ) : null}
                          {note.title}
                        </h3>
                        <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-lantern-primary-background text-lantern-primary shrink-0">
                          {sourceBadge(note)}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-3 text-lantern-text-secondary">
                        {note.summary || note.body || 'Empty note'}
                      </p>
                      {note.accessRole === 'viewer' || note.accessRole === 'editor' ? (
                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <span className="text-lantern-text-secondary">Owner: {note.owner?.name || note.owner?.username || 'Unknown'}</span>
                          <span className="rounded-full bg-lantern-primary-background px-2 py-0.5 font-semibold capitalize text-lantern-primary">{note.accessRole}</span>
                        </div>
                      ) : null}
                      <p className="text-xs mt-3 text-lantern-text-secondary">
                        Updated {new Date(note.updatedAt).toLocaleDateString()}
                      </p>
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
                          <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden />
                        </button>
                        {menuOpen ? (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-lg border border-lantern-border bg-lantern-surface py-1 shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onMoveNotesToFolder ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => openMovePickerForNotes([note.id])}
                              >
                                <FolderIcon className="h-4 w-4" aria-hidden />
                                Move to folder
                              </button>
                            ) : null}
                            {onTogglePinNote && !note.isArchived ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  void onTogglePinNote(note.id, !note.isPinned);
                                }}
                              >
                                <BookmarkIcon className="h-4 w-4" aria-hidden />
                                {note.isPinned ? 'Unpin' : 'Pin'}
                              </button>
                            ) : null}
                            {onArchiveNote ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  void onArchiveNote(note.id, !note.isArchived);
                                }}
                              >
                                <ArchiveBoxIcon className="h-4 w-4" aria-hidden />
                                {note.isArchived ? 'Unarchive' : 'Archive'}
                              </button>
                            ) : null}
                            {onDeleteNotes && canDeleteNote(note) ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                onClick={() => {
                                  setNoteMenuId(null);
                                  window.setTimeout(() => handleDeleteNotesByIds([note.id]), 50);
                                }}
                              >
                                <TrashIcon className="h-4 w-4" aria-hidden />
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
    </div>
  );
};

export default NotesScreen;
