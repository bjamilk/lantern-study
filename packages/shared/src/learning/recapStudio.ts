/**
 * Recap studio — Wave F of the academic replica.
 *
 * A generated listen-through of the material, not a read-aloud of the PDF.
 * Narration stays the cheap "read this page" path. Recap rewrites the notes
 * into spoken beats (summary / lecture / podcast), each with a source cite.
 * Persist on a course note with a fence, same as lecture and lesson — no
 * recap_sessions table.
 */
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '../utils/aiCredits';
import { hasEnoughNoteStudyContent } from '../utils/noteStudyContent';
import { isLectureNote } from './courseWorkspace';
import { isLessonNote } from './lessonStudio';
import { isCalendarNote } from './studyCalendar';

export type RecapStyle = 'summary' | 'lecture' | 'podcast';
export type RecapLength = 'short' | 'medium' | 'long';

export const RECAP_FENCE = 'lantern-recap';

export const RECAP_SEGMENT_CAPS: Record<RecapLength, number> = {
  short: 6,
  medium: 12,
  long: 24,
};
export const RECAP_SEGMENT_HARD_CAP = 30;
export const RECAP_SPOKEN_MAX = 280;
export const RECAP_CITE_MAX = 140;

export const RECAP_SPEECH_RATE_DEFAULT = 1;
export const RECAP_SPEECH_RATE_SLOWER = 0.75;
export const RECAP_SPEECH_RATE_MIN = 0.6;
export const RECAP_SPEECH_RATE_MAX = 1.25;

export const RECAP_STYLES: readonly {
  id: RecapStyle;
  label: string;
  promise: string;
}[] = [
  {
    id: 'summary',
    label: 'Summary',
    promise: 'The point of each section, in a few sentences.',
  },
  {
    id: 'lecture',
    label: 'Lecture',
    promise: 'Taught like a class recap, not a read-aloud.',
  },
  {
    id: 'podcast',
    label: 'Podcast',
    promise: 'Conversational, for a commute.',
  },
];

export const RECAP_LENGTHS: readonly {
  id: RecapLength;
  label: string;
  promise: string;
}[] = [
  { id: 'short', label: 'S', promise: 'A few minutes.' },
  { id: 'medium', label: 'M', promise: 'A full pass.' },
  { id: 'long', label: 'L', promise: 'The long listen.' },
];

export function recapStudioPriceLine(): string {
  return `Starting a recap costs ${formatCreditCost(AI_FEATURE_CREDIT_COST)}. Asking while it plays costs another.`;
}

export function recapStyleLabel(style: RecapStyle): string {
  if (style === 'lecture') return 'Lecture';
  if (style === 'podcast') return 'Podcast';
  return 'Summary';
}

export function newRecapNoteTitle(style: RecapStyle, sourceTitle: string): string {
  const src = sourceTitle.trim() || 'this course';
  return `Recap — ${recapStyleLabel(style)} · ${src}`;
}

export function isRecapNote(note: { title?: string | null; body?: string | null }): boolean {
  if (/^Recap — /.test(note.title ?? '')) return true;
  return (note.body ?? '').includes(RECAP_FENCE);
}

/** Notes a new recap can be built from. Lectures last so a typed note is the default. */
export function recapSourceNotes<
  T extends { id: string; title?: string | null; body?: string | null; sourceType?: string | null },
>(notes: readonly T[]): T[] {
  return notes
    .filter(
      (note) =>
        !isRecapNote(note) &&
        !isLessonNote(note) &&
        !isCalendarNote(note) &&
        hasEnoughNoteStudyContent({
          ...note,
          body: note.body ?? undefined,
          sourceType: note.sourceType ?? undefined,
        })
    )
    .slice()
    .sort((a, b) => Number(isLectureNote(a)) - Number(isLectureNote(b)));
}

/**
 * True when generate-recap is not on this API. Production 404s often arrive as
 * `{ error: "Error", message: "Not found - /api/v1/ai/generate-recap" }`.
 */
export function isRecapGeneratorMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' && /\(404\)|Not Found|Cannot POST/i.test(error);
  }
  const err = error as {
    status?: number;
    message?: string;
    body?: { message?: string; error?: string };
  };
  if (err.status === 404) return true;
  const text = [err.message, err.body?.message, err.body?.error]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return /\(404\)|Not Found|Cannot POST/i.test(text);
}

export interface RecapSegment {
  id: string;
  title: string;
  /** Rewritten listen-through. Never a dump of the source page. */
  spoken: string;
  /** Short quote from the material this beat was drawn from. */
  sourceCite: string;
}

export interface RecapChatTurn {
  role: 'student' | 'tutor';
  text: string;
}

export interface RecapSession {
  style: RecapStyle;
  length: RecapLength;
  sourceNoteId: string;
  sourceTitle: string;
  segments: RecapSegment[];
  segmentIndex: number;
  transcript: RecapChatTurn[];
  speechRate: number;
  status: 'ready' | 'ended';
}

export type RecapCommand =
  | { type: 'slower' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'jump'; segmentNumber: number }
  | { type: 'pause' }
  | { type: 'end' }
  | { type: 'chat'; text: string };

export function normalizeRecapStyle(value: unknown): RecapStyle {
  if (value === 'lecture' || value === 'podcast') return value;
  return 'summary';
}

export function normalizeRecapLength(value: unknown): RecapLength {
  if (value === 'short' || value === 'long') return value;
  return 'medium';
}

export function recapSegmentCap(length: RecapLength): number {
  return RECAP_SEGMENT_CAPS[length];
}

function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) return RECAP_SPEECH_RATE_DEFAULT;
  return Math.min(RECAP_SPEECH_RATE_MAX, Math.max(RECAP_SPEECH_RATE_MIN, rate));
}

export function currentRecapSegment(session: RecapSession): RecapSegment | null {
  return session.segments[session.segmentIndex] ?? null;
}

export function recapProgress(session: RecapSession): {
  current: number;
  total: number;
  percent: number;
} {
  const total = session.segments.length;
  const current = total === 0 ? 0 : Math.min(session.segmentIndex + 1, total);
  return {
    current,
    total,
    percent: total === 0 ? 0 : Math.round((current / total) * 100),
  };
}

function goToSegment(session: RecapSession, segmentIndex: number): RecapSession {
  if (session.status === 'ended') return session;
  if (segmentIndex < 0 || segmentIndex >= session.segments.length) return session;
  if (segmentIndex === session.segmentIndex) return session;
  return { ...session, segmentIndex };
}

export function applyRecapCommand(session: RecapSession, command: RecapCommand): RecapSession {
  if (session.status === 'ended' && command.type !== 'chat') return session;

  switch (command.type) {
    case 'slower':
      return { ...session, speechRate: clampSpeechRate(RECAP_SPEECH_RATE_SLOWER) };
    case 'pause':
    case 'chat':
      return session;
    case 'end':
      return { ...session, status: 'ended' };
    case 'next':
      return goToSegment(session, session.segmentIndex + 1);
    case 'prev':
      return goToSegment(session, session.segmentIndex - 1);
    case 'jump':
      return goToSegment(session, command.segmentNumber - 1);
    default:
      return session;
  }
}

export function appendRecapTurn(session: RecapSession, turn: RecapChatTurn): RecapSession {
  const text = turn.text.trim();
  if (!text) return session;
  return { ...session, transcript: [...session.transcript, { role: turn.role, text }] };
}

export function buildRecapAsk(input: {
  question?: string;
  segment: RecapSegment;
  sourceTitle?: string;
}): string {
  const question = input.question?.trim() || 'Explain this recap beat';
  const where = input.sourceTitle?.trim()
    ? `in the recap of "${input.sourceTitle.trim()}"`
    : 'in this recap';
  return `${question}\n\nThis is the current recap beat ${where}:\n"""\n${input.segment.title}\n\n${input.segment.spoken}\n\nSource: ${input.segment.sourceCite}\n"""`;
}

export function speakTextForSegment(segment: RecapSegment): string {
  const spoken = segment.spoken.trim();
  if (!spoken) return segment.title.trim();
  return `${segment.title.trim()}. ${spoken}`;
}

/**
 * Spoken text is a listen-through, not a dump, when it is shorter than the
 * source and not a copy of it.
 */
export function recapSpokenIsCondensed(spoken: string, source: string): boolean {
  const s = spoken.trim();
  const src = source.trim();
  if (!src) return s.length === 0;
  if (s === src) return false;
  if (src.length >= 400 && s.length > Math.floor(src.length * 0.45)) return false;
  return true;
}

function slugId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstSentences(text: string, count: number): string {
  const parts = collapseWs(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length === 0) return collapseWs(text);
  return parts.slice(0, Math.max(1, count)).join(' ');
}

function clipAtWord(text: string, max: number): string {
  const collapsed = collapseWs(text);
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, Math.max(0, max - 1));
  const bound = cut.lastIndexOf(' ');
  const clipped = (bound > 40 ? cut.slice(0, bound) : cut).trim();
  return clipped ? `${clipped}…` : collapsed.slice(0, max).trim();
}

export function excerptCite(text: string): string {
  const plain = collapseWs(text.replace(/[#*_`>]/g, ''));
  return clipAtWord(plain, RECAP_CITE_MAX);
}

export function clampSpoken(text: string, style: RecapStyle, source?: string): string {
  const core = clipAtWord(firstSentences(text.replace(/[#*_`>]/g, ''), 2), RECAP_SPOKEN_MAX);
  let spoken: string;
  if (style === 'podcast') {
    spoken = core.toLowerCase().startsWith("let's") ? core : `Let's recap this quickly. ${core}`;
  } else if (style === 'lecture') {
    spoken = /^(here'?s|in this)/i.test(core) ? core : `Here's the takeaway. ${core}`;
  } else {
    spoken = /^in short/i.test(core) ? core : `In short: ${core}`;
  }
  spoken = clipAtWord(spoken, RECAP_SPOKEN_MAX);
  if (source && !recapSpokenIsCondensed(spoken, source)) {
    spoken = clipAtWord(spoken, Math.min(RECAP_SPOKEN_MAX, Math.max(80, Math.floor(source.trim().length * 0.3))));
  }
  return spoken;
}

export function startRecapSession(input: {
  style: RecapStyle;
  length: RecapLength;
  sourceNoteId: string;
  sourceTitle: string;
  segments: Array<{ title: string; spoken: string; sourceCite?: string }>;
}): RecapSession {
  const cap = Math.min(recapSegmentCap(input.length), RECAP_SEGMENT_HARD_CAP);
  const style = normalizeRecapStyle(input.style);
  const segments: RecapSegment[] = [];
  for (const raw of input.segments) {
    if (segments.length >= cap) break;
    const title = collapseWs(raw.title) || `Beat ${segments.length + 1}`;
    const spoken = clampSpoken(raw.spoken, style);
    const sourceCite = excerptCite(raw.sourceCite || raw.spoken);
    if (!spoken && !sourceCite) continue;
    segments.push({
      id: slugId('beat', segments.length),
      title,
      spoken,
      sourceCite,
    });
  }

  return {
    style,
    length: normalizeRecapLength(input.length),
    sourceNoteId: input.sourceNoteId,
    sourceTitle: input.sourceTitle.trim() || 'Untitled note',
    segments,
    segmentIndex: 0,
    transcript: [],
    speechRate: RECAP_SPEECH_RATE_DEFAULT,
    status: segments.length === 0 ? 'ended' : 'ready',
  };
}

export function normalizeGeneratedRecap(
  raw: unknown,
  input: { style: RecapStyle; length: RecapLength; sourceNoteId: string; sourceTitle: string }
): RecapSession {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(record.segments) ? record.segments : [];
  const segments = rows.map((row) => {
    const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      title: String(item.title || ''),
      spoken: String(item.spoken || item.body || item.text || ''),
      sourceCite: String(item.sourceCite || item.citation || item.quote || ''),
    };
  });
  return startRecapSession({ ...input, segments });
}

function splitMaterialSections(notes: string, cap: number): Array<{ title: string; body: string }> {
  const text = notes.trim();
  if (!text) return [];
  const heading = /^(#{1,3})\s+(.+)$/gm;
  const matches = [...text.matchAll(heading)];
  if (matches.length === 0) {
    const chunks: Array<{ title: string; body: string }> = [];
    const paras = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    let bucket = '';
    let n = 1;
    for (const para of paras) {
      const next = bucket ? `${bucket}\n\n${para}` : para;
      if (next.length > 500 && bucket) {
        chunks.push({ title: `Part ${n}`, body: bucket });
        n += 1;
        bucket = para;
      } else {
        bucket = next;
      }
    }
    if (bucket) chunks.push({ title: `Part ${n}`, body: bucket });
    return chunks.slice(0, cap);
  }

  const sections: Array<{ title: string; body: string }> = [];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[index + 1];
    const end = nextMatch?.index ?? text.length;
    const title = String(match[2] || '').trim();
    const body = text.slice(start, end).trim();
    if (title || body) sections.push({ title: title || `Part ${index + 1}`, body });
  });
  return sections.slice(0, cap);
}

/**
 * Local listen-through when generate-recap is not on the API.
 * Condenses each section — it must not dump the PDF text into the player.
 */
export function recapFromMaterial(input: {
  style: RecapStyle;
  length: RecapLength;
  sourceNoteId: string;
  sourceTitle: string;
  notes: string;
}): RecapSession {
  const cap = recapSegmentCap(input.length);
  const sections = splitMaterialSections(input.notes, cap);
  const style = normalizeRecapStyle(input.style);
  const segments = sections.map((section) => ({
    title: section.title,
    spoken: clampSpoken(section.body, style, section.body),
    sourceCite: excerptCite(section.body),
  }));
  return startRecapSession({
    style,
    length: input.length,
    sourceNoteId: input.sourceNoteId,
    sourceTitle: input.sourceTitle,
    segments,
  });
}

export function composeRecapNoteBody(session: RecapSession): string {
  const snapshot = {
    style: session.style,
    length: session.length,
    sourceNoteId: session.sourceNoteId,
    sourceTitle: session.sourceTitle,
    segments: session.segments,
    segmentIndex: session.segmentIndex,
    transcript: session.transcript,
    speechRate: session.speechRate,
    status: session.status,
  };
  return `${session.sourceTitle} · ${recapStyleLabel(session.style)}\n\n\`\`\`${RECAP_FENCE}\n${JSON.stringify(snapshot)}\n\`\`\`\n`;
}

export function parseRecapNoteBody(body: string | null | undefined): RecapSession | null {
  if (!body) return null;
  const fenced = body.match(new RegExp('```' + RECAP_FENCE + '\\s*([\\s\\S]*?)```'));
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecapSession> & { segments?: RecapSegment[] };
    if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) return null;
    const segments = parsed.segments.filter(
      (row): row is RecapSegment =>
        Boolean(
          row &&
            typeof row === 'object' &&
            typeof row.id === 'string' &&
            typeof row.title === 'string' &&
            typeof row.spoken === 'string' &&
            typeof row.sourceCite === 'string'
        )
    );
    if (segments.length === 0) return null;
    return {
      style: normalizeRecapStyle(parsed.style),
      length: normalizeRecapLength(parsed.length),
      sourceNoteId: String(parsed.sourceNoteId || ''),
      sourceTitle: String(parsed.sourceTitle || 'Untitled note'),
      segments,
      segmentIndex: Math.min(Math.max(0, Number(parsed.segmentIndex) || 0), segments.length - 1),
      transcript: Array.isArray(parsed.transcript)
        ? parsed.transcript.filter(
            (turn): turn is RecapChatTurn =>
              Boolean(
                turn &&
                  typeof turn === 'object' &&
                  (turn.role === 'student' || turn.role === 'tutor') &&
                  typeof turn.text === 'string'
              )
          )
        : [],
      speechRate: clampSpeechRate(Number(parsed.speechRate) || RECAP_SPEECH_RATE_DEFAULT),
      status: parsed.status === 'ended' ? 'ended' : 'ready',
    };
  } catch {
    return null;
  }
}

export type RecapStudioDecision = { action: 'resume'; noteId: string } | { action: 'start' };

export function resolveRecapStudioNote(input: {
  recaps: readonly { id: string }[];
  selectedNoteId?: string | null;
}): RecapStudioDecision {
  if (input.selectedNoteId && input.recaps.some((row) => row.id === input.selectedNoteId)) {
    return { action: 'resume', noteId: input.selectedNoteId };
  }
  const first = input.recaps[0];
  if (first) return { action: 'resume', noteId: first.id };
  return { action: 'start' };
}
