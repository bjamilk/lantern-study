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
import { ensureNotesUploadSession, getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

import {
  MAX_NOTE_UPLOAD_BYTES,
  assertNoteUploadSize,
  wrapNoteFinalizeError,
} from '@lantern/shared/utils/noteUpload';

export {
  MAX_NOTE_UPLOAD_BYTES,
  formatMaxNoteUploadLabel,
  formatFileSize,
  NOTE_UPLOAD_MAX_MB,
} from '@lantern/shared/utils/noteUpload';

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

async function notesLongRequest<T>(
  path: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    onProgress?: NoteImportProgressCallback;
    processingLabel?: string;
    timeoutMs?: number;
  }
): Promise<T> {
  const headers = await getAuthHeaders();
  const method = options?.method ?? 'POST';
  const body = options?.body ?? {};
  const json = JSON.stringify(body);
  const processingLabel = options?.processingLabel ?? 'Processing…';
  const timeoutMs = options?.timeoutMs ?? 180_000;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE_URL}/api/v1/notes${path}`);
    xhr.responseType = 'json';
    xhr.timeout = timeoutMs;

    for (const [key, value] of Object.entries(headers)) {
      if (value) xhr.setRequestHeader(key, String(value));
    }
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onload = () => {
      options?.onProgress?.({
        stage: 'processing',
        percent: null,
        label: processingLabel,
        fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      });
    };

    xhr.onerror = () => reject(new Error('Request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Request timed out. Try again.'));

    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) {
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

function assertUploadFileSize(file: File): void {
  assertNoteUploadSize(file.size, file.name);
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
    const hasBody =
      (typeof data.error === 'string' && data.error && data.error !== 'Error') ||
      (typeof data.message === 'string' && data.message);
    let message =
      data.message ||
      (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
      `Notes request failed (${response.status})`;
    if ((response.status === 502 || response.status === 504) && !hasBody) {
      message = 'Request timed out. Try again in a moment.';
    } else if (response.status === 502 || response.status === 504) {
      message =
        typeof data.error === 'string' && data.error
          ? data.error
          : 'Request timed out. Try again in a moment.';
    }
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

export type PresentationPreviewStatus = 'ready' | 'processing' | 'failed' | 'none';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPreviewRequestError(status: number, data: Record<string, unknown>): string {
  const message =
    (typeof data.message === 'string' && data.message) ||
    (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null);
  if (status === 404) {
    return 'This note is missing slide files. Delete it and re-upload your presentation.';
  }
  return message || `Preview request failed (${status})`;
}

export async function fetchPresentationPreviewStatus(noteId: string): Promise<{
  status: PresentationPreviewStatus;
  attachment?: NoteAttachment;
  previewAvailable: boolean;
  previewError?: string;
}> {
  return notesRequest(`/${noteId}/preview-status`);
}

export async function regeneratePresentationPreview(
  noteId: string
): Promise<{ attachment: NoteAttachment; previewAvailable: boolean; previewError?: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/notes/${noteId}/regenerate-preview`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: {
      attachment?: NoteAttachment;
      previewAvailable?: boolean;
      previewError?: string;
      status?: PresentationPreviewStatus;
    };
    message?: string;
    error?: string;
  };

  if (response.status === 404) {
    throw new Error(formatPreviewRequestError(404, data));
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(formatPreviewRequestError(response.status, data));
  }

  const payload = data.data ?? data;
  if (payload.previewAvailable && payload.attachment) {
    return {
      attachment: payload.attachment,
      previewAvailable: true,
    };
  }

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const status = await fetchPresentationPreviewStatus(noteId);
    if (status.status === 'ready' && status.attachment) {
      return { attachment: status.attachment, previewAvailable: true };
    }
    if (status.status === 'failed') {
      return {
        attachment: status.attachment!,
        previewAvailable: false,
        previewError:
          status.previewError ||
          'Slide preview is unavailable, but AI can still use extracted text from your deck.',
      };
    }
  }

  throw new Error('Preview generation timed out. Try Retry preview.');
}

export async function summarizeNote(noteId: string): Promise<{ summary: string; note: StudyNote }> {
  return notesRequest<{ summary: string; note: StudyNote }>(`/${noteId}/summarize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function generateFlashcardsFromNote(
  noteId: string,
  options?: { count?: number; style?: 'concise' | 'detailed' }
): Promise<{ flashcards: Array<{ front: string; back: string; mnemonic?: string; example?: string }>; provider: string }> {
  return notesRequest(`/${noteId}/generate-flashcards`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export async function reextractNoteText(
  noteId: string
): Promise<{ attachment: NoteAttachment; extractedText: string; contentLength: number }> {
  return notesRequest(`/${noteId}/reextract-text`, {
    method: 'POST',
    body: JSON.stringify({}),
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
  assertUploadFileSize(file);
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing PDF…',
    fileName: file.name,
  });

  const { userId } = await ensureNotesUploadSession();
  const { supabase } = await import('./supabase');
  const storagePath = buildNoteStoragePath(userId, file.name);

  try {
    await uploadFileToNoteStorage(file, storagePath, 'application/pdf', onProgress);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'Storage upload failed. Check your connection and try again.'
    );
  }

  onProgress?.({
    stage: 'processing',
    percent: null,
    label: 'Extracting text from PDF…',
    fileName: file.name,
  });

  try {
    const result = await notesRequest<{ note: StudyNote; attachment: NoteAttachment }>(
      '/finalize-pdf',
      {
        method: 'POST',
        body: JSON.stringify({ storagePath, fileName: file.name, folderId }),
      }
    );
    onProgress?.({
      stage: 'complete',
      percent: 100,
      label: 'Upload complete',
      fileName: file.name,
    });
    return result;
  } catch (err) {
    await supabase.storage.from('note-files').remove([storagePath]).catch(() => {});
    throw wrapNoteFinalizeError(err);
  }
}

export async function uploadPresentationViaApi(
  file: File,
  folderId?: string,
  onProgress?: NoteImportProgressCallback
): Promise<{ note: StudyNote; attachment: NoteAttachment; previewAvailable: boolean }> {
  assertUploadFileSize(file);
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing slides…',
    fileName: file.name,
  });

  const { userId } = await ensureNotesUploadSession();
  const { supabase } = await import('./supabase');
  const storagePath = buildNoteStoragePath(userId, file.name);
  const contentType = presentationContentType(file.name);

  try {
    await uploadFileToNoteStorage(file, storagePath, contentType, onProgress);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'Storage upload failed. Check your connection and try again.'
    );
  }

  onProgress?.({
    stage: 'processing',
    percent: null,
    label: 'Saving slides…',
    fileName: file.name,
  });

  try {
    const result = await notesRequest<{
      note: StudyNote;
      attachment: NoteAttachment;
      previewAvailable: boolean;
    }>('/finalize-presentation', {
      method: 'POST',
      body: JSON.stringify({ storagePath, fileName: file.name, folderId }),
    });
    onProgress?.({
      stage: 'complete',
      percent: 100,
      label: 'Upload complete',
      fileName: file.name,
    });
    return result;
  } catch (err) {
    await supabase.storage.from('note-files').remove([storagePath]).catch(() => {});
    throw wrapNoteFinalizeError(err);
  }
}

function sanitizeNoteFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildNoteStoragePath(userId: string, fileName: string): string {
  return `${userId}/${Date.now()}-${sanitizeNoteFileName(fileName)}`;
}

function presentationContentType(fileName: string): string {
  return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName)
    ? 'application/vnd.ms-powerpoint'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

async function uploadFileToNoteStorage(
  file: File,
  storagePath: string,
  contentType: string,
  onProgress?: NoteImportProgressCallback
): Promise<void> {
  const { supabase } = await import('./supabase');
  onProgress?.({
    stage: 'uploading',
    percent: null,
    label: 'Uploading…',
    fileName: file.name,
  });

  const { error } = await supabase.storage.from('note-files').upload(storagePath, file, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || 'Storage upload failed.');
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file for upload.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file for upload.'));
    reader.readAsDataURL(file);
  });
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
