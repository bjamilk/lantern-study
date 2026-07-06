import type { NoteAttachment, StudyNote } from '../types';
import type { NoteImportProgress } from '../services/notes';
import {
  uploadNotePdfViaApi,
  uploadPresentationViaApi,
} from '../services/notes';
import { useNoteUploadStore, type NoteUploadKind } from '../stores/noteUploadStore';
import { useUIStore } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';

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

export interface RunNoteFileImportOptions {
  file: File;
  kind: NoteUploadKind;
  folderId?: string;
  setSelectedNote: (note: StudyNote & { attachments?: NoteAttachment[] }) => void;
  loadNote: (noteId: string) => Promise<boolean>;
  loadNotes: () => Promise<void>;
  navigateToEditor: (noteId: string) => void;
}

async function finalizeImport(
  file: File,
  jobId: string,
  onProgress: (progress: NoteImportProgress) => void,
  result: { note: StudyNote; attachment: NoteAttachment },
  setSelectedNote: (note: StudyNote & { attachments?: NoteAttachment[] }) => void,
  loadNote: (noteId: string) => Promise<boolean>,
  loadNotes: () => Promise<void>,
  navigateToEditor: (noteId: string) => void
): Promise<StudyNote> {
  setSelectedNote({ ...result.note, attachments: [result.attachment] });
  navigateToEditor(result.note.id);
  await loadNote(result.note.id);
  await loadNotes();
  useNoteUploadStore.getState().completeJob(jobId, result.note.id);
  onProgress({
    stage: 'complete',
    percent: 100,
    label: 'Upload complete',
    fileName: file.name,
  });
  useUIStore.getState().clearImportProgress();
  useToastStore.getState().showStickyToast(`"${file.name}" imported successfully`, 'success');
  return result.note;
}

export async function runNoteFileImport({
  file,
  kind,
  folderId,
  setSelectedNote,
  loadNote,
  loadNotes,
  navigateToEditor,
}: RunNoteFileImportOptions): Promise<StudyNote> {
  const uploadStore = useNoteUploadStore.getState();
  const jobId = uploadStore.startJob(file.name, kind);
  const onProgress = makeProgressCallback(jobId);

  try {
    if (kind === 'pdf') {
      const result = await uploadNotePdfViaApi(file, folderId, onProgress);
      return await finalizeImport(
        file,
        jobId,
        onProgress,
        result,
        setSelectedNote,
        loadNote,
        loadNotes,
        navigateToEditor
      );
    }

    const result = await uploadPresentationViaApi(file, folderId, onProgress);
    return await finalizeImport(
      file,
      jobId,
      onProgress,
      result,
      setSelectedNote,
      loadNote,
      loadNotes,
      navigateToEditor
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    uploadStore.failJob(jobId, message);
    useUIStore.getState().clearImportProgress();
    useToastStore.getState().showStickyToast(message, 'error');
    throw err;
  }
}
