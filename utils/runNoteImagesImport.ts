import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import type { NoteAttachment, StudyNote } from '../types';
import type { NoteImportProgress } from '../services/notes';
import { uploadNoteImagesViaApi } from '../services/notes';
import { useNoteUploadStore } from '../stores/noteUploadStore';
import { useUIStore } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';
import { useNotesStore } from '../stores/notesStore';
// See runNoteFileImport: the tray row carries its owner (#144).
import { useAuthStore } from '../stores/authStore';

function mapProgressToJobStatus(
  stage: NoteImportProgress['stage']
): 'uploading' | 'processing' | 'complete' {
  if (stage === 'processing') return 'processing';
  if (stage === 'complete') return 'complete';
  return 'uploading';
}

function makeProgressCallback(jobId: string) {
  return (progress: NoteImportProgress) => {
    useUIStore.getState().setImportProgress(progress);
    useNoteUploadStore.getState().updateJob(jobId, {
      label: progress.label,
      status: mapProgressToJobStatus(progress.stage),
    });
  };
}

export interface RunNoteImagesImportOptions {
  files: File[];
  folderId?: string;
  title?: string;
  setSelectedNote: (note: StudyNote & { attachments?: NoteAttachment[] }) => void;
  loadNote: (noteId: string) => Promise<boolean>;
  loadNotes: () => Promise<void>;
  navigateToEditor: (noteId: string) => void;
}

export async function runNoteImagesImport({
  files,
  folderId,
  title,
  setSelectedNote,
  loadNote,
  loadNotes,
  navigateToEditor,
}: RunNoteImagesImportOptions): Promise<StudyNote> {
  const uploadStore = useNoteUploadStore.getState();
  const noteTitle = title?.trim() || defaultPhotoNoteTitle();
  const jobId = uploadStore.startJob(
    noteTitle,
    'photos',
    useAuthStore.getState().currentUser?.id
  );
  const onProgress = makeProgressCallback(jobId);

  try {
    const result = await uploadNoteImagesViaApi(files, folderId, onProgress, noteTitle);
    setSelectedNote({ ...result.note, attachments: result.attachments });
    navigateToEditor(result.note.id);
    await loadNote(result.note.id);
    const loaded = useNotesStore.getState().selectedNote;
    if (loaded?.id === result.note.id && (!loaded.attachments || loaded.attachments.length === 0)) {
      setSelectedNote({ ...loaded, attachments: result.attachments });
    }
    await loadNotes();
    uploadStore.completeJob(jobId, result.note.id);
    onProgress({
      stage: 'complete',
      percent: 100,
      label: 'Upload complete',
      fileName: noteTitle,
    });
    useUIStore.getState().clearImportProgress();
    useToastStore.getState().showStickyToast(`"${result.note.title || noteTitle}" imported successfully`, 'success');
    return result.note;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    uploadStore.failJob(jobId, message);
    useUIStore.getState().clearImportProgress();
    useToastStore.getState().showStickyToast(message, 'error');
    throw err;
  }
}
