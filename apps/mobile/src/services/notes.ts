/** Mobile notes API client */
import * as FileSystem from 'expo-file-system';
import { API_BASE_URL, getAuthHeaders, getSession } from './supabase';
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
  title: string;
  body: string;
  folderId?: string;
  sourceType?: string;
  summary?: string;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  version?: number;
  updatedAt?: string;
  createdAt?: string;
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
export const updateNote = (noteId: string, updates: Partial<StudyNote>) => {
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
export const transcribeAudioForNote = (
  audioBase64: string,
  options?: {
    mimeType?: string;
    noteId?: string;
    fileName?: string;
    signal?: AbortSignal;
    currentBody?: string;
  }
) =>
  notesRequest<{ transcript: string; note?: StudyNote }>('/transcribe-audio', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
      currentBody: options?.currentBody,
    }),
    signal: options?.signal,
  });

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
  notesRequest<{ questions: Array<{ id: string; question: string; options?: string[]; correctAnswer: string }> }>(
    '/daily-quiz',
    { method: 'POST', body: JSON.stringify({ content, studyGoal, count }) }
  );

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

export const refreshNoteAttachmentUrl = (noteId: string, attachmentId: string) =>
  notesRequest<{ url: string; expiresIn: number }>(`/${noteId}/attachments/${attachmentId}/url`);

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
    assertAllowedImageUpload({ contentType, byteLength: byteLength || undefined });
    if (byteLength > 0) {
      assertNoteUploadSize(byteLength, fileName);
    }

    const base64Data = await FileSystem.readAsStringAsync(image.uri, { encoding: 'base64' });
    if (!base64Data) {
      throw new Error('Could not read the selected image.');
    }
    if (byteLength <= 0) {
      assertNoteUploadSize(Math.ceil((base64Data.length * 3) / 4), fileName);
      assertAllowedImageUpload({
        contentType,
        byteLength: Math.ceil((base64Data.length * 3) / 4),
      });
    }

    encoded.push({ fileName, base64Data, contentType });
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
