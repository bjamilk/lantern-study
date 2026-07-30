/** Mobile notes API client */
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL, getAuthHeaders, getSession, supabase } from './supabase';
import type { DailyQuizSession, StudyGoalMode } from '@lantern/shared';
import { assertNoteUploadSize } from '@lantern/shared/utils/noteUpload';
import { assertAllowedImageUpload } from '@lantern/shared';

async function pollApiJob<T>(jobId: string, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}`, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Job status check failed (${response.status})`);
    }
    const job = payload.data ?? payload;
    if (job.status === 'completed' && job.result !== undefined) {
      return job.result as T;
    }
    if (job.status === 'failed') {
      throw new Error(typeof job.error === 'string' ? job.error : 'AI job failed.');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('AI request timed out. Try again.');
}

async function notesRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    throw new Error(data.message || data.error || `Notes request failed (${response.status})`);
  }
  return data.data ?? data;
}

export interface NoteFolder {
  id: string;
  name: string;
  color?: string;
  userId?: string;
  createdAt?: string;
}

export interface StudyNote {
  id: string;
  userId?: string;
  title: string;
  body: string;
  folderId?: string;
  sourceType?: string;
  summary?: string;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  version?: number;
  isArchived?: boolean;
  isPinned?: boolean;
  pinnedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  accessRole?: 'owner' | 'editor' | 'viewer' | 'group_member';
  owner?: { id: string; name?: string; username?: string; avatarUrl?: string };
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  type: string;
  fileUrl?: string;
  fileName?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
}

export const fetchNoteFolders = () => notesRequest<NoteFolder[]>('/folders');
export const createNoteFolder = (payload: { name: string; color?: string }) =>
  notesRequest<NoteFolder>('/folders', { method: 'POST', body: JSON.stringify(payload) });
export const updateNoteFolder = (folderId: string, updates: { name?: string; color?: string }) =>
  notesRequest<NoteFolder>(`/folders/${folderId}`, { method: 'PATCH', body: JSON.stringify(updates) });
export const deleteNoteFolder = (folderId: string) =>
  notesRequest<void>(`/folders/${folderId}`, { method: 'DELETE' });

export const fetchNotes = (folderId?: string) => {
  const qs = folderId ? `?folderId=${folderId}` : '';
  return notesRequest<StudyNote[]>(`${qs}`);
};
export const fetchNote = (noteId: string) =>
  notesRequest<StudyNote & { attachments?: NoteAttachment[] }>(`/${noteId}`);
export const createNote = (payload: Partial<StudyNote>) =>
  notesRequest<StudyNote>('/', { method: 'POST', body: JSON.stringify(payload) });
export const updateNote = (
  noteId: string,
  updates: Partial<Omit<StudyNote, 'folderId'>> & { folderId?: string | null }
) => {
  const { version, ...rest } = updates;
  return notesRequest<StudyNote>(`/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...rest,
      ...(version != null ? { expectedVersion: version } : {}),
    }),
  });
};
export const deleteNote = (noteId: string) =>
  notesRequest<void>(`/${noteId}`, { method: 'DELETE' });
async function notesLongTimedRequest<T>(
  path: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await notesRequest<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onAbort);
  }
}

export const uploadLectureAudioForNote = (
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
  }
) =>
  notesLongTimedRequest<{
    storagePath: string;
    mimeType: string;
    byteLength: number;
    fileName: string;
  }>(
    '/upload-lecture-audio',
    {
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
    },
    { signal: options?.signal, timeoutMs: 180_000 }
  );

/** Skip storage hop for short lectures; keeps typical clips on the proven base64 path. */
/** Always prefer signed-URL storage when noteId is set — keeps Whisper payloads small. */
const LECTURE_STORAGE_PATH_MIN_BYTES = 0;

function estimateLectureByteLength(audioBase64: string, clientByteLength?: number): number {
  if (typeof clientByteLength === 'number' && clientByteLength > 0) return clientByteLength;
  return Math.ceil((audioBase64.length * 3) / 4);
}

function lectureAudioBytesFromBase64(audioBase64: string): Uint8Array {
  // Prefer Buffer when available (Hermes / metro polyfills often provide it).
  const Buf = (globalThis as { Buffer?: { from: (s: string, enc: string) => Uint8Array } }).Buffer;
  if (Buf) return new Uint8Array(Buf.from(audioBase64, 'base64'));
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob;
  if (!atobFn) throw new Error('Base64 decode unavailable');
  const binary = atobFn(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Device → Supabase signed-URL upload (skips API proxy body for large lectures).
 * Prefers FileSystem.uploadAsync when a local recording URI is available.
 */
export async function uploadLectureAudioViaSignedUrl(
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    clientByteLength?: number;
    localFileUri?: string;
  }
): Promise<{ storagePath: string; mimeType: string; byteLength: number; fileName: string }> {
  const estimatedBytes = estimateLectureByteLength(audioBase64, options?.clientByteLength);
  if (options?.signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  const prepared = await notesLongTimedRequest<{
    storagePath: string;
    signedUrl: string;
    token: string;
    mimeType: string;
    fileName: string;
    bucket: string;
  }>(
    '/prepare-lecture-audio-upload',
    {
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
      byteLength: estimatedBytes,
    },
    { signal: options?.signal, timeoutMs: 60_000 }
  );

  const contentType = prepared.mimeType || options?.mimeType || 'audio/webm';

  if (options?.localFileUri && prepared.signedUrl) {
    const uploadResult = await FileSystem.uploadAsync(prepared.signedUrl, options.localFileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
    });
    if (uploadResult.status >= 200 && uploadResult.status < 300) {
      return {
        storagePath: prepared.storagePath,
        mimeType: contentType,
        byteLength: estimatedBytes,
        fileName: prepared.fileName,
      };
    }
    console.warn(
      '[uploadLectureAudioViaSignedUrl] FileSystem PUT failed',
      uploadResult.status,
      String(uploadResult.body || '').slice(0, 200)
    );
  }

  const bytes = lectureAudioBytesFromBase64(audioBase64);
  const { error } = await supabase.storage
    .from(prepared.bucket || 'note-files')
    .uploadToSignedUrl(prepared.storagePath, prepared.token, bytes, {
      contentType,
    });
  if (error) {
    throw new Error(error.message || 'Direct storage upload failed');
  }

  return {
    storagePath: prepared.storagePath,
    mimeType: contentType,
    byteLength: bytes.length,
    fileName: prepared.fileName,
  };
}

export const transcribeAudioForNote = async (
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    currentBody?: string;
    durationMs?: number;
    clientByteLength?: number;
    /** Local recording file for signed-URL PUT via FileSystem.uploadAsync. */
    localFileUri?: string;
    useStoragePath?: boolean;
  }
) => {
  const preferStorage = options?.useStoragePath ?? Boolean(options?.noteId);
  const estimatedBytes = estimateLectureByteLength(audioBase64, options?.clientByteLength);
  const useStoragePath = preferStorage && estimatedBytes >= LECTURE_STORAGE_PATH_MIN_BYTES;
  let storagePath: string | undefined;
  let mimeType = options?.mimeType;
  let fileName = options?.fileName;
  let clientByteLength = options?.clientByteLength ?? estimatedBytes;

  if (useStoragePath) {
    try {
      try {
        const direct = await uploadLectureAudioViaSignedUrl(audioBase64, {
          mimeType,
          noteId: options?.noteId,
          fileName,
          signal: options?.signal,
          clientByteLength,
          localFileUri: options?.localFileUri,
        });
        storagePath = direct.storagePath;
        mimeType = direct.mimeType || mimeType;
        fileName = direct.fileName || fileName;
        clientByteLength = direct.byteLength;
      } catch (directErr) {
        if (directErr instanceof Error && directErr.name === 'AbortError') throw directErr;
        console.warn(
          '[transcribeAudioForNote] signed-URL upload failed; trying API proxy upload',
          directErr
        );
        const uploaded = await uploadLectureAudioForNote(audioBase64, {
          mimeType,
          noteId: options?.noteId,
          fileName,
          signal: options?.signal,
        });
        storagePath = uploaded.storagePath;
        mimeType = uploaded.mimeType || mimeType;
        fileName = uploaded.fileName || fileName;
        clientByteLength = uploaded.byteLength;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      console.warn('[transcribeAudioForNote] storage upload failed; falling back to base64', err);
      storagePath = undefined;
    }
  }

  const compactCurrentBody =
    typeof options?.currentBody === 'string' && options.currentBody.length <= 32_000
      ? options.currentBody
      : undefined;

  return notesLongTimedRequest<{ transcript: string; note?: StudyNote; persistWarning?: string }>(
    '/transcribe-audio',
    storagePath
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
        },
    { signal: options?.signal, timeoutMs: 120_000 }
  );
};

export const summarizeNote = (noteId: string) =>
  notesRequest<{ summary: string; note: StudyNote }>(`/${noteId}/summarize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const generateDailyQuizFromContent = (
  content: string,
  studyGoal: StudyGoalMode = 'retention',
  count: number = 5
) =>
  notesRequest<{
    questions: Array<{
      id?: string;
      text?: string;
      question?: string;
      type?: string;
      options?: string[];
      correctAnswer: string;
      explanation?: string;
      topic?: string;
    }>;
  }>('/daily-quiz', {
    method: 'POST',
    body: JSON.stringify({ content, studyGoal, count }),
  });

export const getNoteQuiz = (noteId: string) =>
  notesRequest<DailyQuizSession | null>(`/${noteId}/quiz`);

export const generateNoteQuiz = (
  noteId: string,
  studyGoal?: StudyGoalMode,
  count?: number
) =>
  notesRequest<DailyQuizSession>(`/${noteId}/quiz`, {
    method: 'POST',
    body: JSON.stringify({ studyGoal, count }),
  });

export const updateNoteQuiz = (
  noteId: string,
  updates: { answers?: Record<string, string>; completed?: boolean }
) =>
  notesRequest<DailyQuizSession>(`/${noteId}/quiz`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export const addNoteAttachment = (
  noteId: string,
  payload: {
    type: string;
    fileUrl?: string;
    fileName?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
  }
) =>
  notesRequest<NoteAttachment>(`/${noteId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const refreshNoteAttachmentUrl = (
  noteId: string,
  attachmentId: string,
  options?: { variant?: 'thumb' | 'original' }
) => {
  const variant = options?.variant || 'original';
  const qs = variant === 'thumb' ? '?variant=thumb' : '';
  return notesRequest<{ url: string; expiresIn: number; variant?: string }>(
    `/${noteId}/attachments/${attachmentId}/url${qs}`
  );
};

export const fetchNoteCollaborators = (noteId: string) =>
  notesRequest<Array<{ noteId: string; userId: string; role: string; user?: { id: string; name?: string } }>>(
    `/${noteId}/collaborators`
  );

export const addNoteCollaborator = (
  noteId: string,
  collaboratorUserId: string,
  role: 'viewer' | 'editor' = 'editor'
) =>
  notesRequest(`/${noteId}/collaborators`, {
    method: 'POST',
    body: JSON.stringify({ collaboratorUserId, role }),
  });

export const removeNoteCollaborator = (noteId: string, collaboratorUserId: string) =>
  notesRequest(`/${noteId}/collaborators/${collaboratorUserId}`, { method: 'DELETE' });

export const updateNoteCollaboratorRole = (
  noteId: string,
  collaboratorUserId: string,
  role: 'viewer' | 'editor'
) =>
  notesRequest(`/${noteId}/collaborators/${collaboratorUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });

export const leaveNoteCollaboration = (noteId: string) =>
  notesRequest(`/${noteId}/collaborators/me`, { method: 'DELETE' });

export const fetchNoteShareLinks = (noteId: string) => notesRequest(`/${noteId}/share-links`);

export const createNoteShareLink = (
  noteId: string,
  role: 'viewer' | 'editor' = 'viewer',
  expiresAt?: string | null
) =>
  notesRequest(`/${noteId}/share-links`, {
    method: 'POST',
    body: JSON.stringify({ role, expiresAt: expiresAt || null }),
  });

export const revokeNoteShareLink = (noteId: string, linkId: string) =>
  notesRequest(`/${noteId}/share-links/${linkId}`, { method: 'DELETE' });

export const previewNoteShareLink = (token: string) =>
  notesRequest(`/share/${encodeURIComponent(token)}/preview`);

export const acceptNoteShareLink = (token: string) =>
  notesRequest(`/share/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': `note-share-accept-${token}`,
    },
  });

export const copyNote = (noteId: string) =>
  notesRequest<StudyNote>(`/${noteId}/copy`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': `note-copy-${noteId}`,
    },
  });

export const shareNoteWithGroup = (noteId: string, groupId: string) =>
  notesRequest<StudyNote>(`/${noteId}/share-group`, {
    method: 'POST',
    body: JSON.stringify({ groupId }),
  });

export const fetchNoteAttachmentContent = async (noteId: string, attachmentId: string) => {
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
};

async function readLocalFileAsBase64(fileUri: string, fileName: string): Promise<{
  base64Data: string;
  byteLength: number;
}> {
  const info = await FileSystem.getInfoAsync(fileUri);
  const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  if (byteLength > 0) {
    assertNoteUploadSize(byteLength, fileName);
  }
  const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  if (!base64Data) {
    throw new Error('Could not read the selected file.');
  }
  if (byteLength <= 0) {
    // Rough size check when FileSystem does not report size.
    assertNoteUploadSize(Math.ceil((base64Data.length * 3) / 4), fileName);
  }
  return { base64Data, byteLength };
}

export const uploadNotePdfViaApi = async (
  fileUri: string,
  fileName: string,
  folderId?: string
) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Must be signed in to upload files.');
  }

  const { base64Data } = await readLocalFileAsBase64(fileUri, fileName);
  return notesRequest<{ note: StudyNote; attachment: NoteAttachment }>('/upload-pdf', {
    method: 'POST',
    body: JSON.stringify({ fileName, base64Data, folderId }),
  });
};

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

export const createNoteFromYoutube = async (
  url: string,
  folderId?: string
): Promise<YoutubeNoteImportResult> => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/notes/from-youtube`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, folderId }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 202) {
    throw new Error(data.message || data.error || `YouTube import failed (${response.status})`);
  }

  const base = (data.data ?? {}) as YoutubeNoteImportResult;
  if (!base.note) {
    throw new Error('YouTube import failed — no note was created.');
  }

  if (response.status === 202 && typeof data.jobId === 'string') {
    // Queue mode: wait for the job, then reload so the editor has extractedText.
    const jobResult = await pollApiJob<{ status?: 'ready' | 'failed'; error?: string }>(
      data.jobId,
      120_000
    );
    return resolveYoutubeImportAfterJob(base.note.id, base.attachment?.id, jobResult);
  }

  return base;
};

export const retryYoutubeTranscript = async (
  noteId: string
): Promise<YoutubeNoteImportResult> => {
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
    throw new Error(data.message || data.error || `Transcript retry failed (${response.status})`);
  }

  const base = (data.data ?? {}) as YoutubeNoteImportResult;
  if (response.status === 202 && typeof data.jobId === 'string') {
    const jobResult = await pollApiJob<{ status?: 'ready' | 'failed'; error?: string }>(
      data.jobId,
      120_000
    );
    return resolveYoutubeImportAfterJob(noteId, base.attachment?.id, jobResult);
  }

  if (!base.attachment) {
    return resolveYoutubeImportAfterJob(noteId, undefined, {
      status: base.status,
      error: base.transcriptError,
    });
  }

  return base;
};

export const uploadPresentationViaApi = async (
  fileUri: string,
  fileName: string,
  folderId?: string
) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Must be signed in to upload slides.');
  }

  const { base64Data } = await readLocalFileAsBase64(fileUri, fileName);
  return notesRequest<{ note: StudyNote; attachment: NoteAttachment; previewAvailable: boolean }>(
    '/upload-presentation',
    {
      method: 'POST',
      body: JSON.stringify({ fileName, base64Data, folderId }),
    }
  );
};

function imageContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export const reorderNoteAttachments = (noteId: string, attachmentIds: string[]) =>
  notesRequest<{ attachments: NoteAttachment[] }>(`/${noteId}/attachments/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ attachmentIds }),
  });

type MobileImageUpload = {
  uri: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
};

async function encodeMobileImagesForApi(
  images: MobileImageUpload[]
): Promise<Array<{ fileName: string; base64Data: string; contentType: string }>> {
  const { prepareImageBase64ForUpload } = await import('../utils/prepareImage');
  const encoded: Array<{ fileName: string; base64Data: string; contentType: string }> = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const fileName = image.fileName || `photo-${i + 1}.jpg`;
    const contentType = image.mimeType || imageContentTypeFromFileName(fileName);
    const info = await FileSystem.getInfoAsync(image.uri);
    const byteLength =
      typeof image.size === 'number' && image.size > 0
        ? image.size
        : info.exists && 'size' in info
          ? Number(info.size) || 0
          : 0;
    // Pre-check original size so obviously huge picks fail fast before compress.
    if (byteLength > 0) {
      assertNoteUploadSize(byteLength, fileName);
      assertAllowedImageUpload({ contentType, byteLength });
    }

    const prepared = await prepareImageBase64ForUpload(image.uri, 'notePhoto', {
      fileName,
      mimeType: contentType,
    });
    const preparedBytes = Math.ceil((prepared.base64Data.length * 3) / 4);
    assertAllowedImageUpload({
      contentType: prepared.contentType,
      byteLength: preparedBytes,
    });

    encoded.push({
      fileName: prepared.fileName,
      base64Data: prepared.base64Data,
      contentType: prepared.contentType,
    });
  }

  return encoded;
}

export const uploadNoteImagesViaApi = async (
  images: MobileImageUpload[],
  folderId?: string,
  title?: string
) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Must be signed in to upload photos.');
  }
  if (images.length === 0) {
    throw new Error('Select at least one image.');
  }

  const encoded = await encodeMobileImagesForApi(images);
  return notesRequest<{ note: StudyNote; attachments: NoteAttachment[] }>('/upload-images', {
    method: 'POST',
    body: JSON.stringify({ images: encoded, folderId, title }),
  });
};

export const addImagesToPhotoNote = async (noteId: string, images: MobileImageUpload[]) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Must be signed in to upload photos.');
  }
  if (images.length === 0) {
    throw new Error('Select at least one image.');
  }

  const encoded = await encodeMobileImagesForApi(images);
  return notesRequest<{ attachments: NoteAttachment[] }>(`/${noteId}/attachments/upload-images`, {
    method: 'POST',
    body: JSON.stringify({ images: encoded }),
  });
};
