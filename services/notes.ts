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
import { pollApiJob } from './jobPoll';

const API_BASE_URL = getApiBaseUrl();

import {
  MAX_NOTE_UPLOAD_BYTES,
  assertNoteUploadSize,
} from '@lantern/shared/utils/noteUpload';
import { assertAllowedImageUpload } from '@lantern/shared';
import { compressImage } from '../utils/imageCompression';

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
    signal?: AbortSignal;
  }
): Promise<T> {
  const headers = await getAuthHeaders();
  const method = options?.method ?? 'POST';
  const body = options?.body ?? {};
  const json = JSON.stringify(body);
  const processingLabel = options?.processingLabel ?? 'Processing…';
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const signal = options?.signal;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE_URL}/api/v1/notes${path}`);
    xhr.responseType = 'json';
    xhr.timeout = timeoutMs;

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Transcription cancelled.', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

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
    xhr.onabort = () => reject(new DOMException('Transcription cancelled.', 'AbortError'));

    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      const data = xhr.response ?? {};
      if (xhr.status === 202 && typeof data.jobId === 'string') {
        void pollApiJob<T>(data.jobId)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((data.data ?? data) as T);
        return;
      }
      let message =
        data.message ||
        (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        `Notes request failed (${xhr.status})`;
      if (xhr.status === 408 || xhr.status === 504) {
        message = 'AI request timed out. Try again in a moment.';
      }
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
  if (response.status === 202 && typeof data.jobId === 'string') {
    return pollApiJob<T>(data.jobId);
  }
  if (!response.ok) {
    if (response.status === 409 || data.code === 'version_conflict') {
      const err = new Error(
        (typeof data.error === 'string' && data.error) ||
          data.message ||
          'Note was updated elsewhere. Refresh and try again.'
      ) as Error & { code?: string; status?: number; current?: unknown };
      err.code = 'version_conflict';
      err.status = 409;
      err.current = data.data ?? null;
      throw err;
    }
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

async function notesAiRequest<T>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  return notesLongRequest<T>(path, {
    method: 'POST',
    body,
    processingLabel: 'Generating with AI…',
    timeoutMs: 120_000,
  });
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
  const { version, ...rest } = updates;
  try {
    return await notesRequest<StudyNote>(`/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...rest,
        ...(version != null ? { expectedVersion: version } : {}),
      }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const looksConflict =
      message.toLowerCase().includes('updated elsewhere') ||
      message.toLowerCase().includes('version');
    if (looksConflict) {
      // Keep server: refetch and return authoritative note (callers may toast).
      try {
        return await fetchNote(noteId);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

export async function deleteNote(noteId: string): Promise<void> {
  await notesRequest(`/${noteId}`, { method: 'DELETE' });
}

export type PresentationPreviewStatus = 'ready' | 'processing' | 'failed' | 'none';

const previewPollsInFlight = new Set<string>();

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

const PREVIEW_POLL_DEADLINE_MS = 180_000;

async function pollPresentationPreviewUntilReady(noteId: string): Promise<{
  attachment: NoteAttachment;
  previewAvailable: boolean;
  previewError?: string;
}> {
  const deadline = Date.now() + PREVIEW_POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    const status = await fetchPresentationPreviewStatus(noteId);
    if (status.status === 'none') {
      throw new Error(
        status.previewError ||
          'This note is missing slide files. Delete it and re-upload your presentation.'
      );
    }
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
    await sleep(3000);
  }
  throw new Error('Preview generation timed out. Try Retry preview.');
}

export async function regeneratePresentationPreview(
  noteId: string
): Promise<{ attachment: NoteAttachment; previewAvailable: boolean; previewError?: string }> {
  const waitForPreview = () => pollPresentationPreviewUntilReady(noteId);

  if (previewPollsInFlight.has(noteId)) {
    return waitForPreview();
  }
  previewPollsInFlight.add(noteId);

  try {
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
        attachment?: NoteAttachment | null;
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
    if (payload.status === 'none') {
      throw new Error(
        payload.previewError ||
          'This note is missing slide files. Delete it and re-upload your presentation.'
      );
    }
    if (payload.previewAvailable && payload.attachment) {
      return {
        attachment: payload.attachment,
        previewAvailable: true,
      };
    }

    return waitForPreview();
  } finally {
    previewPollsInFlight.delete(noteId);
  }
}

/** Poll only — use when finalize-presentation already started preview generation. */
export async function waitForPresentationPreview(
  noteId: string
): Promise<{ attachment: NoteAttachment; previewAvailable: boolean; previewError?: string }> {
  if (previewPollsInFlight.has(noteId)) {
    return pollPresentationPreviewUntilReady(noteId);
  }
  previewPollsInFlight.add(noteId);
  try {
    return await pollPresentationPreviewUntilReady(noteId);
  } finally {
    previewPollsInFlight.delete(noteId);
  }
}

export async function summarizeNote(noteId: string): Promise<{ summary: string; note: StudyNote }> {
  const result = await notesAiRequest<{ summary: string; note?: StudyNote; provider?: string }>(
    `/${noteId}/summarize`,
    {}
  );
  if (result.note) {
    return { summary: result.summary, note: result.note };
  }
  const note = await fetchNote(noteId);
  return { summary: result.summary, note };
}

export async function generateFlashcardsFromNote(
  noteId: string,
  options?: { count?: number; style?: 'concise' | 'detailed' }
): Promise<{ flashcards: Array<{ front: string; back: string; mnemonic?: string; example?: string }>; provider: string }> {
  return notesAiRequest(`/${noteId}/generate-flashcards`, options || {});
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
  return notesAiRequest<{ questions: DailyQuizQuestion[] }>('/daily-quiz', {
    content,
    studyGoal,
    count,
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
  return notesAiRequest<DailyQuizSession>(`/${noteId}/quiz`, { studyGoal, count });
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
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    currentBody?: string;
  }
): Promise<{ transcript: string; note?: StudyNote }> {
  return notesLongRequest<{ transcript: string; note?: StudyNote }>('/transcribe-audio', {
    body: {
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
      currentBody: options?.currentBody,
    },
    processingLabel: 'Transcribing audio…',
    timeoutMs: 120_000,
    signal: options?.signal,
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

  const base64Data = await fileToBase64(file);
  return notesUploadRequest<{ note: StudyNote; attachment: NoteAttachment }>(
    '/upload-pdf',
    { fileName: file.name, base64Data, folderId },
    { onProgress, processingLabel: 'Extracting text from PDF…' }
  );
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

function imageContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image.');
  }
  assertAllowedImageUpload({ contentType: file.type, byteLength: file.size });
  if (file.size > 2 * 1024 * 1024) {
    try {
      const compressed = await compressImage(file, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        outputType: 'file',
      });
      if (compressed instanceof File) {
        assertAllowedImageUpload({ contentType: compressed.type, byteLength: compressed.size });
        return compressed;
      }
    } catch {
      // keep original file
    }
  }
  return file;
}

export async function reorderNoteAttachments(
  noteId: string,
  attachmentIds: string[]
): Promise<{ attachments: NoteAttachment[] }> {
  return notesRequest<{ attachments: NoteAttachment[] }>(`/${noteId}/attachments/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ attachmentIds }),
  });
}

async function encodeImagesForApiUpload(
  files: File[],
  onProgress?: NoteImportProgressCallback,
  label?: string
): Promise<Array<{ fileName: string; base64Data: string; contentType: string }>> {
  const prepared: File[] = [];
  for (const file of files) {
    prepared.push(await prepareImageForUpload(file));
  }

  const images: Array<{ fileName: string; base64Data: string; contentType: string }> = [];
  for (let i = 0; i < prepared.length; i++) {
    const file = prepared[i];
    const fileName = file.name || `photo-${i + 1}.jpg`;
    onProgress?.({
      stage: 'encoding',
      percent: prepared.length > 1 ? Math.round(((i + 0.5) / prepared.length) * 100) : null,
      label:
        prepared.length > 1
          ? `Preparing ${i + 1}/${prepared.length}…`
          : 'Preparing photos…',
      fileName: label,
    });
    const base64Data = await fileToBase64(file);
    images.push({
      fileName,
      base64Data,
      contentType: file.type || imageContentTypeFromFileName(fileName),
    });
  }
  return images;
}

export async function uploadNoteImagesViaApi(
  files: File[],
  folderId?: string,
  onProgress?: NoteImportProgressCallback,
  title?: string
): Promise<{ note: StudyNote; attachments: NoteAttachment[] }> {
  if (files.length === 0) {
    throw new Error('Select at least one image.');
  }

  const label = title?.trim() || (files.length === 1 ? files[0].name : `${files.length} photos`);
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing photos…',
    fileName: label,
  });

  const images = await encodeImagesForApiUpload(files, onProgress, label);
  return notesUploadRequest<{ note: StudyNote; attachments: NoteAttachment[] }>(
    '/upload-images',
    { images, folderId, title },
    { onProgress, processingLabel: 'Saving photos…' }
  );
}

export async function addImagesToPhotoNote(
  noteId: string,
  files: File[],
  onProgress?: NoteImportProgressCallback
): Promise<{ attachments: NoteAttachment[] }> {
  if (files.length === 0) {
    throw new Error('Select at least one image.');
  }

  const label = files.length === 1 ? files[0].name : `${files.length} photos`;
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing photos…',
    fileName: label,
  });

  const images = await encodeImagesForApiUpload(files, onProgress, label);
  return notesUploadRequest<{ attachments: NoteAttachment[] }>(
    `/${noteId}/attachments/upload-images`,
    { images },
    { onProgress, processingLabel: 'Saving photos…' }
  );
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

/** @deprecated Prefer uploadNotePdfViaApi — uploads via API base64 endpoint. */
export async function uploadNotePdf(
  _userId: string,
  file: File,
  folderId?: string
): Promise<{ note: StudyNote; attachment: NoteAttachment }> {
  return uploadNotePdfViaApi(file, folderId);
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
