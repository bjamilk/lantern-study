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
import { applyAIUsageFromResponse, applyAIUsageFromXhr, applyAIUsageFromErrorBody } from './ai';
import { UNFILED_COURSE_ID } from '../utils/libraryArchive';
import { getAuthHeaders, supabase } from './supabase';
import { pollApiJob } from './jobPoll';
import { applyJsonXhrHeaders } from '../utils/xhrHeaders';

const API_BASE_URL = getApiBaseUrl();

import {
  DOCX_MIME,
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

    applyJsonXhrHeaders(xhr, headers);

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

/**
 * What a caller needs to keep a queued generation after this page is gone.
 *
 * `onServerJob` receives the id from the 202 — the only handle a reload has on
 * a run that is still going — and `onServerProgress` carries the server's own
 * stage and percent, which is the only honest source for a progress bar.
 */
export interface NoteJobHooks {
  onServerJob?: (jobId: string) => void;
  onServerProgress?: (progress: { stage?: string; percent?: number }) => void;
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
  } & NoteJobHooks
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

    applyJsonXhrHeaders(xhr, headers);

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
      // Rate-limit middleware sets usage headers on the enqueue/sync response.
      if (xhr.status >= 200 && xhr.status < 300) {
        applyAIUsageFromXhr(xhr);
      }
      if (xhr.status === 202 && typeof data.jobId === 'string') {
        // Handed over BEFORE the watch starts: a reload one second later still
        // knows which server job to reattach to.
        options?.onServerJob?.(data.jobId);
        void pollApiJob<T>(data.jobId, { onProgress: options?.onServerProgress })
          .then(resolve)
          .catch(reject);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((data.data ?? data) as T);
        return;
      }
      if (xhr.status === 429) {
        applyAIUsageFromErrorBody(data);
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
  if (response.ok || response.status === 202) {
    applyAIUsageFromResponse(response);
  } else if (response.status === 429) {
    // A refused request must still correct the badge.
    applyAIUsageFromErrorBody(data);
  }
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
  body: Record<string, unknown> = {},
  hooks?: NoteJobHooks
): Promise<T> {
  return notesLongRequest<T>(path, {
    method: 'POST',
    body,
    processingLabel: 'Generating with AI…',
    timeoutMs: 120_000,
    ...hooks,
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
  /** Academic archive filter (`GET /notes?courseId`). */
  courseId?: string | null;
  /** Topic within `courseId`; the literal `'null'` is "in the course, under no topic". */
  topicId?: string | null;
  studySetId?: string;
  /** When set, only active (`false`) or archived (`true`) notes. Omit for both. */
  archived?: boolean;
}): Promise<StudyNote[]> {
  const params = new URLSearchParams();
  if (options?.folderId) params.set('folderId', options.folderId);
  if (options?.groupId) params.set('groupId', options.groupId);
  if (options?.studySetId) params.set('studySetId', options.studySetId);
  if (options?.courseId) params.set('courseId', options.courseId);
  // Never alone: a topic only means something inside its course (services/library.ts).
  if (options?.courseId && options.courseId !== UNFILED_COURSE_ID && options?.topicId) {
    params.set('topicId', options.topicId);
  }
  if (options?.archived === true) params.set('archived', 'true');
  else if (options?.archived === false) params.set('archived', 'false');
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
      ...(payload.courseId !== undefined ? { courseId: payload.courseId } : {}),
      ...(payload.studySetId !== undefined ? { studySetId: payload.studySetId } : {}),
      ...(payload.topicId !== undefined ? { topicId: payload.topicId } : {}),
      sourceType: payload.sourceType,
      youtubeUrl: payload.youtubeUrl,
      youtubeVideoId: payload.youtubeVideoId,
      summary: payload.summary,
    }),
  });
}

export async function updateNote(
  noteId: string,
  updates: Partial<Omit<StudyNote, 'folderId'>> & { folderId?: string | null }
): Promise<StudyNote> {
  const { version, ...rest } = updates;
  // When `version` is present the server runs an optimistic-concurrency check
  // and 409s on a stale write. Do NOT swallow that conflict by silently
  // refetching — the caller (notesStore.saveNote) must surface it to the user
  // and reload the authoritative note. The thrown Error carries
  // `code: 'version_conflict'` and `current` (the authoritative note).
  return notesRequest<StudyNote>(`/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...rest,
      ...(version != null ? { expectedVersion: version } : {}),
    }),
  });
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
          'Slide preview is unavailable. AI tools need readable extracted text — check extraction status on the note.',
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

    const payload = (data.data ?? data) as {
      status?: PresentationPreviewStatus;
      previewError?: string;
      previewAvailable?: boolean;
      attachment?: NoteAttachment | null;
    };
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

export async function summarizeNote(
  noteId: string,
  options?: import('@lantern/shared/utils/smartNotes').SmartNotesRequestOptions
): Promise<{ summary: string; note: StudyNote }> {
  const result = await notesAiRequest<{ summary: string; note?: StudyNote; provider?: string }>(
    `/${noteId}/summarize`,
    (options ?? {}) as Record<string, unknown>
  );
  if (result.note) {
    return { summary: result.summary, note: result.note };
  }
  const note = await fetchNote(noteId);
  return { summary: result.summary, note };
}

export async function generateFlashcardsFromNote(
  noteId: string,
  options?: { count?: number; style?: 'concise' | 'detailed' },
  hooks?: NoteJobHooks
): Promise<{ flashcards: Array<{ front: string; back: string; mnemonic?: string; example?: string }>; provider: string }> {
  return notesAiRequest(`/${noteId}/generate-flashcards`, options || {}, hooks);
}

export async function reextractNoteText(
  noteId: string
): Promise<{ attachment: NoteAttachment; extractedText: string; contentLength: number }> {
  return notesRequest(`/${noteId}/reextract-text`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export type NoteOcrStatus = 'ready' | 'processing' | 'failed' | 'none' | 'needs_ocr';

export async function fetchNoteOcrStatus(noteId: string): Promise<{
  status: NoteOcrStatus;
  attachment?: NoteAttachment | null;
  attachments?: NoteAttachment[];
  extractionStatus?: string;
  ocrProvider?: string;
  ocrPageCount?: number;
  ocrError?: string;
  ocrMaxPages?: number;
  ocrMaxSlides?: number;
}> {
  return notesRequest(`/${noteId}/ocr-status`);
}

const OCR_POLL_DEADLINE_MS = 240_000;
const ocrPollsInFlight = new Set<string>();

function primaryOcrAttachment(status: {
  attachment?: NoteAttachment | null;
  attachments?: NoteAttachment[] | null;
}): NoteAttachment | undefined {
  return status.attachment || status.attachments?.[0] || undefined;
}

async function pollNoteOcrUntilReady(noteId: string): Promise<{
  status: NoteOcrStatus;
  attachment: NoteAttachment;
  attachments?: NoteAttachment[];
  ocrError?: string;
}> {
  const deadline = Date.now() + OCR_POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    const status = await fetchNoteOcrStatus(noteId);
    const attachment = primaryOcrAttachment(status);
    const attachments = status.attachments?.length
      ? status.attachments
      : attachment
        ? [attachment]
        : undefined;
    if (status.status === 'ready' && attachment) {
      return { status: 'ready', attachment, attachments };
    }
    if (status.status === 'failed') {
      return {
        status: 'failed',
        attachment: attachment!,
        attachments,
        ocrError:
          status.ocrError ||
          'Local OCR could not read this file. Add notes manually, or try a text-based export.',
      };
    }
    if (status.status === 'none') {
      throw new Error('No document attachment found for OCR.');
    }
    if (status.status === 'needs_ocr' && attachment) {
      // Not started / idle — caller should POST /ocr first.
      return { status: 'needs_ocr', attachment, attachments };
    }
    await sleep(3000);
  }
  throw new Error('OCR timed out. Try again from the note, or add your own notes.');
}

/** Start OCR (if needed) and poll until ready/failed. */
export async function runNoteOcr(
  noteId: string
): Promise<{
  status: NoteOcrStatus;
  attachment: NoteAttachment;
  attachments?: NoteAttachment[];
  ocrError?: string;
}> {
  if (ocrPollsInFlight.has(noteId)) {
    return pollNoteOcrUntilReady(noteId);
  }
  ocrPollsInFlight.add(noteId);
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/notes/${noteId}/ocr`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const data = (await response.json().catch(() => ({}))) as {
      data?: {
        status?: NoteOcrStatus;
        attachment?: NoteAttachment;
        attachments?: NoteAttachment[];
        ocrError?: string;
      };
      error?: string;
      message?: string;
    };
    if (response.status === 429) {
      throw new Error(data.error || data.message || 'Daily AI limit reached for OCR.');
    }
    if (!response.ok && response.status !== 202) {
      throw new Error(data.error || data.message || 'Failed to start OCR.');
    }
    const payload = data.data;
    if (payload?.status === 'ready' && payload.attachment) {
      return {
        status: 'ready',
        attachment: payload.attachment,
        attachments: payload.attachments,
      };
    }
    if (payload?.status === 'failed' && payload.attachment) {
      return {
        status: 'failed',
        attachment: payload.attachment,
        attachments: payload.attachments,
        ocrError: payload.ocrError,
      };
    }
    return pollNoteOcrUntilReady(noteId);
  } finally {
    ocrPollsInFlight.delete(noteId);
  }
}

/** Poll only — use when upload already queued OCR. */
export async function waitForNoteOcr(
  noteId: string
): Promise<{
  status: NoteOcrStatus;
  attachment: NoteAttachment;
  attachments?: NoteAttachment[];
  ocrError?: string;
}> {
  if (ocrPollsInFlight.has(noteId)) {
    return pollNoteOcrUntilReady(noteId);
  }
  ocrPollsInFlight.add(noteId);
  try {
    return await pollNoteOcrUntilReady(noteId);
  } finally {
    ocrPollsInFlight.delete(noteId);
  }
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
  count?: number,
  hooks?: NoteJobHooks
): Promise<DailyQuizSession> {
  return notesAiRequest<DailyQuizSession>(`/${noteId}/quiz`, { studyGoal, count }, hooks);
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

export async function uploadLectureAudioForNote(
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    onProgress?: NoteImportProgressCallback;
  }
): Promise<{ storagePath: string; mimeType: string; byteLength: number; fileName: string }> {
  return notesLongRequest<{
    storagePath: string;
    mimeType: string;
    byteLength: number;
    fileName: string;
  }>('/upload-lecture-audio', {
    body: {
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
    },
    processingLabel: 'Uploading recording…',
    timeoutMs: 180_000,
    signal: options?.signal,
    onProgress: options?.onProgress,
  });
}

/**
 * Always prefer signed-URL storage when a noteId is present.
 * Large audioBase64 JSON through the CF Pages → Render proxy often arrives with an
 * empty body (API then returns "audioBase64 or storagePath is required").
 */
const LECTURE_STORAGE_PATH_MIN_BYTES = 0;

function estimateLectureByteLength(audioBase64: string, clientByteLength?: number): number {
  if (typeof clientByteLength === 'number' && clientByteLength > 0) return clientByteLength;
  return Math.ceil((audioBase64.length * 3) / 4);
}

function lectureAudioBytesFromBase64(audioBase64: string): Uint8Array {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Browser → Supabase signed-URL PUT (skips CF proxy body for large lectures).
 * Falls back to caller when prepare or PUT fails.
 */
export async function uploadLectureAudioViaSignedUrl(
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    clientByteLength?: number;
    audioBlob?: Blob;
    onProgress?: NoteImportProgressCallback;
  }
): Promise<{ storagePath: string; mimeType: string; byteLength: number; fileName: string }> {
  const estimatedBytes = estimateLectureByteLength(audioBase64, options?.clientByteLength);
  options?.onProgress?.({
    stage: 'uploading',
    percent: null,
    label: 'Preparing direct upload…',
    fileName: options?.fileName,
  });

  const prepared = await notesLongRequest<{
    storagePath: string;
    signedUrl: string;
    token: string;
    mimeType: string;
    fileName: string;
    bucket: string;
  }>('/prepare-lecture-audio-upload', {
    body: {
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
      byteLength: estimatedBytes,
    },
    processingLabel: 'Preparing direct upload…',
    timeoutMs: 60_000,
    signal: options?.signal,
    onProgress: options?.onProgress,
  });

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const body: Blob =
    options?.audioBlob ??
    new Blob([lectureAudioBytesFromBase64(audioBase64)], {
      type: prepared.mimeType || options?.mimeType || 'audio/webm',
    });

  options?.onProgress?.({
    stage: 'uploading',
    percent: null,
    label: 'Uploading recording…',
    fileName: prepared.fileName,
  });

  // Prefer PUT to the signed URL so AbortSignal works; fall back to supabase-js helper.
  let uploadOk = false;
  if (prepared.signedUrl) {
    const response = await fetch(prepared.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': prepared.mimeType || options?.mimeType || 'audio/webm',
        'x-upsert': 'false',
      },
      body,
      signal: options?.signal,
    });
    if (response.ok) {
      uploadOk = true;
    } else {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      console.warn('[uploadLectureAudioViaSignedUrl] signed PUT failed', response.status, detail);
    }
  }

  if (!uploadOk) {
    const { error } = await supabase.storage
      .from(prepared.bucket || 'note-files')
      .uploadToSignedUrl(prepared.storagePath, prepared.token, body, {
        contentType: prepared.mimeType || options?.mimeType || 'audio/webm',
      });
    if (error) {
      throw new Error(error.message || 'Direct storage upload failed');
    }
  }

  return {
    storagePath: prepared.storagePath,
    mimeType: prepared.mimeType || options?.mimeType || 'audio/webm',
    byteLength: typeof body.size === 'number' && body.size > 0 ? body.size : estimatedBytes,
    fileName: prepared.fileName,
  };
}

export async function transcribeAudioForNote(
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    currentBody?: string;
    durationMs?: number;
    clientByteLength?: number;
    /** When set (web), used for signed-URL PUT without re-decoding base64. */
    audioBlob?: Blob;
    /** Prefer storage upload then path-based Whisper (default true when noteId is set). */
    useStoragePath?: boolean;
    onProgress?: NoteImportProgressCallback;
  }
): Promise<{ transcript: string; note?: StudyNote; persistWarning?: string }> {
  const preferStorage = options?.useStoragePath ?? Boolean(options?.noteId);
  const estimatedBytes = estimateLectureByteLength(audioBase64, options?.clientByteLength);
  const useStoragePath = preferStorage && estimatedBytes >= LECTURE_STORAGE_PATH_MIN_BYTES;
  let storagePath: string | undefined;
  let mimeType = options?.mimeType;
  let fileName = options?.fileName;
  let clientByteLength = options?.clientByteLength ?? estimatedBytes;

  if (useStoragePath) {
    options?.onProgress?.({
      stage: 'uploading',
      percent: null,
      label: 'Uploading recording…',
      fileName,
    });
    try {
      // Prefer browser → Supabase signed URL (avoids CF proxy timeouts on large clips).
      try {
        const direct = await uploadLectureAudioViaSignedUrl(audioBase64, {
          mimeType,
          noteId: options?.noteId,
          fileName,
          signal: options?.signal,
          clientByteLength,
          audioBlob: options?.audioBlob,
          onProgress: options?.onProgress,
        });
        storagePath = direct.storagePath;
        mimeType = direct.mimeType || mimeType;
        fileName = direct.fileName || fileName;
        clientByteLength = direct.byteLength;
      } catch (directErr) {
        if (directErr instanceof DOMException && directErr.name === 'AbortError') throw directErr;
        console.warn(
          '[transcribeAudioForNote] signed-URL upload failed; trying API proxy upload',
          directErr
        );
        const uploaded = await uploadLectureAudioForNote(audioBase64, {
          mimeType,
          noteId: options?.noteId,
          fileName,
          signal: options?.signal,
          onProgress: options?.onProgress,
        });
        storagePath = uploaded.storagePath;
        mimeType = uploaded.mimeType || mimeType;
        fileName = uploaded.fileName || fileName;
        clientByteLength = uploaded.byteLength;
      }
    } catch (err) {
      // Unblock transcription: storage hop is best-effort; Whisper still accepts base64.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn('[transcribeAudioForNote] storage upload failed; falling back to base64', err);
      options?.onProgress?.({
        stage: 'processing',
        percent: null,
        label: 'Upload failed — transcribing directly…',
        fileName,
      });
      storagePath = undefined;
    }
  }

  options?.onProgress?.({
    stage: 'processing',
    percent: null,
    label: 'Transcribing audio…',
    fileName,
  });

  // Keep the JSON small — large currentBody + audioBase64 through the CF proxy is unreliable.
  const compactCurrentBody =
    typeof options?.currentBody === 'string' && options.currentBody.length <= 32_000
      ? options.currentBody
      : undefined;

  const transcribeBody = storagePath
    ? {
        storagePath,
        mimeType,
        noteId: options?.noteId,
        fileName,
        currentBody: compactCurrentBody,
        durationMs: options?.durationMs,
        clientByteLength,
      }
    : {
        audioBase64,
        mimeType,
        noteId: options?.noteId,
        fileName,
        currentBody: compactCurrentBody,
        durationMs: options?.durationMs,
        clientByteLength,
      };

  if (!storagePath && !audioBase64) {
    throw new Error('Recording upload produced no audio data. Please try again.');
  }

  return notesLongRequest<{ transcript: string; note?: StudyNote; persistWarning?: string }>('/transcribe-audio', {
    body: transcribeBody,
    processingLabel: 'Transcribing audio…',
    timeoutMs: 120_000,
    signal: options?.signal,
    onProgress: options?.onProgress,
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

export async function updateNoteCollaboratorRole(
  noteId: string,
  collaboratorUserId: string,
  role: 'viewer' | 'editor'
) {
  return notesRequest(`/${noteId}/collaborators/${collaboratorUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function leaveNoteCollaboration(noteId: string) {
  return notesRequest(`/${noteId}/collaborators/me`, { method: 'DELETE' });
}

export async function fetchNoteShareLinks(noteId: string) {
  return notesRequest(`/${noteId}/share-links`);
}

export async function createNoteShareLink(
  noteId: string,
  role: 'viewer' | 'editor' = 'viewer',
  expiresAt?: string | null
) {
  return notesRequest(`/${noteId}/share-links`, {
    method: 'POST',
    body: JSON.stringify({ role, expiresAt: expiresAt || null }),
  });
}

export async function revokeNoteShareLink(noteId: string, linkId: string) {
  return notesRequest(`/${noteId}/share-links/${linkId}`, { method: 'DELETE' });
}

export async function previewNoteShareLink(token: string) {
  return notesRequest(`/share/${encodeURIComponent(token)}/preview`);
}

export async function acceptNoteShareLink(token: string) {
  return notesRequest(`/share/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': `note-share-accept-${token}`,
    },
  });
}

export async function copyNote(noteId: string): Promise<StudyNote> {
  return notesRequest<StudyNote>(`/${noteId}/copy`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': `note-copy-${noteId}`,
    },
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
  attachmentId: string,
  options?: { variant?: 'thumb' | 'original' }
): Promise<{ url: string; expiresIn: number; variant?: string }> {
  const variant = options?.variant || 'original';
  const qs = variant === 'thumb' ? '?variant=thumb' : '';
  return notesRequest<{ url: string; expiresIn: number; variant?: string }>(
    `/${noteId}/attachments/${attachmentId}/url${qs}`
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

export interface YoutubeNoteImportResult {
  note: StudyNote;
  attachment: NoteAttachment;
  status: 'ready' | 'failed' | 'processing';
  transcriptError?: string;
}

async function resolveYoutubeImportAfterJob(
  noteId: string,
  attachmentId: string | undefined,
  jobResult: { status?: 'ready' | 'failed'; error?: string }
): Promise<YoutubeNoteImportResult> {
  const note = await fetchNote(noteId);
  const attachment =
    note.attachments?.find((a) => a.id === attachmentId) ||
    note.attachments?.find((a) => a.type === 'youtube');
  if (!attachment) {
    throw new Error('YouTube note was created, but the transcript attachment is missing.');
  }
  const metaStatus = attachment.metadata?.transcriptStatus;
  const status: YoutubeNoteImportResult['status'] =
    jobResult.status === 'ready' || metaStatus === 'ready'
      ? 'ready'
      : jobResult.status === 'failed' || metaStatus === 'failed'
        ? 'failed'
        : 'processing';
  const transcriptError =
    typeof attachment.metadata?.transcriptError === 'string'
      ? attachment.metadata.transcriptError
      : jobResult.error;
  return {
    note,
    attachment,
    status,
    ...(status === 'failed' && transcriptError ? { transcriptError } : {}),
  };
}

export async function createNoteFromYoutube(
  url: string,
  folderId?: string,
  onProgress?: NoteImportProgressCallback
): Promise<YoutubeNoteImportResult> {
  onProgress?.({
    stage: 'processing',
    percent: null,
    label: 'Fetching video transcript…',
    fileName: url,
  });

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/notes/from-youtube`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, folderId }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 202) {
    throw new Error(
      data.message ||
        (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        `YouTube import failed (${response.status})`
    );
  }

  const base = (data.data ?? {}) as YoutubeNoteImportResult;
  if (!base.note) {
    throw new Error('YouTube import failed — no note was created.');
  }

  if (response.status === 202 && typeof data.jobId === 'string') {
    // Queue mode: the note exists already; wait for the transcript job, then reload
    // so the editor has extractedText (the 202 payload only has a processing stub).
    const jobResult = await pollApiJob<{ status?: 'ready' | 'failed'; error?: string }>(
      data.jobId,
      { timeoutMs: 120_000 }
    );
    return resolveYoutubeImportAfterJob(base.note.id, base.attachment?.id, jobResult);
  }

  return base;
}

export async function retryYoutubeTranscript(
  noteId: string
): Promise<YoutubeNoteImportResult> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/api/v1/notes/${noteId}/retry-youtube-transcript`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 202) {
    throw new Error(
      data.message ||
        (typeof data.error === 'string' && data.error !== 'Error' ? data.error : null) ||
        `Transcript retry failed (${response.status})`
    );
  }

  const base = (data.data ?? {}) as YoutubeNoteImportResult;
  if (response.status === 202 && typeof data.jobId === 'string') {
    const jobResult = await pollApiJob<{ status?: 'ready' | 'failed'; error?: string }>(
      data.jobId,
      { timeoutMs: 120_000 }
    );
    return resolveYoutubeImportAfterJob(noteId, base.attachment?.id, jobResult);
  }

  if (!base.attachment) {
    const note = await fetchNote(noteId);
    const attachment = note.attachments?.find((a) => a.type === 'youtube');
    if (!attachment) {
      throw new Error('Transcript retry failed — attachment missing.');
    }
    return {
      note,
      attachment,
      status: base.status || (attachment.extractedText ? 'ready' : 'failed'),
      transcriptError: base.transcriptError,
    };
  }

  return base;
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
  const result = await notesUploadRequest<{
    note: StudyNote;
    attachment: NoteAttachment;
    ocrQueued?: boolean;
    extractionStatus?: string;
  }>('/upload-pdf', { fileName: file.name, base64Data, folderId }, {
    onProgress,
    processingLabel: 'Extracting text from PDF…',
  });

  const needsOcrWait =
    result.ocrQueued ||
    result.extractionStatus === 'ocr_processing' ||
    result.attachment?.metadata?.extractionStatus === 'ocr_processing';

  if (needsOcrWait && result.note?.id) {
    onProgress?.({
      stage: 'processing',
      percent: null,
      label: 'Running OCR on scanned pages…',
      fileName: file.name,
    });
    try {
      const ocr = await waitForNoteOcr(result.note.id);
      return {
        note: result.note,
        attachment: ocr.attachment || result.attachment,
      };
    } catch {
      return { note: result.note, attachment: result.attachment };
    }
  }

  return { note: result.note, attachment: result.attachment };
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

/**
 * The one mime a .docx may declare, and the one the server will accept. Spelled
 * in `@lantern/shared/utils/noteUpload` because the phone's document picker
 * asks for the same string; kept under this name so existing callers do not
 * move.
 */
export const DOCX_CONTENT_TYPE = DOCX_MIME;

/**
 * Read the text out of a Word document. Creates nothing — the caller makes an
 * ordinary note from what comes back, exactly as the paste door does.
 *
 * This is why a .docx has no `uploadDocumentViaApi` twin of
 * `uploadNotePdfViaApi`: the bytes are never stored. A Word document has no
 * page model and no preview to render, so keeping the file would buy a storage
 * object and a signed URL nobody reads. Legacy binary `.doc` is not supported
 * and the server says so by name.
 */
export async function extractDocumentTextViaApi(
  file: File,
  onProgress?: NoteImportProgressCallback
): Promise<{ title: string; text: string; truncated: boolean }> {
  assertUploadFileSize(file);
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Reading document…',
    fileName: file.name,
  });

  const base64Data = await fileToBase64(file);
  return notesUploadRequest<{ title: string; text: string; truncated: boolean }>(
    '/extract-document-text',
    {
      fileName: file.name,
      base64Data,
      // Sent as a cross-check only; the server decides from the name and bytes.
      contentType: file.type || DOCX_CONTENT_TYPE,
    },
    {
      onProgress,
      processingLabel: 'Extracting text from the document…',
    }
  );
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
  // Always compress note photos (OCR-friendly 2000px cap) to cut storage + egress.
  try {
    const compressed = await compressImage(file, {
      maxWidth: 2000,
      maxHeight: 2000,
      quality: 0.82,
      outputType: 'file',
    });
    if (compressed instanceof File) {
      assertAllowedImageUpload({ contentType: compressed.type, byteLength: compressed.size });
      return compressed;
    }
  } catch {
    // keep original file if canvas compression fails
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
    if (!file) continue;
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

  const label = title?.trim() || (files.length === 1 ? files[0]!.name : `${files.length} photos`);
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing photos…',
    fileName: label,
  });

  const images = await encodeImagesForApiUpload(files, onProgress, label);
  const result = await notesUploadRequest<{
    note: StudyNote;
    attachments: NoteAttachment[];
    ocrQueued?: boolean;
  }>('/upload-images', { images, folderId, title }, { onProgress, processingLabel: 'Saving photos…' });

  const needsOcrWait =
    result.ocrQueued ||
    result.attachments?.some((a) => a.metadata?.extractionStatus === 'ocr_processing');

  if (needsOcrWait && result.note?.id) {
    onProgress?.({
      stage: 'processing',
      percent: null,
      label: 'Reading text from your photos…',
      fileName: label,
    });
    try {
      const ocr = await waitForNoteOcr(result.note.id);
      const refreshed = await fetchNote(result.note.id);
      return {
        note: refreshed,
        attachments:
          ocr.attachments?.length
            ? ocr.attachments
            : refreshed.attachments ?? result.attachments,
      };
    } catch {
      return { note: result.note, attachments: result.attachments };
    }
  }

  return { note: result.note, attachments: result.attachments };
}

export async function addImagesToPhotoNote(
  noteId: string,
  files: File[],
  onProgress?: NoteImportProgressCallback
): Promise<{ attachments: NoteAttachment[] }> {
  if (files.length === 0) {
    throw new Error('Select at least one image.');
  }

  const label = files.length === 1 ? files[0]!.name : `${files.length} photos`;
  onProgress?.({
    stage: 'encoding',
    percent: null,
    label: 'Preparing photos…',
    fileName: label,
  });

  const images = await encodeImagesForApiUpload(files, onProgress, label);
  const result = await notesUploadRequest<{
    attachments: NoteAttachment[];
    ocrQueued?: boolean;
  }>(`/${noteId}/attachments/upload-images`, { images }, { onProgress, processingLabel: 'Saving photos…' });

  const needsOcrWait =
    result.ocrQueued ||
    result.attachments?.some((a) => a.metadata?.extractionStatus === 'ocr_processing');
  if (needsOcrWait) {
    onProgress?.({
      stage: 'processing',
      percent: null,
      label: 'Reading text from your photos…',
      fileName: label,
    });
    try {
      const ocr = await waitForNoteOcr(noteId);
      if (ocr.attachments?.length) return { attachments: ocr.attachments };
    } catch {
      // Editor can retry OCR from the note.
    }
  }
  return { attachments: result.attachments };
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
