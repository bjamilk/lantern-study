// ===========================================
// Lantern Study - Completion push payloads (pure)
// ===========================================
//
// A student who starts a generation and then leaves the app was told "we'll
// tell you when it's ready" and then told nothing: the client poller does not
// run in the background, so the only notification arrived seconds after they
// came back. The server has to be the one that speaks.
//
// This module is the pure half of that: given a finished job record it
// produces the exact push a device should receive — title, body, and the data
// payload whose `url` the app's deep-link handler routes on. Nothing here does
// I/O, so every copy rule and every link is unit-tested in node.
//
// Two rules the tests pin:
//  - a notification never claims an artefact the server cannot point at. When
//    the client is the one that saves the deck/test, the push carries
//    `pending: true` and a `jobs/<id>` link the app resolves from its own
//    store, rather than a link to the wrong screen;
//  - a failure names the error and offers nothing about credits, which the
//    record's own ledger owns.

import type { JobError, JobKind, JobResultRef, JobStage } from './jobState';

/**
 * The app's URL scheme. Duplicated from `../linking` on purpose: the server
 * build (tsconfig.server.json) compiles `src/jobs/**` but not `src/linking`,
 * so importing it here would break the API's consumed output. The test asserts
 * the two stay equal.
 */
export const JOB_PUSH_DEEP_LINK_SCHEME = 'lanternstudy';

/** Notification type for settings policy — gated by the master push toggle only. */
export const JOB_PUSH_NOTIFICATION_TYPE = 'job_generation_complete';

/**
 * Kinds a student is told about.
 *
 * Excluded on purpose: `explain`, `tutor`, `companion`, `recommendations` and
 * `enhance` are answers inside a screen the student is already looking at, and
 * `maintenance` is cron work nobody asked for. Pushing those would train
 * students to ignore the ones that matter.
 */
const PUSHABLE_KINDS = new Set<JobKind>([
  'flashcards',
  'questions',
  'quiz',
  'smart_notes',
  'study_pack',
  'import',
  'ocr',
  'transcript',
  'presentation',
  'export',
]);

export function isPushableJobKind(kind: JobKind): boolean {
  return PUSHABLE_KINDS.has(kind);
}

export interface JobPushInput {
  jobId: string;
  kind: JobKind;
  stage: JobStage;
  result?: unknown;
  resultRef?: JobResultRef;
  error?: JobError;
  /** The note/deck/file this was generated from, when the job carried a title. */
  sourceTitle?: string;
}

export interface JobPushMessage {
  title: string;
  body: string;
  data: {
    type: string;
    jobId: string;
    kind: JobKind;
    stage: JobStage;
    url: string;
    /**
     * True when the server produced content the CLIENT saves, so no artefact id
     * exists server-side. The app resolves the artefact from its own job store.
     */
    pending?: true;
  };
}

/** How many artefacts a finished job actually produced, when it says. */
export function jobResultCount(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ['flashcards', 'questions', 'cards']) {
    const value = record[key];
    if (Array.isArray(value)) return value.length;
  }
  // notes.ai.quiz returns the saved session, whose questions sit one level in.
  const nested = record.session ?? record.data;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    for (const key of ['flashcards', 'questions', 'cards']) {
      const value = inner[key];
      if (Array.isArray(value)) return value.length;
    }
  }
  return undefined;
}

/**
 * What the finished work is called, in the student's words.
 * "10 flashcards", "12-question quiz", "Your summary".
 */
export function jobArtefactLabel(kind: JobKind, count?: number): string {
  const n = typeof count === 'number' && count > 0 ? count : undefined;
  switch (kind) {
    case 'flashcards':
      return n ? `${n} flashcard${n === 1 ? '' : 's'}` : 'Your flashcards';
    case 'questions':
      return n ? `${n}-question test` : 'Your test';
    case 'quiz':
      return n ? `${n}-question quiz` : 'Your quiz';
    case 'smart_notes':
      return 'Your summary';
    case 'study_pack':
      return 'Your study pack';
    case 'import':
      return 'Your import';
    case 'ocr':
    case 'transcript':
    case 'presentation':
      return 'Your file';
    case 'export':
      return 'Your data export';
    default:
      return 'Your study materials';
  }
}

/**
 * The deep link for a server-known artefact, or null when the server cannot
 * point at one.
 *
 * `quiz` deliberately returns null even though the record carries the owning
 * note's id: on device, a quiz notification that opened the note editor read
 * as the wrong screen. Null sends the student through the job link instead,
 * where the app knows what it saved.
 */
export function jobArtefactDeepLink(resultRef: JobResultRef | undefined): string | null {
  if (!resultRef || !resultRef.id) return null;
  switch (resultRef.type) {
    case 'deck':
    case 'note':
    case 'test':
      return `${JOB_PUSH_DEEP_LINK_SCHEME}://${resultRef.type}/${encodeURIComponent(resultRef.id)}`;
    default:
      return null;
  }
}

/** Where a notification lands when only the app knows what it saved. */
export function jobFallbackDeepLink(jobId: string): string {
  return `${JOB_PUSH_DEEP_LINK_SCHEME}://jobs/${encodeURIComponent(jobId)}`;
}

/** The Redis claim for "this job's <stage> push has been sent". */
export function jobPushIdempotencyKey(jobId: string, stage: JobStage): string {
  return `job:${jobId}:push:${stage}`;
}

function withSource(title: string, sourceTitle?: string): string {
  const source = (sourceTitle || '').trim();
  if (!source) return title;
  return `${title} · ${source}`;
}

/**
 * The push for a terminal job, or null when this job should not produce one
 * (non-terminal, or a kind students are not notified about).
 */
export function buildJobPushMessage(input: JobPushInput): JobPushMessage | null {
  const { jobId, kind, stage } = input;
  if (!jobId) return null;
  if (stage !== 'done' && stage !== 'failed' && stage !== 'timed_out') return null;
  if (!isPushableJobKind(kind)) return null;

  const artefactUrl = stage === 'done' ? jobArtefactDeepLink(input.resultRef) : null;
  const url = artefactUrl ?? jobFallbackDeepLink(jobId);
  const base = {
    type: JOB_PUSH_NOTIFICATION_TYPE,
    jobId,
    kind,
    stage,
    url,
  };

  if (stage === 'done') {
    const label = jobArtefactLabel(kind, jobResultCount(input.result));
    // Client-saved kinds: the server has only GENERATED the content — the app
    // still has to save it. Saying "ready" here overclaims if the app was
    // killed (build 156), so the pending copy promises exactly what is true.
    return artefactUrl
      ? {
          title: withSource(`${label} ready`, input.sourceTitle),
          body: 'Tap to open it.',
          data: base,
        }
      : {
          title: withSource(`${label} generated`, input.sourceTitle),
          body: 'Open Lantern to save them to your library.',
          data: { ...base, pending: true },
        };
  }

  if (stage === 'timed_out') {
    return {
      title: withSource("That took too long", input.sourceTitle),
      body:
        input.error?.message ||
        'This took longer than expected and was stopped. Your credit was returned.',
      data: base,
    };
  }

  return {
    title: withSource("That didn't finish", input.sourceTitle),
    body: input.error?.message || 'The generation failed. Tap to try again.',
    data: base,
  };
}
