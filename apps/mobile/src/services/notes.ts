/** Mobile notes API client */
import { API_BASE_URL, getAuthHeaders, getSession, supabase } from './supabase';
import type { DailyQuizSession, StudyGoalMode } from '@lantern/shared';
import { assertNoteUploadSize, wrapNoteFinalizeError } from '@lantern/shared/utils/noteUpload';

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
export const updateNote = (noteId: string, updates: Partial<StudyNote>) =>
  notesRequest<StudyNote>(`/${noteId}`, { method: 'PATCH', body: JSON.stringify(updates) });
export const deleteNote = (noteId: string) =>
  notesRequest<void>(`/${noteId}`, { method: 'DELETE' });
export const transcribeAudioForNote = (
  audioBase64: string,
  options?: { mimeType?: string; noteId?: string; fileName?: string; signal?: AbortSignal }
) =>
  notesRequest<{ transcript: string }>('/transcribe-audio', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64,
      mimeType: options?.mimeType,
      noteId: options?.noteId,
      fileName: options?.fileName,
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

export const uploadNotePdfViaApi = async (
  fileUri: string,
  fileName: string,
  folderId?: string
) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Must be signed in to upload files.');
  }

  const storagePath = `${session.user.id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const fileResponse = await fetch(fileUri);
  if (!fileResponse.ok) {
    throw new Error('Could not read the selected PDF file.');
  }
  const blob = await fileResponse.blob();
  assertNoteUploadSize(blob.size, fileName);

  const { error: uploadError } = await supabase.storage.from('note-files').upload(storagePath, blob, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadError) {
    throw new Error(uploadError.message || 'Storage upload failed.');
  }

  try {
    return notesRequest<{ note: StudyNote; attachment: NoteAttachment }>('/finalize-pdf', {
      method: 'POST',
      body: JSON.stringify({ storagePath, fileName, folderId }),
    });
  } catch (err) {
    await supabase.storage.from('note-files').remove([storagePath]).catch(() => {});
    throw wrapNoteFinalizeError(err);
  }
};

export const uploadPresentationViaApi = async (
  fileUri: string,
  fileName: string,
  folderId?: string
) => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    throw new Error('Must be signed in to upload slides.');
  }

  const storagePath = `${user.id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const contentType =
    /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName)
      ? 'application/vnd.ms-powerpoint'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  const fileResponse = await fetch(fileUri);
  if (!fileResponse.ok) {
    throw new Error('Could not read the selected presentation file.');
  }
  const blob = await fileResponse.blob();
  assertNoteUploadSize(blob.size, fileName);

  const { error: uploadError } = await supabase.storage.from('note-files').upload(storagePath, blob, {
    contentType,
    upsert: false,
  });
  if (uploadError) {
    throw new Error(uploadError.message || 'Storage upload failed.');
  }

  try {
    return notesRequest<{ note: StudyNote; attachment: NoteAttachment; previewAvailable: boolean }>(
      '/finalize-presentation',
      {
        method: 'POST',
        body: JSON.stringify({ storagePath, fileName, folderId }),
      }
    );
  } catch (err) {
    await supabase.storage.from('note-files').remove([storagePath]).catch(() => {});
    throw wrapNoteFinalizeError(err);
  }
};
