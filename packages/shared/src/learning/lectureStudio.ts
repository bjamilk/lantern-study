/**
 * Lecture studio — Wave D of the academic replica.
 *
 * They take notes during class. The recorder already owns the microphone;
 * this module is the clock, the timestamp convention, resume-vs-create, and
 * the Ask prompt that must never imply the lecture should pause.
 */
import { LECTURE_TRANSCRIPTION_PRICE_RULE } from '../utils/aiCredits';
import { lectureCapacityLine } from '../utils/lectureAudio';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const LECTURE_CONSENT_LINE =
  'Recording is stored in your note; ask before recording other people.';

export const LECTURE_ASK_KEEP_LISTENING = 'Keep listening — do not pause the lecture.';

export const LECTURE_ASK_JUST_SAID = 'Ask about what was just said';

export const LECTURE_ASK_RECENT_CHARS = 400;

/** e.g. "Lecture — 6 Sep". `now` is injectable so tests are not date-bound. */
export function newLectureNoteTitle(now: Date = new Date()): string {
  const month = MONTHS[now.getMonth()];
  return `Lecture — ${now.getDate()} ${month ?? 'Jan'}`;
}

export function lectureStudioPriceLine(): string {
  return `Recording is free. ${LECTURE_TRANSCRIPTION_PRICE_RULE} ${lectureCapacityLine()}`;
}

/** Whether the door may create the note. `false` writes nothing at all. */
export function shouldCreateLectureNote(confirmed: boolean): boolean {
  return confirmed === true;
}

export interface DoorNoteCleanupInput {
  openedByDoor: boolean;
  title: string | null | undefined;
  body: string | null | undefined;
  doorTitle: string;
}

/**
 * Delete the door's empty shell on discard — never a note the student typed
 * in or renamed, and never a note this session did not create. Captions from
 * an abandoned take do not count as typed notes.
 */
export function shouldDeleteDoorNoteOnDiscard(input: DoorNoteCleanupInput): boolean {
  if (!input.openedByDoor) return false;
  if (splitLectureNoteBody(input.body ?? '').typed.trim().length > 0) return false;
  if ((input.title ?? '').trim() !== input.doorTitle.trim()) return false;
  return true;
}

export interface RecordingClock {
  startedAt: number | null;
  pausedTotalMs: number;
  pausedAt: number | null;
}

/** Recorded milliseconds, pauses excluded. */
export function elapsedRecordingMs(clock: RecordingClock, now: number = Date.now()): number {
  if (!clock.startedAt) return 0;
  const end = clock.pausedAt ?? now;
  const raw = end - clock.startedAt - Math.max(0, clock.pausedTotalMs);
  return Math.max(0, raw);
}

export function elapsedRecordingSeconds(clock: RecordingClock, now: number = Date.now()): number {
  return Math.floor(elapsedRecordingMs(clock, now) / 1000);
}

export function pausedTotalAfterResume(
  pausedTotalMs: number,
  pausedAt: number | null,
  now: number = Date.now()
): number {
  if (!pausedAt) return Math.max(0, pausedTotalMs);
  return Math.max(0, pausedTotalMs) + Math.max(0, now - pausedAt);
}

/** `m:ss` (minutes may run past 59) so the timer matches the existing recorder. */
export function formatLectureClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function lectureTimestampMarker(elapsedMs: number): string {
  return `[${formatLectureClock(elapsedMs)}]`;
}

/**
 * Stamp a newly started paragraph with the elapsed clock so typed notes
 * stay linked to the audio. Edits in the middle of a line are left alone.
 */
export function applyLectureNoteStamp(
  previousBody: string,
  nextBody: string,
  elapsedMs: number
): string {
  if (nextBody.length <= previousBody.length) return nextBody;
  const marker = lectureTimestampMarker(elapsedMs);
  if (previousBody.trim() === '' && nextBody.trim() !== '' && !nextBody.trimStart().startsWith('[')) {
    return `${marker} ${nextBody.trimStart()}`;
  }
  if (previousBody !== '' && !nextBody.startsWith(previousBody)) return nextBody;
  const added = nextBody.slice(previousBody.length);
  if (added.startsWith('\n')) {
    const rest = added.slice(1);
    if (rest.startsWith('[') || rest.startsWith('\n')) return nextBody;
    return `${previousBody}\n${marker} ${rest}`;
  }
  if (previousBody.endsWith('\n') && added && !added.startsWith('[')) {
    return `${previousBody}${marker} ${added}`;
  }
  return nextBody;
}

export function recentTranscriptExcerpt(
  transcript: string,
  maxChars: number = LECTURE_ASK_RECENT_CHARS
): string {
  const trimmed = transcript.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars).trim();
}

export function buildLectureAsk(input: {
  question?: string;
  recentTranscript?: string;
  noteTitle?: string;
  elapsedMs?: number;
}): string {
  const question = input.question?.trim() || 'What was just said?';
  const excerpt = recentTranscriptExcerpt(input.recentTranscript ?? '');
  const where = input.noteTitle?.trim() ? `in "${input.noteTitle.trim()}"` : 'in this lecture';
  const at =
    typeof input.elapsedMs === 'number' ? ` at ${lectureTimestampMarker(input.elapsedMs)}` : '';
  if (!excerpt) {
    return `${question}\n\n(I am listening ${where}${at}, but there is no transcript yet.)`;
  }
  return `${question}\n\nThis is what was just said ${where}${at}:\n"""\n${excerpt}\n"""`;
}

export function mergeCaptionStream(input: {
  committed: string;
  incomingFinals: string[];
  interim: string;
}): { committed: string; interim: string; display: string } {
  const extras = input.incomingFinals.map((row) => row.trim()).filter(Boolean);
  const committed = extras.length
    ? [input.committed.trim(), ...extras].filter(Boolean).join(' ')
    : input.committed;
  const interim = input.interim.trim();
  const display = [committed.trim(), interim].filter(Boolean).join(' ');
  return { committed, interim, display };
}

export function displayLectureTranscript(input: {
  committed: string;
  interim: string;
  whisper?: string;
}): string {
  const live = mergeCaptionStream({
    committed: input.committed,
    incomingFinals: [],
    interim: input.interim,
  }).display;
  const whisper = (input.whisper ?? '').trim();
  if (whisper && live) return `${whisper}\n\n${live}`;
  return live || whisper;
}

/** Visible heading so the transcript is part of the note, not only a pane. */
export const LECTURE_TRANSCRIPT_HEADING = 'Transcript';
const LECTURE_TRANSCRIPT_MARKER = `\n\n${LECTURE_TRANSCRIPT_HEADING}\n\n`;

export function splitLectureNoteBody(
  body: string,
  whisperTranscript: string = ''
): { typed: string; transcript: string } {
  const raw = body ?? '';
  const markedAt = raw.lastIndexOf(LECTURE_TRANSCRIPT_MARKER);
  if (markedAt >= 0) {
    return {
      typed: raw.slice(0, markedAt).replace(/\n+$/g, ''),
      transcript: raw.slice(markedAt + LECTURE_TRANSCRIPT_MARKER.length).trim(),
    };
  }
  const prefix = `${LECTURE_TRANSCRIPT_HEADING}\n\n`;
  if (raw.startsWith(prefix)) {
    return { typed: '', transcript: raw.slice(prefix.length).trim() };
  }
  const whisper = whisperTranscript.trim();
  const text = raw.trimEnd();
  if (whisper && text.endsWith(whisper)) {
    return {
      typed: text.slice(0, text.length - whisper.length).replace(/\n+$/g, ''),
      transcript: whisper,
    };
  }
  return { typed: raw, transcript: '' };
}

export function composeLectureNoteBody(typed: string, transcript: string): string {
  const notes = splitLectureNoteBody(typed).typed.replace(/\n+$/g, '');
  const text = (transcript ?? '').trim();
  if (!text) return notes;
  if (!notes) return `${LECTURE_TRANSCRIPT_HEADING}\n\n${text}`;
  return `${notes}${LECTURE_TRANSCRIPT_MARKER}${text}`;
}

/** Keep the longer saved captions when a reload would otherwise write blanks. */
export function preferLectureTranscript(current: string, incoming: string): string {
  const existing = current.trim();
  const next = incoming.trim();
  if (!next) return existing;
  if (!existing) return next;
  if (next.includes(existing) || next.length >= existing.length) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n\n${next}`;
}

/** Keep typed notes when Whisper appended the transcript to the body. */
export function typedNotesFromBody(body: string, whisperTranscript: string): string {
  return splitLectureNoteBody(body, whisperTranscript).typed;
}

export function latestLectureTranscript(
  attachments?: Array<{ extractedText?: string | null }> | null
): string {
  if (!attachments) return '';
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const text = attachments[index]?.extractedText?.trim();
    if (text) return text;
  }
  return '';
}

export type LectureStudioNoteDecision =
  | { action: 'resume'; noteId: string }
  | { action: 'create'; title: string };

/**
 * Resume the open lecture, or today's dated note, instead of writing a second
 * empty "Lecture — date". Create only when neither exists.
 */
export function resolveLectureStudioNote(input: {
  lectures: Array<{ id: string; title?: string | null }>;
  selectedNoteId?: string | null;
  recordingNoteId?: string | null;
  todayTitle: string;
}): LectureStudioNoteDecision {
  if (input.recordingNoteId) {
    return { action: 'resume', noteId: input.recordingNoteId };
  }
  const selected = input.selectedNoteId
    ? input.lectures.find((row) => row.id === input.selectedNoteId)
    : undefined;
  if (selected) return { action: 'resume', noteId: selected.id };
  const today = input.lectures.find((row) => (row.title ?? '').trim() === input.todayTitle);
  if (today) return { action: 'resume', noteId: today.id };
  return { action: 'create', title: input.todayTitle };
}
