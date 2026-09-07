/**
 * What the job progress sheet says, as a pure function of the job and the clock.
 *
 * All of Wave G's copy rules live here rather than in JSX, so they can be
 * tested in node:
 *
 * - progress never claims 100% before the work is done (StudyFetch's tray
 *   reported a video complete that never played — the failure this wave exists
 *   to beat);
 * - leaving the sheet is never described as cancelling the work;
 * - after the 90 s budget the sheet stops promising and offers a way out,
 *   without saying the job died and without offering a second charge;
 * - a failure names the error, and claims nothing about the credit it cannot
 *   know (the usage badge is re-read from the server instead).
 */
import { DEEP_LINK_SCHEME } from '@lantern/shared/linking';
import {
  hasUnsavedGeneration,
  JOB_TIME_BUDGET_MS,
  type JobArtifactRef,
  type JobKind,
  type TrackedJob,
} from '../../stores/jobsCore';
import { describeJobPush, type PushReadiness } from '../../utils/pushDiagnostics';

/** The three stages every generator moves through, in the student's words. */
export const jobStages = (kind: JobKind, count?: number): string[] => {
  const many = (noun: string) => (count && count > 0 ? `Writing ${count} ${noun}` : `Writing your ${noun}`);
  switch (kind) {
    case 'flashcards':
      return ['Reading your notes', many('cards'), 'Saving to your deck'];
    case 'quiz':
      return ['Reading your notes', many('questions'), 'Saving your test'];
    case 'test':
      return ['Reading your material', many('questions'), 'Saving your test'];
    case 'summary':
      return ['Reading your notes', 'Writing the summary', 'Saving to the note'];
    case 'import':
    default:
      return ['Reading your pages', 'Making study materials', 'Saving to your library'];
  }
};

/** What a finished job produced, singular/plural, for headlines and notifications. */
export const jobArtefactLabel = (kind: JobKind, count?: number): string => {
  const n = count && count > 0 ? count : undefined;
  switch (kind) {
    case 'flashcards':
      return n ? `${n} flashcard${n === 1 ? '' : 's'}` : 'Your flashcards';
    case 'quiz':
      return n ? `${n}-question test` : 'Your test';
    case 'test':
      return n ? `${n}-question test` : 'Your test';
    case 'summary':
      return 'Your summary';
    case 'import':
    default:
      return 'Your study materials';
  }
};

/**
 * Which stage a server-supplied fraction is inside.
 *
 * The fraction is the SERVER's, or there is none: the clock is not a source
 * of progress. Airplane mode used to walk the bar 8% → 64% → 93% through
 * "Writing 10 cards" while no request could possibly be in flight (F7), which
 * is the same lie StudyFetch's tray tells — a number that describes a timer
 * rather than the work.
 */
export const stageIndexFor = (stageCount: number, progress?: number): number => {
  if (stageCount <= 0) return 0;
  if (typeof progress !== 'number' || progress < 0) return 0;
  return Math.min(stageCount - 1, Math.floor(Math.min(1, progress) * stageCount));
};

/**
 * The server's machine stage words, as an index into the three client stages.
 *
 * The server's vocabulary (jobs/jobState.ts) is queued → reading → generating
 * → saving → done; the sheet shows three steps. This is the only place the two
 * are joined, so there is exactly one answer to "which step is running".
 */
const SERVER_STAGE_INDEX: Record<string, number> = {
  queued: 0,
  reading: 0,
  generating: 1,
  saving: 2,
  done: 2,
  failed: 2,
  timed_out: 2,
};

/**
 * The percent band each client stage owns, `[floor, ceiling]`.
 *
 * Bands rather than a free-running number: the bar and the ticked step come
 * out of one reducer, so the sheet can no longer say "Saving to your deck" at
 * 11% while the checklist still has "Reading your notes" active. The last
 * band stops at 95 — a running job never shows 100.
 */
export const JOB_STAGE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, 45],
  [45, 85],
  [85, 95],
];

const bandFor = (index: number, stageCount: number): readonly [number, number] => {
  if (stageCount <= 0) return [0, 95];
  // Stage lists are three long today; a longer one degrades to an even split
  // rather than reading past the end of the band table.
  if (stageCount !== JOB_STAGE_BANDS.length) {
    const width = 95 / stageCount;
    return [Math.round(index * width), Math.round((index + 1) * width)];
  }
  return JOB_STAGE_BANDS[Math.min(index, JOB_STAGE_BANDS.length - 1)];
};

/** One value the subtitle, the checklist and the bar all read. */
export interface JobProgressView {
  /** Index into the stage list; the checklist's active row AND the subtitle. */
  stageIndex: number;
  /** `stages[stageIndex]` — the student-facing wording of that same step. */
  stage: string;
  /** 0..100, always inside `stageIndex`'s band. */
  percent: number;
  /**
   * Nothing has reported since the last thing shown — no server record, no
   * runner stage. The bar holds where it is and the subtitle says so.
   */
  waiting: boolean;
}

/** What the subtitle says when there is no news and no connection to get any. */
export const WAITING_FOR_CONNECTION_COPY = 'Waiting for connection…';

/** What it says when there is a connection but nothing new has been reported. */
export const STILL_WORKING_COPY = 'Still working…';

/** Whether the device can currently be told anything. */
export interface JobProgressContext {
  /** No connection: the bar holds and the subtitle names the reason. */
  offline?: boolean;
}

/**
 * Where a running job has got to, from every signal at once.
 *
 * Three sources can say something: the server's machine stage word, a stage
 * the client runner reported in the student's own wording, and the elapsed
 * clock (or a server fraction). They are folded into ONE index — the furthest
 * any of them claims, so progress never goes backwards — and the percent is
 * then clamped into that stage's band. Nothing downstream re-derives either.
 *
 * An old server that sends a status and no stage still lands here: the clock
 * alone picks the index, and the percent is clamped to the same one.
 */
export const jobProgressView = (
  job: TrackedJob,
  stages: string[] = jobStages(job.kind, job.requestedCount)
): JobProgressView => {
  const count = stages.length;
  const fraction =
    typeof job.progress === 'number' && job.progress >= 0 ? Math.min(1, job.progress) : undefined;

  const signals = [stageIndexFor(count, fraction)];
  const fromServer = job.serverStage ? SERVER_STAGE_INDEX[job.serverStage] : undefined;
  if (typeof fromServer === 'number') signals.push(fromServer);
  // A runner's own stage counts only when it is one of THIS list's steps —
  // otherwise the subtitle and the checklist would name different things.
  const fromClient = job.stage ? stages.indexOf(job.stage) : -1;
  if (fromClient >= 0) signals.push(fromClient);

  const stageIndex = Math.max(0, Math.min(count - 1, Math.max(...signals)));
  const [floor, ceiling] = bandFor(stageIndex, count);
  // Without a fraction the bar rests on the floor of the step something has
  // actually reported. It moves when the work does, and not otherwise.
  const percent =
    fraction === undefined
      ? Math.min(95, floor)
      : Math.min(95, Math.max(floor, Math.min(ceiling, Math.round(fraction * 100))));

  return {
    stageIndex,
    stage: stages[stageIndex] ?? stages[0] ?? '',
    percent,
    waiting: fraction === undefined && typeof fromServer !== 'number' && fromClient < 0,
  };
};

/**
 * The bar, 0..100.
 *
 * Never a time estimate: without a server fraction it rests on the floor of
 * the furthest step something reported, and it is capped at 95 until the job
 * actually reports done. Delegates to `jobProgressView`, so the number can
 * never disagree with the step the checklist has ticked.
 */
export const percentFor = (job: TrackedJob): number => {
  if (job.status === 'done') return 100;
  if (job.status === 'failed' || job.status === 'lost') return 0;
  return jobProgressView(job).percent;
};

/** m:ss, for the elapsed readout. */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Leaving the sheet does not stop the work, and the button says so. */
export const KEEP_WORKING_COPY = "Keep working, we'll tell you when it's ready";

/**
 * The same button when nothing can be delivered.
 *
 * With notification permission refused, or no push token registered, "we'll
 * tell you when it's ready" is a promise the app cannot keep — the device run
 * waited 212 s in the background and was told nothing (F6). It says what will
 * actually happen instead, and the sheet offers to fix it.
 */
export const NO_NOTIFICATIONS_COPY =
  'Come back to this screen to see it finish — notifications are off';

/**
 * The same button when we could not check.
 *
 * The status route did not answer (offline, or a server that predates it), so
 * neither "we'll tell you" nor "notifications are off" is a thing we know.
 * This says only what is certain: coming back here always works.
 */
export const UNVERIFIED_NOTIFICATIONS_COPY = 'Come back to this screen to see it finish';

/** After the budget: honest about the wait, not about a death that has not happened. */
export const OVER_BUDGET_COPY =
  "This is taking longer than usual. It's still running and you've only been charged once — keep waiting, or carry on and we'll tell you when it's ready.";

export type JobSheetAction =
  | 'stop-watching'
  | 'keep-waiting'
  | 'retry'
  /** Notifications are off, so the promise the sheet makes is not true yet. */
  | 'enable-notifications'
  /**
   * Save material that was generated but never filed. A second SAVE, not a
   * second generation: the AI call has happened and has been charged, so
   * offering "Try again" here would sell the same work twice.
   */
  | 'save-to-library'
  | 'open'
  | 'dismiss';

export interface JobSheetState {
  /** Big line at the top of the sheet. */
  headline: string;
  /** The current stage, or the outcome. */
  detail: string;
  /** Every stage, so the sheet can show the path rather than one word. */
  stages: string[];
  /** Index into `stages`; -1 once the job is terminal. */
  stageIndex: number;
  percent: number;
  elapsedLabel: string;
  /** Past the 90 s client budget and still running. */
  overBudget: boolean;
  /** Nothing new has been reported: the bar holds where it is. */
  waiting: boolean;
  /** Buttons, in order. */
  actions: JobSheetAction[];
  tone: 'running' | 'done' | 'failed';
  /**
   * One line about the completion push — "Notified by push ✓", or the plain
   * reason it was skipped. `null` while the job runs, and on any record whose
   * server never wrote an audit: an absent field is not evidence of either
   * outcome, and a caption that guessed would be the same silent failure this
   * line exists to expose.
   */
  pushNote: string | null;
}

/**
 * @param budgetMs How long the sheet waits before offering a way out. Defaults
 *   to the 90 s client budget; the sheet extends it when the student presses
 *   "Keep waiting", so the prompt does not immediately reappear.
 */
export interface JobSheetContext extends JobProgressContext {
  /**
   * This device cannot be notified — permission refused, or no push token.
   * The sheet stops promising and offers to turn notifications on.
   *
   * The older boolean form of `notifications`; `'off'` when true.
   */
  notificationsOff?: boolean;
  /**
   * Whether a push about this job can actually reach this phone, as three
   * answers: OS permission granted AND the server holding a usable token AND
   * the account's push switch on (`ready`), any of those known false
   * (`off`), or the server not reachable to ask (`unknown`).
   *
   * Three rather than two because the promise "we'll tell you when it's
   * ready" is only true in the first case, and the claim "notifications are
   * off" is only true in the second — build 161 made the first claim while
   * neither was checked.
   */
  notifications?: PushReadiness;
}

/** Fold the two forms into one answer. Absent means: assume it works. */
export const resolveNotificationReadiness = (
  context: { notificationsOff?: boolean; notifications?: PushReadiness } = {}
): PushReadiness => context.notifications ?? (context.notificationsOff ? 'off' : 'ready');

export const jobSheetState = (
  job: TrackedJob,
  now: number,
  budgetMs: number = JOB_TIME_BUDGET_MS,
  context: JobSheetContext = {}
): JobSheetState => {
  const stages = jobStages(job.kind, job.requestedCount);
  const elapsed = Math.max(0, now - job.startedAt);
  const elapsedLabel = formatElapsed(elapsed);

  if (job.status === 'done') {
    const label = jobArtefactLabel(job.kind, job.resultCount ?? job.requestedCount);
    const ref = jobResultRef(job);
    return {
      headline: `${label} ready`,
      detail: ref?.name ? `Saved to "${ref.name}"` : `From ${job.sourceTitle}`,
      stages,
      stageIndex: -1,
      percent: 100,
      elapsedLabel,
      overBudget: false,
      waiting: false,
      // Always both. Every finished job now has somewhere to go — its
      // artefact, or the job itself on Home — so a done sheet whose only
      // button is "Dismiss" (which is what a finished quiz used to offer)
      // cannot happen again.
      actions: ['open', 'dismiss'],
      tone: 'done',
      pushNote: describeJobPush(job.pushAudit),
    };
  }

  // Generated, not filed. This is not a loss and must not be described as
  // one: the cards or questions are on this device, and one button puts them
  // in the library at no further cost.
  if (hasUnsavedGeneration(job) && (job.status === 'failed' || job.status === 'lost')) {
    return {
      headline: 'Ready to save',
      detail: job.error
        ? `${job.error} Nothing was lost — saving it again is free.`
        : "We made this but hadn't saved it to your library yet.",
      stages,
      stageIndex: -1,
      percent: 0,
      elapsedLabel,
      overBudget: false,
      waiting: false,
      actions: ['save-to-library', 'dismiss'],
      tone: 'failed',
      pushNote: describeJobPush(job.pushAudit),
    };
  }

  if (job.status === 'failed') {
    return {
      headline: "That didn't finish",
      // The error verbatim. No blanket claim about the credit: a server-side
      // failure is refunded automatically, but a job can also fail AFTER the
      // AI answered (the save step), where the credit was honestly spent —
      // the usage badge is re-read from the server and is the source of truth.
      detail: job.error || 'The generation failed.',
      stages,
      stageIndex: -1,
      percent: 0,
      elapsedLabel,
      overBudget: false,
      waiting: false,
      actions: ['retry', 'dismiss'],
      tone: 'failed',
      pushNote: describeJobPush(job.pushAudit),
    };
  }

  if (job.status === 'lost') {
    return {
      headline: 'We lost track of this one',
      // Short enough to fit the Home card's three lines. The old wording ran
      // past its two and was cut mid-word ("check your library bef…"), which
      // is exactly the sentence the student needed to finish reading.
      detail: job.error
        ? `${job.error} Check your library before retrying.`
        : 'The app closed before it finished — check your library before retrying.',
      stages,
      stageIndex: -1,
      percent: 0,
      elapsedLabel,
      overBudget: false,
      waiting: false,
      actions: ['retry', 'dismiss'],
      tone: 'failed',
      pushNote: describeJobPush(job.pushAudit),
    };
  }

  // One reducer, three readouts: the subtitle IS the ticked step, and the bar
  // is inside that step's band.
  const progress = jobProgressView(job, stages);
  const overBudget = elapsed >= budgetMs;
  // No news is described as no news. The clock does not stand in for it.
  const waitingCopy = context.offline ? WAITING_FOR_CONNECTION_COPY : STILL_WORKING_COPY;
  return {
    headline: `${jobArtefactLabel(job.kind, job.requestedCount)} · ${job.sourceTitle}`,
    detail: overBudget ? OVER_BUDGET_COPY : progress.waiting ? waitingCopy : progress.stage,
    stages,
    stageIndex: progress.stageIndex,
    percent: progress.percent,
    elapsedLabel,
    overBudget,
    waiting: progress.waiting,
    // No Retry while the work is still running: a second attempt cannot
    // cancel the first, so the original would land anyway and the student
    // would be charged twice for two decks. Retry is offered once a job has
    // actually failed (web makes the same call).
    //
    // "Keep working" is on EVERY running sheet, over budget or not: the sheet
    // is a report, never a cell, and the device run found one with no way out
    // but the hardware Back key (F6).
    actions: [
      ...(overBudget ? (['keep-waiting'] as JobSheetAction[]) : []),
      'stop-watching' as JobSheetAction,
      // Only offered when we KNOW it is off. Offering "Turn on notifications"
      // to a student whose notifications are already on — which is what an
      // unverifiable answer would do — sends them to a screen with nothing
      // to fix.
      ...(resolveNotificationReadiness(context) === 'off'
        ? (['enable-notifications'] as JobSheetAction[])
        : []),
    ],
    tone: 'running',
    // Nothing to report until the job settles: the audit is written when it
    // does.
    pushNote: null,
  };
};

/**
 * Label for each action, so the sheet and the Home card agree.
 *
 * `notificationsOff` changes exactly one label: the promise this app cannot
 * keep without notification permission.
 */
export const jobActionLabel = (
  action: JobSheetAction,
  context: { notificationsOff?: boolean; notifications?: PushReadiness } = {}
): string => {
  switch (action) {
    case 'stop-watching': {
      const readiness = resolveNotificationReadiness(context);
      if (readiness === 'off') return NO_NOTIFICATIONS_COPY;
      if (readiness === 'unknown') return UNVERIFIED_NOTIFICATIONS_COPY;
      return KEEP_WORKING_COPY;
    }
    case 'enable-notifications':
      return 'Turn on notifications';
    case 'keep-waiting':
      return 'Keep waiting';
    case 'retry':
      return 'Try again';
    case 'save-to-library':
      return 'Save to library';
    case 'open':
      return 'Open';
    case 'dismiss':
    default:
      return 'Dismiss';
  }
};

/**
 * The deep link a completion notification taps through to.
 *
 * Built in the shared scheme's `<scheme>://<type>/<id>` shape so it parses back
 * through `parseDeepLink` — the handler this lane wires the notification into.
 * Assembled here rather than through `generateDeepLink` because `note` is not
 * one of the shared `DeepLinkType` members (`parseDeepLink` returns it happily;
 * widening that union is packages/shared's call, not this lane's), and the
 * round-trip is covered by this module's test.
 *
 * Every kind gets one now, the daily quiz included: it has no id of its own,
 * so it is saved under the `daily` id and the link resolves to the dashboard
 * panel it lives in. A tap that restored the app wherever it happened to be —
 * the note editor, in the case the device run caught — is not "opening" it.
 *
 * A `test` carries its name in the query string because the screen that shows
 * one requires a title; nothing else needs a parameter.
 */
export const jobArtifactLink = (artifact: JobArtifactRef | undefined): string | null => {
  if (!artifact || !artifact.id) return null;
  const query =
    artifact.type === 'test' && artifact.name
      ? `?name=${encodeURIComponent(artifact.name)}`
      : '';
  return `${DEEP_LINK_SCHEME}://${artifact.type}/${encodeURIComponent(artifact.id)}${query}`;
};

/**
 * The job itself, as a link.
 *
 * Where a completion lands when there is no artefact to name — an old server's
 * bare "completed", or a push that arrived before this device knew anything
 * about the job. It resolves to the artefact if the store has one by the time
 * it is opened, and to the job's card on Home if it does not, which is a true
 * statement about what is known either way.
 */
export const jobLink = (jobId: string): string =>
  `${DEEP_LINK_SCHEME}://jobs/${encodeURIComponent(jobId)}`;

/**
 * Where a job's output actually landed.
 *
 * `savedRef` is written when the save completes and `artifact` when the job
 * settles, so they agree — except in the window between them, and after a
 * cold start where only the persisted one survives. Both are consulted.
 */
export const jobResultRef = (job: TrackedJob): JobArtifactRef | undefined =>
  job.artifact ?? job.savedRef;

/** The link a finished job's Open button and notification tap both use. */
export const jobResultLink = (job: TrackedJob): string =>
  jobArtifactLink(jobResultRef(job)) ?? jobLink(job.id);

export interface JobNotification {
  title: string;
  body: string;
  /**
   * Deep link for the tap. Never null: a completion always points at its
   * artefact, and anything else points at the job on Home. A notification
   * whose payload was empty — which is what the quiz sent — restores the app
   * wherever it was and tells the student nothing.
   */
  url: string;
  /** The job it belongs to, so a local post can be deduped against a push. */
  jobId: string;
}

/**
 * The local notification for a finished job.
 *
 * Titled with the artefact and the material it came from — "20 flashcards
 * ready · Foundations of AI" — because a notification that says only
 * "Generation complete" makes the student open the app to find out what.
 */
export const jobNotification = (job: TrackedJob): JobNotification | null => {
  if (job.status === 'done') {
    const label = jobArtefactLabel(job.kind, job.resultCount ?? job.requestedCount);
    const ref = jobResultRef(job);
    return {
      title: `${label} ready · ${job.sourceTitle}`,
      body: ref?.name ? `Tap to open "${ref.name}".` : 'Tap to open.',
      url: jobResultLink(job),
      jobId: job.id,
    };
  }
  if (job.status === 'failed') {
    return {
      title: `Couldn't finish · ${job.sourceTitle}`,
      body: job.error || 'The generation failed.',
      // Not a dead tap: it opens the job's card on Home, where Try again is.
      url: jobLink(job.id),
      jobId: job.id,
    };
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Swiping the sheet away
// ─────────────────────────────────────────────────────────────

/** How far the sheet has to be dragged down before it counts as dismissed. */
export const SHEET_DISMISS_DISTANCE = 60;

/** A drag has to be this far down before the sheet takes the gesture at all. */
export const SHEET_DRAG_SLOP = 6;

/**
 * Does this movement belong to the sheet rather than to what is under it?
 *
 * Downward, past the slop, and more vertical than horizontal. The slop is what
 * lets a TAP on one of the sheet's buttons still be a tap: the sheet only
 * claims the gesture once it is unmistakably a drag.
 */
export const shouldClaimSheetDrag = (dy: number, dx: number): boolean =>
  dy > SHEET_DRAG_SLOP && Math.abs(dy) > Math.abs(dx);

/** Did the student let go far enough down to mean "close this"? */
export const shouldDismissSheet = (
  dy: number,
  distance: number = SHEET_DISMISS_DISTANCE
): boolean => dy > distance;
