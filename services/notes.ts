import { getApiBaseUrl } from '@lantern/shared';
import type {
  DailyQuizQuestion,
  DailyQuizSession,
  NoteAttachment,
  NoteComment,
  NoteFolder,
  StudyGoalMode,
  StudyNote,
} from '../types';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

export type NoteImportProgressStage = 'encoding' | 'uploading' | 'processing' | 'complete';

export type NoteImportProgress = {
  stage: NoteImportProgressStage;
  /** 0–100 during encoding/upload; null while server processes */
  percent: number | null;
  label: string;
  fileName?: string;
};

export type NoteImportProgressCallback = (progress: NoteImportProgress) => void;

async function notesUploadRequest<T>(
  path: string,
  body: Record<string, unknown>,
  options?: {
    onProgress?: NoteImportProgressCallback;
    processingLabel?: string;
  }
): Promise<T> {
  const headers = await getAuthHeaders();
  const json = JSON.stringify(body);
  const processingLabel = options?.processingLabel ?? 'Processing…';

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/api/v1/notes${path}`);
    xhr.responseType = 'json';
    xhr.timeout = 180_000;

    for (const [key, value] of Object.entries(headers)) {
      if (value) xhr.setRequestHeader(key, String(value));
    }
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (!options?.onProgress) return;
      if (event.lengthComputable) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        options.onProgress({
          stage: 'uploading',
          percent,
          label: `Uploading… ${percent}%`,
          fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
        });
      } else {
        options.onProgress({
          stage: 'uploading',
          percent: null,
          label: 'Uploading…',
          fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
        });
      }
    };

    xhr.upload.onload = () => {
      options?.onProgress?.({
        stage: 'processing',
        percent: null,
        label: processingLabel,
        fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      });
    };

    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try again.'));

    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) {
        options?.onProgress?.({
          stage: 'complete',
          percent: 100,
          label: 'Upload complete',
          fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
        });
        resolve((data.data ?? data) as T);
        return;
      }
      const message =
        data.message ||
        (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        `Notes request failed (${xhr.status})`;
      reject(new Error(message));
    };

    xhr.send(json);
  });
}

async function notesRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/notes${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data.message ||
      (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
      `Notes request failed (${response.status})`;
    throw new Error(message);
  }
  return data.data ?? data;
}

export async function fetchNoteFolders(): Promise<NoteFolder[]> {
  return notesRequest<NoteFolder[]>('/folders');
}

export async function createNoteFolder(payload: {
  name: string;
  color?: string;
  groupId?: string;
  parentId?: string;
}): Promise<NoteFolder> {
  return notesRequest<NoteFolder>('/folders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateNoteFolder(
  folderId: string,
  updates: { name?: string; color?: string }
): Promise<NoteFolder> {
  return notesRequest<NoteFolder>(`/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteNoteFolder(folderId: string): Promise<void> {
  await notesRequest(`/folders/${folderId}`, { method: 'DELETE' });
}

export async function fetchNotes(options?: {
  folderId?: string;
  groupId?: string;
}): Promise<StudyNote[]> {
  const params = new URLSearchParams();
  if (options?.folderId) params.set('folderId', options.folderId);
  if (options?.groupId) params.set('groupId', options.groupId);
  const qs = params.toString();
  return notesRequest<StudyNote[]>(`${qs ? `?${qs}` : ''}`);
}

export async function fetchNote(
  noteId: string
): Promise<StudyNote & { attachments?: NoteAttachment[] }> {
  return notesRequest<StudyNote & { attachments?: NoteAttachment[] }>(`/${noteId}`);
}

export async function createNote(payload: Partial<StudyNote>): Promise<StudyNote> {
  return notesRequest<StudyNote>('/', {
    method: 'POST',
    body: JSON.stringify({
      title: payload.title,
      body: payload.body,
      folderId: payload.folderId,
      groupId: payload.groupId,
      sourceType: payload.sourceType,
      youtubeUrl: payload.youtubeUrl,
      youtubeVideoId: payload.youtubeVideoId,
      summary: payload.summary,
    }),
  });
}

export async function updateNote(
  noteId: string,
  updates: Partial<StudyNote>
): Promise<StudyNote> {
  return notesRequest<StudyNote>(`/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await notesRequest(`/${noteId}`, { method: 'DELETE' });
}

export async function regeneratePresentationPreview(
  noteId: string
): Promise<{ attachment: NoteAttachment; previewAvailable: boolean }> {
  return notesRequest<{ attachment: NoteAttachment; previewAvailable: boolean }>(
    `/${noteId}/regenerate-preview`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export async function summarizeNote(noteId: string): Promise<{ summary: string; note: StudyNote }> {
  return notesRequest<{ summary: string; note: StudyNote }>(`/${noteId}/summarize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function importYouTubeNote(url: string, folderId?: string): Promise<StudyNote> {
  return notesRequest<StudyNote>('/youtube-import', {
    method: 'POST',
    body: JSON.stringify({ url, folderId }),
  });
}

export async function generateDailyQuizFromContent(
  content: string,
  studyGoal?: StudyGoalMode,
  count?: number
): Promise<{ questions: DailyQuizQuestion[] }> {
  return notesRequest<{ questions: DailyQuizQuestion[] }>('/daily-quiz', {
    method: 'POST',
    body: JSON.stringify({ content, studyGoal, count }),
  });
}

export async function getNoteQuiz(noteId: string): Promise<DailyQuizSession | null> {
  return notesRequest<DailyQuizSession | null>(`/${noteId}/quiz`);
}

export async function generateNoteQuiz(
  noteId: string,
  studyGoal?: StudyGoalMode,
  count?: number
): Promise<DailyQuizSession> {
  return notesRequest<DailyQuizSession>(`/${noteId}/quiz`, {
    method: 'POST',
    body: JSON.stringify({ studyGoal, count }),
  });
}

export async function updateNoteQuiz(
  noteId: string,
  updates: { answers?: Record<string, string>; completed?: boolean }
): Promise<DailyQuizSession> {
  return notesRequest<DailyQuizSession>(`/${noteId}/quiz`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function transcribeAudioForNote(
  audioBase64: string,
  options?: { mimeType?: string; noteId?: string; fileName?: string }
): Promise<{ transcript: string }> {
  return notesRequest<{ transcript: string }>('/transcribe-audio', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
    }),
  });
}

export async function addNoteAttachment(
  noteId: string,
  payload: {
    type: string;
    fileUrl?: string;
    fileName?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<NoteAttachment> {
  return notesRequest<NoteAttachment>(`/${noteId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchNoteComments(noteId: string): Promise<NoteComment[]> {
  return notesRequest<NoteComment[]>(`/${noteId}/comments`);
}

export async function addNoteComment(noteId: string, comment: string): Promise<NoteComment> {
  return notesRequest<NoteComment>(`/${noteId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export async function fetchNoteCollaborators(noteId: string) {
  return notesRequest(`/${noteId}/collaborators`);
}

export async function addNoteCollaborator(
  noteId: string,
  collaboratorUserId: string,
  role: 'viewer' | 'editor' = 'editor'
) {
  return notesRequest(`/${noteId}/collaborators`, {
    method: 'POST',
    body: JSON.stringify({ collaboratorUserId, role }),
  });
}

export async function removeNoteCollaborator(noteId: string, collaboratorUserId: string) {
  return notesRequest(`/${noteId}/collaborators/${collaboratorUserId}`, {
    method: 'DELETE',
  });
}

export async function shareNoteWithGroup(noteId: string, groupId: string): Promise<StudyNote> {
  return notesRequest<StudyNote>(`/${noteId}/share-group`, {
    method: 'POST',
    body: JSON.stringify({ groupId }),
  });
}

export async function refreshNoteAttachmentUrl(
  noteId: string,
  attachmentId: string
): Promise<{ url: string; expiresIn: number }> {
  return notesRequest<{ url: string; expiresIn: number }>(
    `/${noteId}/attachments/${attachmentId}/url`
  );
}

export async function fetchNoteAttachmentContent(
  noteId: string,
  attachmentId: string
): Promise<ArrayBuffer> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/api/v1/notes/${noteId}/attachments/${attachmentId}/content`,
    { headers }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Failed to load attachment (${response.status})`);
  }
  return response.arrayBuffer();
}

export async function uploadNotePdfViaApi(
  file: File,
  folderId?: string,
  onProgress?: NoteImportProgressCallback
): Promise<{ note: StudyNote; attachment: NoteAttachment }> {
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing PDF…',
    fileName: file.name,
  });
  const base64Data = await fileToBase64(file);
  return notesUploadRequest<{ note: StudyNote; attachment: NoteAttachment }>(
    '/upload-pdf',
    { fileName: file.name, base64Data, folderId },
    {
      onProgress,
      processingLabel: 'Extracting text from PDF…',
    }
  );
}

export async function uploadPresentationViaApi(
  file: File,
  folderId?: string,
  onProgress?: NoteImportProgressCallback
): Promise<{ note: StudyNote; attachment: NoteAttachment; previewAvailable: boolean }> {
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing slides…',
    fileName: file.name,
  });
  const base64Data = await fileToBase64(file);
  return notesUploadRequest<{
    note: StudyNote;
    attachment: NoteAttachment;
    previewAvailable: boolean;
  }>('/upload-presentation', { fileName: file.name, base64Data, folderId }, {
    onProgress,
    processingLabel: 'Saving slides…',
  });
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function uploadNotePdf(
  userId: string,
  file: File
): Promise<{ fileUrl: string; extractedText: string; storagePath: string }> {
  const { supabase } = await import('./supabase');
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error: uploadError } = await supabase.storage
    .from('note-files')
    .upload(path, file, { upsert: false, contentType: 'application/pdf' });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from('note-files').getPublicUrl(path);
  const { data: signedData } = await supabase.storage
    .from('note-files')
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  const extractedText = await extractPdfText(file);

  return {
    fileUrl: signedData?.signedUrl || urlData.publicUrl,
    extractedText,
    storagePath: path,
  };
}

export async function extractPdfText(file: File): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(text);
    }

    return pages.join('\n\n').trim();
  } catch {
    return `[PDF uploaded: ${file.name}. Text extraction unavailable — open the PDF attachment for reference.]`;
  }
}
