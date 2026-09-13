/**
 * Lecture studio — Wave D of the academic replica.
 *
 * They take notes during class. The recorder already owns the microphone;
 * this module is the clock, the timestamp convention, resume-vs-create, and
 * the Ask prompt that must never imply the lecture should pause.
 */
import { LECTURE_TRANSCRIPTION_PRICE_RULE } from '../utils/aiCredits';
import { lectureCapacityLine } from '../utils/lectureAudio';
import { extractSmartNotesSection, stripSmartNotesSection } from '../utils/smartNotes';

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

const MATERIAL_ATTACHMENT_TYPES = new Set(['pdf', 'presentation', 'image', 'youtube']);

export function latestLectureTranscript(
  attachments?: Array<{ type?: string | null; extractedText?: string | null }> | null
): string {
  if (!attachments) return '';
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const row = attachments[index];
    if (MATERIAL_ATTACHMENT_TYPES.has(String(row?.type ?? ''))) continue;
    const text = row?.extractedText?.trim();
    if (text) return text;
  }
  return '';
}

/** Uploaded document, YouTube, or photos — not the lecture recording. */
export function noteHasMaterials(source: LectureTabSource): boolean {
  if (source.showMaterialsTab) return true;
  if ((source.youtubeVideoId ?? '').trim()) return true;
  const sourceType = source.sourceType ?? '';
  if (
    sourceType === 'youtube' ||
    sourceType === 'pdf' ||
    sourceType === 'presentation' ||
    sourceType === 'photos'
  ) {
    return true;
  }
  return (source.attachments ?? []).some((row) =>
    MATERIAL_ATTACHMENT_TYPES.has(String(row.type ?? ''))
  );
}

/** Notes whose first job is reading a file or video, not typing. */
export function isMaterialPrimaryNote(source: LectureTabSource): boolean {
  const sourceType = source.sourceType ?? '';
  if (
    sourceType === 'youtube' ||
    sourceType === 'pdf' ||
    sourceType === 'presentation' ||
    sourceType === 'photos'
  ) {
    return true;
  }
  return Boolean((source.youtubeVideoId ?? '').trim());
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

/* ------------------------------------------------------------------ *
 * The lecture surface: My Notes / Enhanced Notes / Transcript / Audio
 * ------------------------------------------------------------------ */

/**
 * A lecture note is several surfaces — what the student typed, what the
 * model wrote, uploaded materials, what was said, and the recording itself.
 * They used to be stacked down one scroll, so the transcript pushed the notes
 * off screen and the audio had nowhere to live at all. This is the planner
 * both clients ask which surfaces a given note actually has, so neither can
 * invent an empty tab and neither can quietly drop one.
 */
export type LectureTabId = 'notes' | 'enhanced' | 'materials' | 'transcript' | 'audio';

export const LECTURE_TAB_LABELS: Record<LectureTabId, string> = {
  notes: 'My Notes',
  enhanced: 'Enhanced Notes',
  materials: 'Materials',
  transcript: 'Transcript',
  audio: 'Audio',
};

export interface LectureAttachmentLike {
  id?: string;
  type?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  extractedText?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LectureTabSource {
  body?: string | null;
  attachments?: LectureAttachmentLike[] | null;
  /** Captions that exist only in memory during a take, not yet in the body. */
  liveTranscript?: string;
  /** Always offer Transcript — a lecture has that surface even before captions. */
  showTranscriptTab?: boolean;
  /** Offer Enhanced Notes before the first generate. */
  showEnhancedTab?: boolean;
  /** Force Materials even before attachments are typed. */
  showMaterialsTab?: boolean;
  sourceType?: string | null;
  youtubeVideoId?: string | null;
}

export interface LectureTab {
  id: LectureTabId;
  label: string;
}

/** The storage path the API can re-sign when a saved `fileUrl` has expired. */
export function lectureAudioStoragePath(row: LectureAttachmentLike | null | undefined): string {
  const path = row?.metadata?.['storagePath'];
  return typeof path === 'string' ? path.trim() : '';
}

/**
 * The recording for this note, newest last.
 *
 * A signed `fileUrl` is the normal case, but the transcribe route writes the
 * row with `fileUrl: undefined` when signing failed and keeps `storagePath` in
 * the metadata — that row is still playable, because the client re-signs
 * through `GET /notes/:noteId/attachments/:id/url`. Counting it as audio is
 * what stops a real recording from having no tab.
 */
export function lectureAudioAttachment(
  source: LectureTabSource
): LectureAttachmentLike | null {
  const rows = source.attachments ?? [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row || (row.type ?? '') !== 'audio') continue;
    if ((row.fileUrl ?? '').trim()) return row;
    if (row.id && lectureAudioStoragePath(row)) return row;
  }
  return null;
}

export interface LectureNoteParts {
  /** What the student typed — no generated section, no transcript. */
  typed: string;
  /** The Smart Notes section's markdown, or '' when none has been written. */
  enhanced: string;
  transcript: string;
}

/**
 * Split one stored body into the three texts the tabs show.
 *
 * Order matters: Smart Notes are appended to the END of the body, which is
 * after the `Transcript` heading, so stripping the generated section first is
 * what keeps the enhanced notes from being read back as part of the transcript.
 */
export function lectureNoteParts(source: LectureTabSource): LectureNoteParts {
  const body = source.body ?? '';
  const enhanced = (extractSmartNotesSection(body) ?? '').trim();
  const base = stripSmartNotesSection(body);
  const whisper = latestLectureTranscript(source.attachments);
  const split = splitLectureNoteBody(base, whisper);
  const transcript = preferLectureTranscript(
    preferLectureTranscript(split.transcript, whisper),
    (source.liveTranscript ?? '').trim()
  );
  return { typed: split.typed, enhanced, transcript };
}

/** Which surfaces this note has. My Notes is never absent. */
export function lectureTabs(source: LectureTabSource): LectureTab[] {
  const parts = lectureNoteParts(source);
  const ids: LectureTabId[] = ['notes'];
  if (parts.enhanced || source.showEnhancedTab) ids.push('enhanced');
  if (noteHasMaterials(source)) ids.push('materials');
  if (parts.transcript.trim() || source.showTranscriptTab) ids.push('transcript');
  if (lectureAudioAttachment(source)) ids.push('audio');
  return ids.map((id) => ({ id, label: LECTURE_TAB_LABELS[id] }));
}

/** Anything a student could read back: typed notes, enhanced notes, captions, audio. */
export function lectureNoteHasContent(source: LectureTabSource): boolean {
  const parts = lectureNoteParts(source);
  if (parts.typed.trim()) return true;
  if (parts.enhanced.trim()) return true;
  if (parts.transcript.trim()) return true;
  return Boolean(lectureAudioAttachment(source));
}

export interface LectureConsentGateInput {
  source: LectureTabSource;
  /** The student has ticked "I can record this lecture" in this session. */
  consented: boolean;
  /** The recorder is idle — no take running, uploading or transcribing. */
  idle: boolean;
}

/**
 * The consent gate is a door, not a wall.
 *
 * It used to cover the whole studio whenever nothing was recording, so opening
 * a lecture taken last week — notes, transcript and audio all saved — asked
 * "Start a lecture?" and showed none of them, which is exactly how the Android
 * build lost its tab row. A lecture that already has something to read opens on
 * its tabs and carries the consent line as a slim bar instead.
 */
export function showLectureConsentGate(input: LectureConsentGateInput): boolean {
  if (input.consented) return false;
  if (!input.idle) return false;
  return !lectureNoteHasContent(input.source);
}

export interface LectureTabOptions {
  /** A take is running: the student is typing, so nothing may steal the pane. */
  recording?: boolean;
}

/**
 * Where the studio opens: the enhanced notes when they exist, otherwise the
 * student's own. While recording it is always My Notes — the live captions run
 * beside the pane, and flipping a class typist onto a read-only tab would lose
 * whatever they were mid-sentence on.
 */
export function defaultLectureTab(
  source: LectureTabSource,
  options: LectureTabOptions = {}
): LectureTabId {
  if (options.recording) return 'notes';
  const tabs = lectureTabs(source);
  if (lectureNoteParts(source).enhanced && tabs.some((tab) => tab.id === 'enhanced')) {
    return 'enhanced';
  }
  if (isMaterialPrimaryNote(source) && tabs.some((tab) => tab.id === 'materials')) {
    return 'materials';
  }
  return 'notes';
}

/** Keep a chosen tab only while it still exists; otherwise fall to the default. */
export function resolveLectureTab(
  source: LectureTabSource,
  requested: LectureTabId | null | undefined,
  options: LectureTabOptions = {}
): LectureTabId {
  if (options.recording) return 'notes';
  if (requested && lectureTabs(source).some((tab) => tab.id === requested)) return requested;
  return defaultLectureTab(source, options);
}

export interface LectureTranscriptLine {
  /** `12:04` when the line carries a gutter time, absent otherwise. */
  time?: string;
  text: string;
}

const TRANSCRIPT_TIME_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/;

/** Caption rows for the Transcript tab, with the gutter time lifted off. */
export function lectureTranscriptLines(transcript: string): LectureTranscriptLine[] {
  return (transcript ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = TRANSCRIPT_TIME_RE.exec(line);
      if (!match) return { text: line };
      return { time: match[1], text: line.slice(match[0].length).trim() };
    })
    .filter((row) => row.text.length > 0);
}

/** Playback rates offered on both clients. Slower than 1x is not useful here. */
export const LECTURE_AUDIO_SPEEDS = [1, 1.25, 1.5] as const;

export type LectureAudioSpeed = (typeof LECTURE_AUDIO_SPEEDS)[number];

export function nextLectureAudioSpeed(speed: number): LectureAudioSpeed {
  const at = LECTURE_AUDIO_SPEEDS.indexOf(speed as LectureAudioSpeed);
  return LECTURE_AUDIO_SPEEDS[(at + 1) % LECTURE_AUDIO_SPEEDS.length] ?? 1;
}

export function formatLectureAudioSpeed(speed: number): string {
  return `${speed}×`;
}

/** `m:ss` for a playhead in seconds, matching the recorder's clock. */
export function formatLectureAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return formatLectureClock(seconds * 1000);
}

export function lectureAudioFileName(row: LectureAttachmentLike | null | undefined): string {
  return (row?.fileName ?? '').trim() || 'lecture-recording';
}
