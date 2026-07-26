import React, { useMemo, useState } from 'react';
import {
  PlusIcon,
  FolderPlusIcon,
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
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import { parseYoutubeVideoId } from '@lantern/shared/utils/youtube';
import type { NoteFolder, StudyNote } from '../types';
import { ScreenHeader, Button, EmptyState, FolderNameModal, Modal, Input } from './ui';
import { useUIStore } from '../stores/uiStore';
import { useNoteUploadStore, getVisibleUploadJobs } from '../stores/noteUploadStore';

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
  const youtubeUrlValid = Boolean(parseYoutubeVideoId(youtubeUrl));
  const importProgress = useUIStore((s) => s.importProgress);
  const uploadJobList = useNoteUploadStore((s) => s.jobs);
  const uploadJobs = useMemo(() => getVisibleUploadJobs(uploadJobList), [uploadJobList]);
  const dismissUploadJob = useNoteUploadStore((s) => s.dismissJob);
  const isDark = theme === 'dark';

  const confirmDeleteFolder = (folder: NoteFolder) => {
    setFolderMenuId(null);
    if (!onDeleteFolder) return;
    const ok = window.confirm(
      `Delete folder “${folder.name}”? Notes inside stay in All notes.`,
    );
    if (!ok) return;
    void onDeleteFolder(folder.id);
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
      <div key={folder?.id ?? 'all'} className={`relative ${compact ? 'w-full' : 'shrink-0'}`}>
        <div
          className={`${folderButtonClass(isActive, compact)} flex items-center gap-1.5 ${
            compact ? '' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setFolderMenuId(null);
              onSelectFolder(folder?.id ?? null);
            }}
            className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${
              compact ? '' : ''
            }`}
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
            <button
              type="button"
              aria-label={`Folder options for ${folder.name}`}
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setFolderMenuId(menuOpen ? null : folder.id);
              }}
              className={`rounded p-0.5 shrink-0 ${
                isActive
                  ? 'text-white/90 hover:bg-white/15'
                  : 'text-lantern-text-tertiary hover:bg-lantern-background-secondary'
              }`}
            >
              <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {folder && menuOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-full z-30 mt-1 min-w-[140px] rounded-lg border border-lantern-border bg-lantern-surface py-1 shadow-lg"
          >
            {onRenameFolder ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-lantern-text hover:bg-lantern-background-secondary"
                onClick={() => {
                  setFolderMenuId(null);
                  setRenameFolder(folder);
                }}
              >
                Rename
              </button>
            ) : null}
            {onDeleteFolder ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                onClick={() => confirmDeleteFolder(folder)}
              >
                Delete folder
              </button>
            ) : null}
          </div>
        ) : null}
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
        <aside className="hidden md:block shrink-0 w-44 border-r border-lantern-border p-2 overflow-y-auto bg-lantern-surface">
          {renderFolderButton(null, true)}
          <div className="mt-1 space-y-1">
            {folders.map(folder => renderFolderButton(folder, true))}
          </div>
        </aside>

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-3 sm:space-y-4">
          {embedded && (
            <div className="flex gap-1.5 sm:gap-2 justify-end">
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

          <div className="md:hidden -mx-1 px-1 overflow-x-auto scrollbar-none">
            <div className="flex gap-2 pb-1 w-max max-w-none">
              {renderFolderButton(null)}
              {folders.map(folder => renderFolderButton(folder))}
            </div>
          </div>

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
                const showMenu = canManageNote(note) && (onTogglePinNote || onArchiveNote);
                return (
                  <div
                    key={note.id}
                    className="relative text-left p-3 sm:p-4 rounded-xl border border-lantern-border bg-lantern-surface transition hover:shadow-md hover:border-lantern-primary min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNote(note.id)}
                      className={`w-full text-left min-w-0 ${showMenu ? 'pr-8' : ''}`}
                    >
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
                    {showMenu ? (
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
