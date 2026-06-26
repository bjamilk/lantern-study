import React, { useMemo, useState } from 'react';
import {
  PlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  PlayCircleIcon,
  DocumentArrowUpIcon,
} from '@heroicons/react/24/outline';
import type { NoteFolder, StudyNote } from '../types';
import { ScreenHeader, Button, Card } from './ui';
import { useUIStore } from '../stores/uiStore';

interface NotesScreenProps {
  theme: 'light' | 'dark';
  folders: NoteFolder[];
  notes: StudyNote[];
  isLoading?: boolean;
  error?: string | null;
  onBack?: () => void;
  onCreateNote: () => void;
  onCreateFolder: (name: string) => void;
  onSelectNote: (noteId: string) => void;
  onYouTubeImport: (url: string) => void;
  onPdfImport: (file: File) => void;
  onPresentationImport?: (file: File) => void;
  selectedFolderId?: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

const folderButtonClass = (
  isActive: boolean,
  isDark: boolean,
) =>
  `shrink-0 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
    isActive
      ? 'bg-indigo-600 text-white'
      : isDark
        ? 'text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700'
        : 'text-gray-700 bg-white border border-gray-200 hover:bg-gray-100'
  }`;

const NotesScreen: React.FC<NotesScreenProps> = ({
  theme,
  folders,
  notes,
  isLoading,
  error,
  onCreateNote,
  onCreateFolder,
  onSelectNote,
  onYouTubeImport,
  onPdfImport,
  onPresentationImport,
  selectedFolderId,
  onSelectFolder,
}) => {
  const [search, setSearch] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const importProgress = useUIStore((s) => s.importProgress);
  const isDark = theme === 'dark';

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (selectedFolderId) list = list.filter(n => n.folderId === selectedFolderId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
      );
    }
    return list;
  }, [notes, selectedFolderId, search]);

  const handleFolderCreate = () => {
    const name = prompt('Folder name');
    if (name?.trim()) onCreateFolder(name.trim());
  };

  const handleYouTube = () => {
    if (!youtubeUrl.trim()) return;
    onYouTubeImport(youtubeUrl.trim());
    setYoutubeUrl('');
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

  const sourceBadge = (note: StudyNote) => {
    if (note.sourceType === 'youtube') return 'YouTube';
    if (note.sourceType === 'pdf') return 'PDF';
    if (note.sourceType === 'presentation') return 'Slides';
    if (note.sourceType === 'audio') return 'Audio';
    return 'Note';
  };

  const renderFolderButton = (folder: NoteFolder | null) => {
    const isActive = folder ? selectedFolderId === folder.id : !selectedFolderId;
    return (
      <button
        key={folder?.id ?? 'all'}
        type="button"
        onClick={() => onSelectFolder(folder?.id ?? null)}
        className={`${folderButtonClass(isActive, isDark)} flex items-center gap-1.5`}
      >
        {folder && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: folder.color }} />
        )}
        <span className="truncate max-w-[120px] sm:max-w-none">{folder?.name ?? 'All notes'}</span>
      </button>
    );
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 pb-2">
        <ScreenHeader
          title="Notes"
          subtitle="Capture lectures, import videos, and turn notes into study tools"
          className="mb-0 sm:mb-2"
          actions={
            <div className="flex gap-1.5 sm:gap-2">
              <Button variant="secondary" size="sm" onClick={handleFolderCreate} aria-label="New folder">
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

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
        {/* Desktop folder sidebar */}
        <aside className={`hidden md:block shrink-0 w-56 border-r p-3 overflow-y-auto ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          {renderFolderButton(null)}
          <div className="mt-1 space-y-1">
            {folders.map(folder => renderFolderButton(folder))}
          </div>
        </aside>

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-3 sm:space-y-4">
          {/* Mobile folder chips */}
          <div className="md:hidden -mx-1 px-1 overflow-x-auto scrollbar-none">
            <div className="flex gap-2 pb-1 w-max max-w-none">
              {renderFolderButton(null)}
              {folders.map(folder => renderFolderButton(folder))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border min-w-0 w-full sm:flex-1 sm:min-w-[200px] ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search notes..."
                className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${isDark ? 'text-gray-100' : 'text-gray-800'}`}
              />
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border min-w-0 w-full sm:flex-1 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <PlayCircleIcon className="w-5 h-5 text-red-500 shrink-0" />
              <input
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                placeholder="YouTube URL..."
                className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${isDark ? 'text-gray-100' : 'text-gray-800'}`}
              />
              <Button size="sm" onClick={handleYouTube} disabled={!youtubeUrl.trim()} className="shrink-0">
                Import
              </Button>
            </div>
            <label className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto ${
              importProgress
                ? isDark
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed opacity-60'
                  : 'bg-white border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                : isDark
                  ? 'bg-gray-800 border-gray-700 text-gray-200 cursor-pointer'
                  : 'bg-white border-gray-200 text-gray-700 cursor-pointer'
            }`}>
              <DocumentArrowUpIcon className="w-5 h-5" />
              Import PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handlePdf} disabled={Boolean(importProgress)} />
            </label>
            {onPresentationImport && (
              <label className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm shrink-0 w-full sm:w-auto ${
                importProgress
                  ? isDark
                    ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed opacity-60'
                    : 'bg-white border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                  : isDark
                    ? 'bg-gray-800 border-gray-700 text-gray-200 cursor-pointer'
                    : 'bg-white border-gray-200 text-gray-700 cursor-pointer'
              }`}>
                <DocumentArrowUpIcon className="w-5 h-5" />
                Import PowerPoint
                <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={handlePresentation} disabled={Boolean(importProgress)} />
              </label>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          {isLoading ? (
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading notes...</p>
          ) : filteredNotes.length === 0 ? (
            <Card theme={theme} className="text-center py-10 sm:py-12">
              <DocumentTextIcon className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-indigo-400 mb-3" />
              <p className={`text-sm sm:text-base ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                No notes yet. Create one, import a YouTube lecture, upload a PDF, or import PowerPoint slides.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 pb-4">
              {filteredNotes.map(note => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => onSelectNote(note.id)}
                  className={`text-left p-3 sm:p-4 rounded-xl border transition hover:shadow-md min-w-0 ${
                    isDark ? 'bg-gray-800 border-gray-700 hover:border-indigo-500' : 'bg-white border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                    <h3 className={`font-semibold line-clamp-2 sm:line-clamp-1 min-w-0 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {note.title}
                    </h3>
                    <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">
                      {sourceBadge(note)}
                    </span>
                  </div>
                  <p className={`text-sm line-clamp-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {note.summary || note.body || 'Empty note'}
                  </p>
                  <p className={`text-xs mt-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Updated {new Date(note.updatedAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default NotesScreen;
