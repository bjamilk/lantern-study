import { refreshNoteAttachmentUrl } from './notes';
import { resetAuthRefreshBackoff, supabase } from './supabase';

/**
 * The one place the phone asks the server for a fresh signed URL for a note
 * attachment — the recording behind the Audio tab, the PDF behind the preview.
 *
 * Why it exists: both callers used to `catch { return null }`. The server
 * already rides its status and its sentence out on the throw (`notesRequest`
 * stamps `status` and `body`), and both callers threw that away, then showed a
 * fixed sentence — "This recording could not be opened. It may have been
 * removed from storage." — that is a GUESS. A 400 "No storage path available
 * for this attachment" (an audio row transcribed from base64 never gets a
 * `metadata.storagePath`, see `routes/notes.ts` transcribe-audio), a 404
 * "Attachment not found", an expired session and a genuinely deleted object all
 * looked identical on the handset AND logged nothing at all, which is exactly
 * why the Round 2 device pass could not name the failing hop.
 *
 * So: every hop names itself in logcat under `[lecture-media]`, and the reason
 * travels to the screen.
 */

export type NoteAttachmentUrlStep = 'sign' | 'resign' | 'load';

export class NoteAttachmentUrlError extends Error {
  readonly step: NoteAttachmentUrlStep;
  readonly status?: number;

  constructor(message: string, step: NoteAttachmentUrlStep, status?: number) {
    super(message);
    this.name = 'NoteAttachmentUrlError';
    this.step = step;
    this.status = status;
  }
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

const messageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? '').trim();
  return text || 'The server gave no reason.';
};

/** A stale token is the one failure worth a second go; everything else is real. */
const isAuthStatus = (status: number | undefined): boolean =>
  status === 401 || status === 403;

export function logLectureMedia(
  step: string,
  detail: { status?: number; message?: string; [key: string]: unknown },
): void {
  console.warn('[lecture-media]', JSON.stringify({ step, ...detail }));
}

/**
 * Ask for a fresh signed URL. Retries EXACTLY ONCE on 401/403, after forcing a
 * token refresh — a signed-URL call that lands in the second either side of a
 * token rotation is the one failure that is cured by trying again, and looping
 * past that just spins on a permission the student does not have.
 */
export async function fetchNoteAttachmentUrl(
  noteId: string,
  attachmentId: string,
  options?: { variant?: 'thumb' | 'original'; step?: NoteAttachmentUrlStep },
): Promise<string> {
  const step = options?.step || 'sign';
  const attempt = async (): Promise<string> => {
    const result = await refreshNoteAttachmentUrl(noteId, attachmentId, options);
    const url = (result?.url || '').trim();
    if (!url) {
      throw new NoteAttachmentUrlError('The server returned no URL for this file.', step);
    }
    return url;
  };

  try {
    return await attempt();
  } catch (first) {
    const status = statusOf(first);
    const message = messageOf(first);
    logLectureMedia(step, { noteId, attachmentId, status, message, retrying: isAuthStatus(status) });
    if (!isAuthStatus(status)) {
      throw new NoteAttachmentUrlError(message, step, status);
    }
    try {
      await supabase.auth.refreshSession();
      resetAuthRefreshBackoff();
    } catch {
      // A refusal here is not the answer either — the retry below reports it.
    }
    try {
      return await attempt();
    } catch (second) {
      const retryStatus = statusOf(second);
      const retryMessage = messageOf(second);
      logLectureMedia(`${step}:retry`, {
        noteId,
        attachmentId,
        status: retryStatus,
        message: retryMessage,
      });
      throw new NoteAttachmentUrlError(retryMessage, step, retryStatus);
    }
  }
}

/**
 * What the student reads. The status is kept because "(404)" is what turns a
 * bug report into a fixable one, and the server's own sentence is kept because
 * it is the only text that knows WHICH hop refused.
 */
export function describeAttachmentUrlError(error: unknown, fallback: string): string {
  const status = statusOf(error);
  const message = error instanceof Error && error.message ? error.message : '';
  if (!message) return fallback;
  return status ? `${message} (${status})` : message;
}
