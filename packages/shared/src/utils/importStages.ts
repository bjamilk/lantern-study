/**
 * What an import is doing right now, as three cards — and where the student
 * can go once it is finished.
 *
 * WHY IT IS HERE AND NOT IN A COMPONENT. Both the browser's import modal and
 * the phone's import sheet draw the same three stages, and the two pipelines
 * report the same three facts (the bytes landed, the note exists, the
 * generator run finished). Written twice they drift, and the only way to test
 * the interesting part — what the cards say when a stage FAILS — is to keep it
 * away from React entirely. Nothing here renders, imports a component, or
 * touches the network.
 *
 * NO INVENTED PROGRESS (house rule: honest UI). The reference animates a
 * "Processing Progress" bar from 5% to 75% and prints "~10m remaining" beside
 * it; both numbers are decoration, and its own walk-through recorded the ETA
 * jumping from ten minutes to sixteen seconds. Lantern's pipeline reports a
 * real percentage for exactly two things — the upload, from the XHR's
 * `upload.onprogress`, and the generator run, from the stage it has reached —
 * so those are the only two cards that ever carry one. The middle card, where
 * the server reads the file, has no progress to report and says so by showing
 * none. `importWaitHint` is the honest replacement for the ETA: a range, by
 * kind, that does not pretend to know.
 *
 * Touches: nothing. Pure functions over a plain state object.
 *
 * Gotcha: a stage that has FAILED must not leave the stages after it looking
 * like they are still coming — `deriveImportStages` freezes everything after
 * the failure as `pending` and hangs the message on the card that broke, so
 * the modal can render the reason where it happened instead of as a banner
 * detached from the step it belongs to.
 */

/** Which door started this run. Decides the heading and the wait hint. */
export type ImportKind =
  | 'pdf'
  | 'presentation'
  | 'document'
  | 'photos'
  | 'text'
  | 'youtube'
  | 'cards';

/** The three cards, in order. */
export type ImportStageId = 'uploaded' | 'processing' | 'generating';

export type ImportStageStatus = 'pending' | 'active' | 'done' | 'failed';

export interface ImportStageCard {
  id: ImportStageId;
  label: string;
  status: ImportStageStatus;
  /**
   * 0–100 when the pipeline genuinely reports one, `null` otherwise. `null`
   * means "we do not know", and the UI must draw an indeterminate card rather
   * than a bar sitting at zero.
   */
  percent: number | null;
  /** Only ever set on a `failed` card. */
  error?: string;
}

/** What the generator run will produce, as the toggles left it. */
export type ImportGeneratedArtifact = 'flashcards' | 'quiz';

export interface ImportRunState {
  kind: ImportKind;
  /**
   * The transfer. `null` for a door that sends no bytes (a YouTube link, a
   * paste), where the first card is about the material being ACCEPTED rather
   * than uploaded.
   */
  upload: {
    phase: 'encoding' | 'uploading' | 'processing' | 'complete';
    /** From `upload.onprogress`; null when the length is not computable. */
    percent: number | null;
  } | null;
  /** The note exists and its text has been read out of the file. */
  materialReady: boolean;
  /** Empty when the student switched both generators off. */
  generates: readonly ImportGeneratedArtifact[];
  /** The generator's own reported stage. Never a clock. */
  generation: { index: number; count: number } | null;
  generationDone: boolean;
  failure: { stage: ImportStageId; message: string } | null;
}

export function emptyImportRunState(
  kind: ImportKind,
  generates: readonly ImportGeneratedArtifact[] = ['flashcards', 'quiz'],
  hasUpload = true
): ImportRunState {
  return {
    kind,
    upload: hasUpload ? { phase: 'encoding', percent: null } : null,
    materialReady: false,
    generates,
    generation: null,
    generationDone: false,
    failure: null,
  };
}

const KIND_NOUN: Record<ImportKind, string> = {
  pdf: 'PDF',
  presentation: 'PowerPoint',
  document: 'Word document',
  photos: 'photos',
  text: 'notes',
  youtube: 'YouTube video',
  cards: 'cards',
};

/** "Importing PDF", "Importing YouTube video". */
export function importRunHeading(kind: ImportKind): string {
  return `Importing ${KIND_NOUN[kind]}`;
}

export const IMPORT_RUN_SUBHEADING =
  "We're reading it and creating your study materials";

/**
 * The honest stand-in for the reference's fake ETA. A range, by kind, with no
 * number attached to THIS run — because nothing in the pipeline can tell how
 * long this file will take until it has taken it.
 */
export function importWaitHint(kind: ImportKind): string {
  if (kind === 'youtube') {
    return 'A video takes longer than a document — the transcript is fetched before anything is written.';
  }
  if (kind === 'photos' || kind === 'presentation') {
    return 'This usually takes a minute or two: the text is read off every page.';
  }
  return 'This usually takes under a minute.';
}

function generatingLabel(generates: readonly ImportGeneratedArtifact[]): string {
  const cards = generates.includes('flashcards');
  const quiz = generates.includes('quiz');
  if (cards && quiz) return 'Generating flashcards and quiz';
  if (cards) return 'Generating flashcards';
  if (quiz) return 'Generating quiz';
  // Both switched off: the Smart Notes pass is still what runs, and naming it
  // is the difference between a card that is honest and one that is a lie the
  // student's own toggles made.
  return 'Writing Smart Notes';
}

function uploadedLabel(state: ImportRunState): string {
  if (state.upload) return 'Material uploaded';
  return state.kind === 'youtube' ? 'Video linked' : 'Material added';
}

const STAGE_ORDER: readonly ImportStageId[] = ['uploaded', 'processing', 'generating'];

/**
 * The three cards for a run, from what is actually known about it.
 *
 * Read it as three independent questions rather than a state machine: each
 * card asks whether the fact it stands for has landed yet. That is why a run
 * whose upload jumped straight to `complete` (a cached file, a fast link) does
 * not need a synthetic "uploading" tick to reach the second card.
 */
export function deriveImportStages(state: ImportRunState): ImportStageCard[] {
  const failedAt = state.failure ? STAGE_ORDER.indexOf(state.failure.stage) : -1;

  const uploadDone = state.upload
    ? state.upload.phase === 'processing' || state.upload.phase === 'complete'
    : state.materialReady;

  const cards: ImportStageCard[] = [
    {
      id: 'uploaded',
      label: uploadedLabel(state),
      status: uploadDone ? 'done' : 'active',
      percent: uploadDone ? 100 : (state.upload?.percent ?? null),
    },
    {
      id: 'processing',
      label: 'Processing material',
      status: state.materialReady ? 'done' : uploadDone ? 'active' : 'pending',
      // The server gives no progress while it reads a file, so this card never
      // shows a bar. An indeterminate spinner is the truth here.
      percent: state.materialReady ? 100 : null,
    },
    {
      id: 'generating',
      label: generatingLabel(state.generates),
      status: state.generationDone
        ? 'done'
        : state.materialReady || state.generation
          ? 'active'
          : 'pending',
      percent: state.generationDone
        ? 100
        : state.generation && state.generation.count > 0
          ? Math.min(
              100,
              Math.max(0, Math.round((state.generation.index / state.generation.count) * 100))
            )
          : null,
    },
  ];

  if (failedAt < 0 || !state.failure) return cards;

  return cards.map((card, index) => {
    if (index < failedAt) return card;
    if (index === failedAt) {
      return {
        ...card,
        status: 'failed' as const,
        percent: null,
        error: state.failure!.message,
      };
    }
    // Everything after the break is NOT coming. Leaving it `active` would draw
    // a spinner against work that stopped.
    return { ...card, status: 'pending' as const, percent: null };
  });
}

/**
 * Which stage card an upload-path error belongs on.
 *
 * The transport failures are the ones the upload helper raises itself; every
 * other message came back FROM the server, which means the bytes arrived and it
 * was reading them that failed. Getting this right is the whole point of the
 * cards: "check your connection" and "no text could be read out of this PDF"
 * are different problems, and a student shown the wrong one retries the wrong
 * thing.
 */
export function uploadStageOf(error: unknown): ImportStageId {
  const message = error instanceof Error ? error.message : '';
  return /check your connection|timed out|Upload failed|Network request failed/i.test(message)
    ? 'uploaded'
    : 'processing';
}

/** True while the run is still going and nothing has broken. */
export function isImportRunning(state: ImportRunState): boolean {
  return !state.failure && !state.generationDone;
}

/* -------------------------------------------------- where would you go next */

export type WhereNextCardId = 'material' | 'plan' | 'setHome';

export interface WhereNextCard {
  id: WhereNextCardId;
  title: string;
  detail: string;
  /** Exactly one card carries the badge. */
  recommended: boolean;
}

export const WHERE_NEXT_TITLE = 'Where would you like to go next?';
export const WHERE_NEXT_FOOTER = 'You can always switch later.';

/**
 * The two cards of the completion fork.
 *
 * The second card is the study plan when the set HAS one and the set's home
 * otherwise. It is never a disabled "View study plan" — a door to a plan that
 * does not exist is the dead door this wave removed from the upload page, and
 * it would be worse here, at the one moment the student is being asked to
 * choose.
 */
export function whereNextCards(options: {
  hasMaterial: boolean;
  hasPlan: boolean;
}): WhereNextCard[] {
  const cards: WhereNextCard[] = [];
  if (options.hasMaterial) {
    cards.push({
      id: 'material',
      title: 'View material',
      detail: 'Read what you just imported, with its notes beside it',
      recommended: true,
    });
  }
  cards.push(
    options.hasPlan
      ? {
          id: 'plan',
          title: 'View study plan',
          detail: 'See where this fits in what you are working through',
          recommended: !options.hasMaterial,
        }
      : {
          id: 'setHome',
          title: 'Set home',
          detail: 'Back to everything in this set',
          recommended: !options.hasMaterial,
        }
  );
  return cards;
}

/* ------------------------------------------------------ creation progress */

export type CreationStatus = 'processing' | 'done' | 'failed';

export type CreationTab = 'all' | 'processing' | 'done' | 'failed';

export const CREATION_TABS: readonly CreationTab[] = ['all', 'processing', 'done', 'failed'];

/**
 * One row of the Creation Progress popover, in the shape both platforms can
 * map their own job record onto. Web's `aiJobStore` and the phone's
 * `jobsStore` are different types with different status words; the popover is
 * the same list, so the mapping happens at the edge and the filtering happens
 * here, once.
 */
export interface CreationEntry {
  id: string;
  title: string;
  status: CreationStatus;
  /** What it is doing, or why it failed. */
  detail?: string;
  /** Where clicking it goes, when the artefact exists. */
  route?: string;
  /** For ordering: newest first. */
  updatedAt: number;
}

export const CREATIONS_EMPTY = 'No recent creations';

export function filterCreations(
  rows: readonly CreationEntry[],
  tab: CreationTab
): CreationEntry[] {
  const kept = tab === 'all' ? [...rows] : rows.filter((row) => row.status === tab);
  return kept.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function countCreations(
  rows: readonly CreationEntry[],
  status: CreationStatus
): number {
  return rows.filter((row) => row.status === status).length;
}

/** The popover's own subtitle — the reference's "0 processing, 0 completed". */
export function creationsSummary(rows: readonly CreationEntry[]): string {
  const processing = countCreations(rows, 'processing');
  const done = countCreations(rows, 'done');
  return `${processing} processing, ${done} done`;
}
