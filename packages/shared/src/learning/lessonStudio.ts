/**
 * Lesson studio — Wave E of the academic replica.
 *
 * A structured tutor session, not a chat overlay. Explore lets the student
 * skip topics; Mastery sequences them. Pages are generated from the material
 * (capped), the device speaks them, and spoken commands stay local so "quiz
 * me" never has to round-trip.
 */
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '../utils/aiCredits';
import { hasEnoughNoteStudyContent } from '../utils/noteStudyContent';
import {
  normalizeAdaptiveKind,
  type AdaptiveQuizItem,
  type AdaptiveQuizKind,
} from './adaptiveQuiz';
import { isLectureNote } from './courseWorkspace';
import { isCalendarNote } from './studyCalendar';

export type LessonMode = 'explore' | 'mastery';

export const LESSON_PAGE_CAP = 40;

export const LESSON_FENCE = 'lantern-lesson';

export const LESSON_SPEECH_RATE_DEFAULT = 1;
export const LESSON_SPEECH_RATE_SLOWER = 0.75;
export const LESSON_SPEECH_RATE_FASTER = 1.15;
export const LESSON_SPEECH_RATE_MIN = 0.6;
export const LESSON_SPEECH_RATE_MAX = 1.25;

export const LESSON_MODES: readonly {
  id: LessonMode;
  label: string;
  promise: string;
}[] = [
  {
    id: 'explore',
    label: 'Explore',
    promise: 'Skip around. Jump to any topic.',
  },
  {
    id: 'mastery',
    label: 'Mastery',
    promise: 'Topics stay in order until you mark one complete.',
  },
];

export function lessonStudioPriceLine(): string {
  return `Starting a lesson costs ${formatCreditCost(AI_FEATURE_CREDIT_COST)}. Asking in the lesson chat costs another.`;
}

export function newLessonNoteTitle(mode: LessonMode, sourceTitle: string): string {
  const src = sourceTitle.trim() || 'this course';
  const kind = mode === 'mastery' ? 'Mastery' : 'Explore';
  return `Lesson — ${kind} · ${src}`;
}

export function isLessonNote(note: { title?: string | null; body?: string | null }): boolean {
  if (/^Lesson — /.test(note.title ?? '')) return true;
  return (note.body ?? '').includes(LESSON_FENCE);
}

/** Notes a new lesson can be built from. Lectures are last so a typed note is the default. */
export function lessonSourceNotes<
  T extends { id: string; title?: string | null; body?: string | null; sourceType?: string | null },
>(notes: readonly T[]): T[] {
  return notes
    .filter(
      (note) =>
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
 * True when generate-lesson is not on this API. Production 404s often arrive as
 * `{ error: "Error", message: "Not found - /api/v1/ai/generate-lesson" }` — the
 * client used to surface that as "Error" and skip the local fallback.
 */
export function isLessonGeneratorMissing(error: unknown): boolean {
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

export interface LessonCheck {
  stem: string;
  kind: AdaptiveQuizKind;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

export interface LessonPage {
  id: string;
  topicId: string;
  title: string;
  body: string;
  check?: LessonCheck;
}

export interface LessonTopic {
  id: string;
  title: string;
  pageIds: string[];
}

export interface LessonChatTurn {
  role: 'student' | 'tutor';
  text: string;
}

export interface LessonSession {
  mode: LessonMode;
  sourceNoteId: string;
  sourceTitle: string;
  plan: { topics: LessonTopic[] };
  pages: LessonPage[];
  pageIndex: number;
  completedTopicIds: string[];
  transcript: LessonChatTurn[];
  speechRate: number;
  checkOpen: boolean;
  status: 'ready' | 'ended';
}

export type LessonCommand =
  | { type: 'quiz_me' }
  | { type: 'slower' }
  | { type: 'faster' }
  | { type: 'jump'; topicNumber: number }
  | { type: 'complete' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'pause' }
  | { type: 'end' }
  | { type: 'chat'; text: string };

export function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) return LESSON_SPEECH_RATE_DEFAULT;
  return Math.min(LESSON_SPEECH_RATE_MAX, Math.max(LESSON_SPEECH_RATE_MIN, rate));
}

export function currentLessonPage(session: LessonSession): LessonPage | null {
  return session.pages[session.pageIndex] ?? null;
}

export function currentLessonTopic(session: LessonSession): LessonTopic | null {
  const page = currentLessonPage(session);
  if (!page) return null;
  return session.plan.topics.find((topic) => topic.id === page.topicId) ?? null;
}

export function lessonProgress(session: LessonSession): {
  done: number;
  total: number;
  percent: number;
} {
  const total = session.plan.topics.length;
  const done = session.plan.topics.filter((topic) =>
    session.completedTopicIds.includes(topic.id)
  ).length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export function topicIndexOf(session: LessonSession, topicId: string): number {
  return session.plan.topics.findIndex((topic) => topic.id === topicId);
}

export function canOpenPage(session: LessonSession, pageIndex: number): boolean {
  const page = session.pages[pageIndex];
  if (!page || session.status === 'ended') return false;
  if (session.mode === 'explore') return true;
  const targetTopic = topicIndexOf(session, page.topicId);
  if (targetTopic <= 0) return true;
  return session.plan.topics.slice(0, targetTopic).every((topic) =>
    session.completedTopicIds.includes(topic.id)
  );
}

export function canOpenTopic(session: LessonSession, topicId: string): boolean {
  const first = session.pages.findIndex((page) => page.topicId === topicId);
  if (first < 0) return false;
  return canOpenPage(session, first);
}

function goToPage(session: LessonSession, pageIndex: number): LessonSession {
  if (!canOpenPage(session, pageIndex)) return session;
  if (pageIndex === session.pageIndex) return session;
  return { ...session, pageIndex, checkOpen: false };
}

export function parseLessonCommand(utterance: string): LessonCommand {
  const text = utterance.trim();
  const lower = text.toLowerCase();
  if (!text) return { type: 'chat', text: '' };

  if (/^(quiz me|test me|give me a quiz|check me)\b/.test(lower)) return { type: 'quiz_me' };
  if (/^(slow down|slower|speak slower|too fast)\b/.test(lower)) return { type: 'slower' };
  if (/^(speed up|faster|normal speed|speak faster)\b/.test(lower)) return { type: 'faster' };
  if (/^(pause|stop talking|be quiet)\b/.test(lower)) return { type: 'pause' };
  if (/^(end( the)? lesson|finish lesson|stop the lesson)\b/.test(lower)) return { type: 'end' };
  if (/^(next( page)?|continue|go on)\b/.test(lower)) return { type: 'next' };
  if (/^(back|previous|last page)\b/.test(lower)) return { type: 'prev' };
  if (/^(mark (this )?complete|done with this|complete this( topic)?)\b/.test(lower)) {
    return { type: 'complete' };
  }
  const jump = lower.match(/^(?:jump to|go to|skip to|open) topic\s+(\d+)\b/);
  if (jump) return { type: 'jump', topicNumber: Number(jump[1]) };

  return { type: 'chat', text };
}

export function applyLessonCommand(session: LessonSession, command: LessonCommand): LessonSession {
  if (session.status === 'ended' && command.type !== 'chat') return session;

  switch (command.type) {
    case 'quiz_me':
      return currentLessonPage(session)?.check ? { ...session, checkOpen: true } : session;
    case 'slower':
      return { ...session, speechRate: clampSpeechRate(LESSON_SPEECH_RATE_SLOWER) };
    case 'faster':
      return { ...session, speechRate: clampSpeechRate(LESSON_SPEECH_RATE_FASTER) };
    case 'pause':
    case 'chat':
      return session;
    case 'end':
      return { ...session, status: 'ended', checkOpen: false };
    case 'complete': {
      const topic = currentLessonTopic(session);
      if (!topic || session.completedTopicIds.includes(topic.id)) return session;
      const completedTopicIds = [...session.completedTopicIds, topic.id];
      const next = { ...session, completedTopicIds, checkOpen: false };
      if (session.mode !== 'mastery') return next;
      const nextTopic = session.plan.topics.find((row) => !completedTopicIds.includes(row.id));
      if (!nextTopic) return { ...next, status: 'ended' };
      const first = session.pages.findIndex((page) => page.topicId === nextTopic.id);
      return first >= 0 ? { ...next, pageIndex: first } : next;
    }
    case 'next':
      return goToPage(session, session.pageIndex + 1);
    case 'prev':
      return goToPage(session, session.pageIndex - 1);
    case 'jump': {
      const topic = session.plan.topics[command.topicNumber - 1];
      if (!topic) return session;
      const first = session.pages.findIndex((page) => page.topicId === topic.id);
      return goToPage(session, first);
    }
    default:
      return session;
  }
}

export function appendLessonTurn(
  session: LessonSession,
  turn: LessonChatTurn
): LessonSession {
  const text = turn.text.trim();
  if (!text) return session;
  return { ...session, transcript: [...session.transcript, { role: turn.role, text }] };
}

export function quizItemsFromLesson(session: LessonSession): AdaptiveQuizItem[] {
  const items: AdaptiveQuizItem[] = [];
  session.pages.forEach((page, index) => {
    const check = page.check;
    if (!check?.stem.trim() || !check.correctAnswer.trim()) return;
    items.push({
      id: `${page.id}-check`,
      stem: check.stem.trim(),
      kind: check.kind,
      options: check.options,
      correctAnswer: check.correctAnswer,
      explanation: check.explanation,
      topic: page.title,
    });
    void index;
  });
  return items;
}

export function buildLessonAsk(input: {
  question?: string;
  page: LessonPage;
  sourceTitle?: string;
}): string {
  const question = input.question?.trim() || 'Explain this page';
  const where = input.sourceTitle?.trim()
    ? `in the lesson on "${input.sourceTitle.trim()}"`
    : 'in this lesson';
  return `${question}\n\nThis is the current lesson page ${where}:\n"""\n${input.page.title}\n\n${input.page.body}\n"""`;
}

export function speakTextForPage(page: LessonPage): string {
  const body = page.body.trim();
  if (!body) return page.title.trim();
  return `${page.title.trim()}. ${body}`;
}

function slugId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function asCheck(raw: unknown): LessonCheck | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const kind = normalizeAdaptiveKind(
    typeof row.kind === 'string' ? row.kind : typeof row.type === 'string' ? row.type : 'multiple_choice'
  );
  const stem = String(row.stem || row.text || row.question || '').trim();
  const correctAnswer = String(row.correctAnswer || '').trim();
  if (!kind || !stem || !correctAnswer) return undefined;
  const options = Array.isArray(row.options)
    ? row.options.map((opt) => String(opt).trim()).filter(Boolean)
    : undefined;
  return {
    stem,
    kind,
    options: options && options.length > 0 ? options : kind === 'true_false' ? ['True', 'False'] : undefined,
    correctAnswer,
    explanation: typeof row.explanation === 'string' ? row.explanation : undefined,
  };
}

export function clampLessonPages<T>(pages: readonly T[], cap: number = LESSON_PAGE_CAP): T[] {
  return pages.slice(0, Math.max(0, cap));
}

export function startLessonSession(input: {
  mode: LessonMode;
  sourceNoteId: string;
  sourceTitle: string;
  topics: Array<{ title: string; pages: Array<{ title: string; body: string; check?: unknown }> }>;
}): LessonSession {
  const topics: LessonTopic[] = [];
  const pages: LessonPage[] = [];
  input.topics.forEach((topic, topicIndex) => {
    if (pages.length >= LESSON_PAGE_CAP) return;
    const title = topic.title.trim() || `Topic ${topicIndex + 1}`;
    const topicId = slugId('topic', topicIndex);
    const pageIds: string[] = [];
    for (const rawPage of topic.pages) {
      if (pages.length >= LESSON_PAGE_CAP) break;
      const pageTitle = rawPage.title.trim() || title;
      const body = rawPage.body.trim();
      if (!pageTitle && !body) continue;
      const pageId = slugId('page', pages.length);
      pageIds.push(pageId);
      pages.push({
        id: pageId,
        topicId,
        title: pageTitle,
        body,
        check: asCheck(rawPage.check),
      });
    }
    if (pageIds.length > 0) topics.push({ id: topicId, title, pageIds });
  });

  return {
    mode: input.mode === 'mastery' ? 'mastery' : 'explore',
    sourceNoteId: input.sourceNoteId,
    sourceTitle: input.sourceTitle.trim() || 'Untitled note',
    plan: { topics },
    pages,
    pageIndex: 0,
    completedTopicIds: [],
    transcript: [],
    speechRate: LESSON_SPEECH_RATE_DEFAULT,
    checkOpen: false,
    status: pages.length === 0 ? 'ended' : 'ready',
  };
}

export function normalizeGeneratedLesson(
  raw: unknown,
  input: { mode: LessonMode; sourceNoteId: string; sourceTitle: string }
): LessonSession {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const topicsRaw = Array.isArray(record.topics) ? record.topics : [];
  const topics = topicsRaw.map((topic) => {
    const row = topic && typeof topic === 'object' ? (topic as Record<string, unknown>) : {};
    const pages = Array.isArray(row.pages) ? row.pages : [];
    return {
      title: String(row.title || ''),
      pages: pages.map((page) => {
        const item = page && typeof page === 'object' ? (page as Record<string, unknown>) : {};
        return {
          title: String(item.title || ''),
          body: String(item.body || item.text || ''),
          check: item.check,
        };
      }),
    };
  });
  return startLessonSession({ ...input, topics });
}

function splitMaterialSections(notes: string): Array<{ title: string; body: string }> {
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
      if (next.length > 700 && bucket) {
        chunks.push({ title: `Part ${n}`, body: bucket });
        n += 1;
        bucket = para;
      } else {
        bucket = next;
      }
    }
    if (bucket) chunks.push({ title: `Part ${n}`, body: bucket });
    return chunks.slice(0, LESSON_PAGE_CAP);
  }

  const sections: Array<{ title: string; body: string }> = [];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[index + 1];
    const end = nextMatch?.index ?? text.length;
    const title = String(match[2] || '').trim();
    const body = text.slice(start, end).trim();
    if (title || body) sections.push({ title: title || `Topic ${index + 1}`, body });
  });
  return sections.slice(0, LESSON_PAGE_CAP);
}

export function lessonFromMaterial(input: {
  mode: LessonMode;
  sourceNoteId: string;
  sourceTitle: string;
  notes: string;
  questions?: unknown[];
}): LessonSession {
  const sections = splitMaterialSections(input.notes);
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const topics = sections.map((section, index) => ({
    title: section.title,
    pages: [
      {
        title: section.title,
        body: section.body,
        check: questions[index],
      },
    ],
  }));
  return startLessonSession({
    mode: input.mode,
    sourceNoteId: input.sourceNoteId,
    sourceTitle: input.sourceTitle,
    topics,
  });
}

export function composeLessonNoteBody(session: LessonSession): string {
  const mode = session.mode === 'mastery' ? 'Mastery' : 'Explore';
  const snapshot = {
    mode: session.mode,
    sourceNoteId: session.sourceNoteId,
    sourceTitle: session.sourceTitle,
    plan: session.plan,
    pages: session.pages,
    pageIndex: session.pageIndex,
    completedTopicIds: session.completedTopicIds,
    transcript: session.transcript,
    speechRate: session.speechRate,
    status: session.status,
  };
  return `${session.sourceTitle} · ${mode}\n\n\`\`\`${LESSON_FENCE}\n${JSON.stringify(snapshot)}\n\`\`\`\n`;
}

export function parseLessonNoteBody(body: string | null | undefined): LessonSession | null {
  if (!body) return null;
  const fenced = body.match(new RegExp('```' + LESSON_FENCE + '\\s*([\\s\\S]*?)```'));
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LessonSession> & {
      plan?: { topics?: LessonTopic[] };
      pages?: LessonPage[];
    };
    if (!parsed.plan || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
    return {
      mode: parsed.mode === 'mastery' ? 'mastery' : 'explore',
      sourceNoteId: String(parsed.sourceNoteId || ''),
      sourceTitle: String(parsed.sourceTitle || 'Untitled note'),
      plan: { topics: Array.isArray(parsed.plan.topics) ? parsed.plan.topics : [] },
      pages: parsed.pages,
      pageIndex: Math.min(
        Math.max(0, Number(parsed.pageIndex) || 0),
        parsed.pages.length - 1
      ),
      completedTopicIds: Array.isArray(parsed.completedTopicIds)
        ? parsed.completedTopicIds.map(String)
        : [],
      transcript: Array.isArray(parsed.transcript)
        ? parsed.transcript.filter(
            (turn): turn is LessonChatTurn =>
              Boolean(
                turn &&
                  typeof turn === 'object' &&
                  (turn.role === 'student' || turn.role === 'tutor') &&
                  typeof turn.text === 'string'
              )
          )
        : [],
      speechRate: clampSpeechRate(Number(parsed.speechRate) || LESSON_SPEECH_RATE_DEFAULT),
      checkOpen: false,
      status: parsed.status === 'ended' ? 'ended' : 'ready',
    };
  } catch {
    return null;
  }
}

export type LessonStudioDecision =
  | { action: 'resume'; noteId: string }
  | { action: 'start' };

export function resolveLessonStudioNote(input: {
  lessons: readonly { id: string }[];
  selectedNoteId?: string | null;
}): LessonStudioDecision {
  if (input.selectedNoteId && input.lessons.some((row) => row.id === input.selectedNoteId)) {
    return { action: 'resume', noteId: input.selectedNoteId };
  }
  const first = input.lessons[0];
  if (first) return { action: 'resume', noteId: first.id };
  return { action: 'start' };
}
