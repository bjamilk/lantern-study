/**
 * Segmented lecture recording — the plan, the price and the timestamps.
 *
 * ## Why a lecture is recorded in pieces
 *
 * Until now a take was one `MediaRecorder` (browser) or one `Audio.Recording`
 * (phone) held entirely in memory or in one cache file, uploaded once after
 * Stop. A 90-minute lecture therefore had exactly one moment of truth, at the
 * very end, and everything before it was unrecoverable: a tab crash, a killed
 * app, a flat battery or a closed laptop lid at minute 84 lost the whole
 * lecture. That is the one failure a student cannot redo.
 *
 * So the recorder now closes a segment every `LECTURE_SEGMENT_MS`, uploads it
 * immediately and transcribes it, while the microphone keeps running on the
 * SAME stream. Each closed segment is a standalone, playable file the moment it
 * lands, so the worst a crash can now cost is the piece still open — at most
 * five minutes — and the transcript grows during the lecture instead of
 * appearing after it.
 *
 * `MediaRecorder.start(timeslice)` is NOT how this is done. Its second and
 * later chunks are not standalone WebM files (only the first carries the
 * header), so an upload of chunk 7 is not playable and is not transcribable.
 * The recorder is stopped and restarted on the same stream instead, which is
 * why the elapsed clock lives outside the recorder.
 *
 * ## The rule this file exists to keep
 *
 * A lecture recorded in pieces must never cost more than the same lecture
 * recorded in one take. `getLectureTranscriptionCost` charges 1 AI use per 15
 * minutes "or part of one", so charging each 5-minute segment on its own would
 * turn a 47-minute lecture from 4 AI uses into 10 — the student would be
 * punished for the resilience. `lectureSegmentCreditCost` therefore prices the
 * RUNNING TOTAL and charges only the difference, so the segments of a take sum
 * to exactly what the whole take would have cost, and most segments are free.
 * `lectureSegmentsTotalCost` is the proof, and it is tested against
 * `getLectureTranscriptionCost` across the whole length range.
 *
 * Both clients and the API read this module, so the number a student is shown,
 * the number the server reserves and the sequence a retry recomputes cannot
 * drift apart.
 */
import { getLectureTranscriptionCost } from './aiCredits';
import { formatLectureClock } from '../learning/lectureStudio';

/**
 * How long one segment runs before the recorder is rotated.
 *
 * Five minutes is the trade: shorter means less exposure to a crash but more
 * Whisper calls, more storage objects and a choppier read, and every rotation
 * drops a few milliseconds of audio while the encoder is torn down and rebuilt.
 * Five minutes bounds the loss at something a student can reconstruct from
 * memory, and matches the pace at which the reference product's live transcript
 * fills in.
 */
export const LECTURE_SEGMENT_MS = 5 * 60_000;

/**
 * The shortest tail worth uploading on its own.
 *
 * Stopping at 5:01 would otherwise produce a one-second segment: a whole
 * Whisper call, a storage object and a transcript card for a syllable. Below
 * this the tail is still uploaded — audio is never dropped — but it is never
 * created as a segment by the ROTATION; only Stop can close a short one.
 */
export const MIN_LECTURE_SEGMENT_MS = 2_000;

/** One closed piece of a take. `seq` is 1-based and gapless within a session. */
export interface LectureSegmentPlanItem {
  seq: number;
  /** Recorded milliseconds before this segment began. Pauses already excluded. */
  startOffsetMs: number;
  durationMs: number;
}

/**
 * Where the rotations fall for a take of this length.
 *
 * Pure, so the store can be tested without a microphone and the two platforms
 * cannot disagree about which second segment 4 starts at. A take shorter than
 * one segment is one segment; a take that ends exactly on a boundary does not
 * grow an empty tail.
 */
export function planLectureSegments(totalMs: number): LectureSegmentPlanItem[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return [];
  const items: LectureSegmentPlanItem[] = [];
  let startOffsetMs = 0;
  let seq = 1;
  while (startOffsetMs < totalMs) {
    const durationMs = Math.min(LECTURE_SEGMENT_MS, totalMs - startOffsetMs);
    items.push({ seq, startOffsetMs, durationMs });
    startOffsetMs += durationMs;
    seq += 1;
  }
  return items;
}

/** Has the open segment run long enough that the recorder should rotate? */
export function shouldRotateLectureSegment(openSegmentMs: number): boolean {
  return Number.isFinite(openSegmentMs) && openSegmentMs >= LECTURE_SEGMENT_MS;
}

/* --------------------------------------------------------------- price -- */

/**
 * What a take of this length has cost IN TOTAL so far.
 *
 * The only difference from `getLectureTranscriptionCost` is at zero: that
 * function floors at 1 because every REQUEST costs at least one, while a take
 * that has recorded nothing has cost nothing. Without the zero case the first
 * segment would be charged twice.
 */
export function cumulativeLectureCost(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return getLectureTranscriptionCost(totalMs);
}

/**
 * What THIS segment adds to the bill.
 *
 * The running total is priced, not the segment, so a 47-minute lecture in
 * 5-minute pieces costs the 4 AI uses a 47-minute take costs — not 10. Most
 * segments land inside a 15-minute block already paid for and are free, and the
 * one that crosses a boundary pays for the block it opens.
 *
 * Rounding is in the student's favour twice over: the difference is floored at
 * zero (a clock that goes backwards after a retry can never produce a negative
 * that a later segment silently pays back), and the total can only ever equal
 * `getLectureTranscriptionCost(total)`, never exceed it.
 */
export function lectureSegmentCreditCost(priorRecordedMs: number, segmentDurationMs: number): number {
  const prior = Math.max(0, Number.isFinite(priorRecordedMs) ? priorRecordedMs : 0);
  const segment = Math.max(0, Number.isFinite(segmentDurationMs) ? segmentDurationMs : 0);
  if (segment <= 0) return 0;
  return Math.max(0, cumulativeLectureCost(prior + segment) - cumulativeLectureCost(prior));
}

/**
 * The whole bill for a take recorded as these segments, in order.
 *
 * This is the equivalence proof the pricing rests on: for any list of
 * durations, this equals `getLectureTranscriptionCost(sum)`. The test asserts
 * it across the length range rather than at a few examples.
 */
export function lectureSegmentsTotalCost(durationsMs: number[]): number {
  let prior = 0;
  let total = 0;
  for (const durationMs of durationsMs) {
    total += lectureSegmentCreditCost(prior, durationMs);
    prior += Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  }
  return total;
}

/* ---------------------------------------------------------- timestamps -- */

const ONE_HOUR_MS = 60 * 60_000;

/**
 * The `[0:00]` / `[1:05:00]` stamp that heads a segment's transcript.
 *
 * Under an hour this is `formatLectureClock`, so a segment stamp and a typed
 * note stamp read identically. Past an hour it switches to `h:mm:ss` rather
 * than letting the minutes run to three digits, because `lectureTranscriptLines`
 * parses a gutter time as one or two digits of minutes — a `[125:00]` would be
 * shown as prose instead of a time, which is how a transcript stops being
 * navigable exactly when it is long enough to need navigating.
 */
export function formatLectureSegmentStamp(startOffsetMs: number): string {
  const ms = Math.max(0, Number.isFinite(startOffsetMs) ? startOffsetMs : 0);
  if (ms < ONE_HOUR_MS) return formatLectureClock(ms);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** `[5:00] …text` — one segment's contribution to the written transcript. */
export function lectureSegmentTranscriptLine(startOffsetMs: number, text: string): string {
  const body = (text ?? '').trim();
  if (!body) return '';
  return `[${formatLectureSegmentStamp(startOffsetMs)}] ${body}`;
}

/**
 * Put a segment's line into a transcript that may already hold later ones.
 *
 * Segments normally land in order and this is a plain append. A RETRY does not:
 * segment 3 can be re-transcribed after 4 and 5 are already written, and
 * appending it there would put minute 10 after minute 25. So the insert is made
 * before the first line whose stamp is later than this one, which keeps the
 * written transcript in recorded order however the network behaved.
 *
 * A line for this exact stamp that is already present is REPLACED, not
 * duplicated: that is what makes re-sending the same segment a no-op in the
 * note body as well as on the bill.
 */
export function insertLectureSegmentLine(
  transcript: string,
  startOffsetMs: number,
  text: string
): string {
  const line = lectureSegmentTranscriptLine(startOffsetMs, text);
  if (!line) return transcript ?? '';
  const stamp = `[${formatLectureSegmentStamp(startOffsetMs)}]`;
  const existing = (transcript ?? '').trim();
  if (!existing) return line;

  const blocks = existing.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  const stampedAt = (block: string): number | null => {
    const match = /^\[(?:(\d+):)?(\d{1,3}):(\d{2})\]/.exec(block.trim());
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    return (hours * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
  };

  const sameStampAt = blocks.findIndex((block) => block.trim().startsWith(stamp));
  if (sameStampAt >= 0) {
    blocks[sameStampAt] = line;
    return blocks.join('\n\n');
  }

  const laterAt = blocks.findIndex((block) => {
    const at = stampedAt(block);
    return at !== null && at > startOffsetMs;
  });
  if (laterAt < 0) return `${existing}\n\n${line}`;
  blocks.splice(laterAt, 0, line);
  return blocks.join('\n\n');
}

/* ------------------------------------------------------- the row shape -- */

/**
 * What the transcription of a segment is doing right now.
 *
 * `pending` is written when the audio has been uploaded and registered but
 * Whisper has not answered yet, which is the state that makes a crash
 * survivable: the row names an object that is already safe in storage, so a
 * reload can offer to transcribe it rather than mourn it. `failed` is the same
 * row after a refusal, and is what the per-card Retry acts on.
 */
export type LectureSegmentStatus = 'pending' | 'done' | 'failed';

export interface LectureSegmentMeta {
  sessionId: string;
  seq: number;
  startOffsetMs: number;
  durationMs: number;
  status: LectureSegmentStatus;
}

/**
 * The key that makes a re-sent segment free.
 *
 * A segment is identified by the note it belongs to, the TAKE within that note
 * and its place in that take — never by its storage path or its attachment id,
 * because a retry after a failed upload writes a different object for the same
 * segment. The server looks a request up by this key before it reserves
 * anything, so the same segment sent twice is transcribed once, charged once
 * and written into the note once.
 */
export function lectureSegmentKey(noteId: string, sessionId: string, seq: number): string {
  return `${noteId}:${sessionId}:${seq}`;
}

/** A take id that sorts by time and survives a reload in the note's own rows. */
export function newLectureSessionId(now: number = Date.now()): string {
  return `s${now.toString(36)}`;
}

/** The file name a segment's object is stored under. Server-built, never claimed. */
export function lectureSegmentFileName(
  noteId: string,
  seq: number,
  extension: string = 'webm'
): string {
  const ext = (extension || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  return `lecture-${noteId}-${seq}.${ext}`;
}

/**
 * The attachment fields a segment is read out of.
 *
 * Structural and all-optional on purpose: the web's `StudyNote.attachments`,
 * the phone's `NoteAttachment` and a raw API row are three different types for
 * the same table, and none of them should have to be cast to be read here.
 */
export type LectureSegmentAttachmentLike = {
  id?: string;
  type?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  extractedText?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
};

/**
 * Read a segment out of an attachment row, or `null` when it is not one.
 *
 * Deliberately strict: a row is a segment only when it carries a whole,
 * well-formed `lectureSegment` block. A half-written one is treated as a plain
 * audio attachment — the old single-take recording is exactly that, and it must
 * keep playing in the Audio tab rather than being shown as "segment NaN".
 */
export function lectureSegmentMeta(row: LectureSegmentAttachmentLike | null | undefined): LectureSegmentMeta | null {
  if (!row || (row.type ?? '') !== 'audio') return null;
  const raw = row.metadata?.['lectureSegment'];
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Record<string, unknown>;
  const sessionId = typeof meta.sessionId === 'string' ? meta.sessionId.trim() : '';
  const seq = Number(meta.seq);
  const startOffsetMs = Number(meta.startOffsetMs);
  const durationMs = Number(meta.durationMs);
  if (!sessionId) return null;
  if (!Number.isFinite(seq) || seq < 1) return null;
  if (!Number.isFinite(startOffsetMs) || startOffsetMs < 0) return null;
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const status = meta.status;
  return {
    sessionId,
    seq: Math.floor(seq),
    startOffsetMs: Math.floor(startOffsetMs),
    durationMs: Math.floor(durationMs),
    status: status === 'done' || status === 'failed' ? status : 'pending',
  };
}

export interface LectureSegmentRow extends LectureSegmentMeta {
  attachmentId?: string;
  fileName?: string;
  fileUrl?: string;
  transcript: string;
  createdAt?: string;
}

/** Every segment on a note, oldest first, across all takes. */
export function lectureSegmentRows(
  attachments: readonly LectureSegmentAttachmentLike[] | null | undefined
): LectureSegmentRow[] {
  const rows: LectureSegmentRow[] = [];
  for (const row of attachments ?? []) {
    const meta = lectureSegmentMeta(row);
    if (!meta) continue;
    rows.push({
      ...meta,
      attachmentId: row.id ?? undefined,
      fileName: row.fileName ?? undefined,
      fileUrl: row.fileUrl ?? undefined,
      transcript: (row.extractedText ?? '').trim(),
      createdAt: row.createdAt ?? undefined,
    });
  }
  return sortLectureSegments(rows);
}

/** Recorded order: the take first, then the place within it. */
export function sortLectureSegments<T extends { sessionId: string; seq: number; startOffsetMs: number }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    if (a.startOffsetMs !== b.startOffsetMs) return a.startOffsetMs - b.startOffsetMs;
    return a.seq - b.seq;
  });
}

/** Only the segments of one take. */
export function lectureSessionSegments(
  rows: LectureSegmentRow[],
  sessionId: string
): LectureSegmentRow[] {
  return rows.filter((row) => row.sessionId === sessionId);
}

/** The take a reload should offer to continue: the newest one on the note. */
export function latestLectureSessionId(rows: LectureSegmentRow[]): string | null {
  const sorted = sortLectureSegments(rows);
  return sorted.length ? sorted[sorted.length - 1]!.sessionId : null;
}

/** Where a resumed take carries on from. One past the highest seq recorded. */
export function nextLectureSegmentSeq(rows: Array<{ seq: number }>): number {
  return rows.reduce((highest, row) => Math.max(highest, row.seq), 0) + 1;
}

/** Recorded milliseconds already banked in this take — the clock a resume restores. */
export function recordedMsFromSegments(rows: Array<{ startOffsetMs: number; durationMs: number }>): number {
  return rows.reduce((end, row) => Math.max(end, row.startOffsetMs + row.durationMs), 0);
}

/**
 * The milliseconds already PAID FOR before a given segment.
 *
 * Read off the rows the server has, never off a number the client sends: the
 * prior total is what decides whether this segment opens a new 15-minute block,
 * so a client that could understate it could buy a whole lecture for one use.
 * Only segments of the same take, and only those before this one, count.
 */
export function priorRecordedMs(
  rows: Array<{ sessionId: string; seq: number; durationMs: number }>,
  sessionId: string,
  seq: number
): number {
  return rows
    .filter((row) => row.sessionId === sessionId && row.seq < seq)
    .reduce((total, row) => total + Math.max(0, row.durationMs), 0);
}

/* ------------------------------------------------------------ the copy -- */

/** "3 segments recorded on 18 Sep 2026" — the Audio files tab's subtitle. */
export function lectureSegmentsSummaryLine(
  rows: Array<{ createdAt?: string }>,
  now: Date = new Date()
): string {
  const count = rows.length;
  const first = rows.map((row) => row.createdAt).find(Boolean);
  const when = first ? new Date(first) : now;
  const date = Number.isNaN(when.getTime()) ? now : when;
  const stamp = `${date.getDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      date.getMonth()
    ]
  } ${date.getFullYear()}`;
  return `${count} segment${count === 1 ? '' : 's'} recorded on ${stamp}`;
}

/** "Segment 3 · 5:00–10:00" — the label on one row of the Audio files tab. */
export function lectureSegmentLabel(row: { seq: number; startOffsetMs: number; durationMs: number }): string {
  const from = formatLectureSegmentStamp(row.startOffsetMs);
  const to = formatLectureSegmentStamp(row.startOffsetMs + row.durationMs);
  return `Segment ${row.seq} · ${from}–${to}`;
}

/**
 * What to do with a note that has segments when the studio opens.
 *
 * `resume` when the newest take has segments and none of them has been closed
 * off by a finished stop — the student walked away, crashed or reloaded, and
 * the honest offer is to carry on into the same take. `finish` when every
 * segment is uploaded but some were never transcribed: there is nothing left to
 * record, only work left to pay for. `none` when the take is complete.
 *
 * The decision is made from the SERVER's rows, which is the whole point: the
 * local blob is no longer the only copy, so a reload can see the lecture.
 */
export interface LectureResumeOffer {
  sessionId: string;
  /** The seq a resumed take starts its next segment at. Gapless, never reused. */
  nextSeq: number;
  /** The clock a resumed take restores, so the stamps stay true to the lecture. */
  recordedMs: number;
  /** Segments whose audio is safe but whose words are not written yet. */
  untranscribed: number;
}

export type LectureResumeDecision =
  | { action: 'none' }
  /** This device is still mid-take: carry on. */
  | ({ action: 'resume' } & LectureResumeOffer)
  /** A take was interrupted. Both doors are open: record more, or just finish. */
  | ({ action: 'recover' } & LectureResumeOffer);

export function resolveLectureResume(input: {
  rows: LectureSegmentRow[];
  /** A take is only "live" while it is the one this device was recording. */
  activeSessionId?: string | null;
}): LectureResumeDecision {
  const sessionId = input.activeSessionId || latestLectureSessionId(input.rows);
  if (!sessionId) return { action: 'none' };
  const rows = lectureSessionSegments(input.rows, sessionId);
  if (!rows.length) return { action: 'none' };
  const offer: LectureResumeOffer = {
    sessionId,
    nextSeq: nextLectureSegmentSeq(rows),
    recordedMs: recordedMsFromSegments(rows),
    untranscribed: rows.filter((row) => row.status !== 'done' || !row.transcript).length,
  };
  if (input.activeSessionId) return { action: 'resume', ...offer };
  if (offer.untranscribed > 0) return { action: 'recover', ...offer };
  return { action: 'none' };
}
