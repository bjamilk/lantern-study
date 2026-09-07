/**
 * The Usage & limits screen, as data.
 *
 * Wave 3's promise is that a student can always answer three questions without
 * guessing: how many AI uses do I have left, what does each button cost, and
 * what can I still do when the number is zero. All three are decided here, in
 * one pure module both clients render, so the phone and the browser can never
 * print different arithmetic.
 *
 * Every cost below is READ from the constants the server charges against
 * (`AI_CREDIT_COSTS`, `SMART_NOTES_CREDIT_COST`, `AI_FEATURE_CREDIT_COST`,
 * `STUDY_PACK_DRAFT_CREDITS`). Nothing here types a number for a price. A
 * hand-typed figure is how a counter starts lying, and a counter that lies
 * about money is worse than no counter at all.
 *
 * The free list is not a marketing list. Each row was checked against the
 * route that serves it before it was written down; the notes on
 * `ZERO_CREDIT_DOORS` say which route. Anything that could not be verified
 * free is in the cost table instead — lecture transcription is the one that
 * moved.
 */
import {
  AI_CREDIT_COSTS,
  AI_FEATURE_CREDIT_COST,
  LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT,
  REFERRAL_REWARD_AI_USES,
  SMART_NOTES_CREDIT_COST,
  formatBonusAIUses,
  formatCreditCost,
} from '../utils/aiCredits';
import { STUDY_PACK_DRAFT_CREDITS } from '../marketplace/studyPacks';
import { formatAIResetTime, getAIResetLabel } from '../utils/aiUsage';

/** One feature's own daily cap, as the server reports it. */
export interface AIFeatureUsage {
  /** The server's feature key, e.g. `generate_flashcards`. */
  feature: string;
  used: number;
  limit: number;
}

/** Everything the screen is given. `features` is absent on older servers. */
export interface AIUsageSnapshot {
  used: number;
  limit: number;
  /** ISO timestamp of the next reset; '' when the server has not said. */
  resetsAt: string;
  features?: AIFeatureUsage[];
  /**
   * Referral-reward uses still unspent, as the server reports them.
   *
   * `undefined` means the server did not say — an older API, or one without
   * the bonus ledger. That is NOT the same as zero, and the clients must show
   * nothing rather than print a balance they never measured.
   */
  bonusRemaining?: number;
}

/** A thing that spends AI uses, and what it spends. */
export interface AICostRow {
  id: string;
  label: string;
  /** What a student says the price is for. One line, no selling. */
  detail: string;
  cost: number;
  /** `formatCreditCost(cost)` — the one helper, never a local string. */
  costLabel: string;
  /** Set when this action ALSO has its own daily cap on the server. */
  featureKey?: string;
  /** "3 of 15 used today" — only when the server sent that feature's counts. */
  featureCapLabel?: string;
  /** True when the feature's own cap is spent, whatever the global count says. */
  featureCapReached: boolean;
  /** False when the remaining allowance cannot pay for this action today. */
  affordable: boolean;
}

/** A thing that costs nothing, and the reason it is listed. */
export interface AIFreeRow {
  id: string;
  label: string;
  detail: string;
}

/**
 * What a student can do right now.
 *
 * `kind: 'extension'` rows are the deliberate seam: if the founder decides to
 * offer a top-up or a referral reward at zero, it is added by passing
 * `extraSteps` to `planZeroCreditSteps` — no purchase flow is built here, and
 * nothing in this module knows what money is.
 */
export interface AIUsageNextStep {
  id: string;
  label: string;
  detail: string;
  kind: 'free-door' | 'wait' | 'extension' | 'referral';
}

export interface AIUsageView {
  used: number;
  limit: number;
  remaining: number;
  /** Remaining as a fraction of the limit, 0..1. Drives the ring/bar. */
  ratio: number;
  /** "12 of 20 AI uses left today" — the counter, in words. */
  countLabel: string;
  /** "Resets in 4h 23m" (relative). */
  resetRelative: string;
  /** "Sep 8, 1:00 AM" (absolute, local). '' when the server has not said. */
  resetAbsolute: string;
  exhausted: boolean;
  /** Two or fewer left: the same threshold the badge turns amber at. */
  low: boolean;
  costRows: AICostRow[];
  freeRows: AIFreeRow[];
  /** Only meaningful at zero, but always computed so the screen can preview it. */
  nextSteps: AIUsageNextStep[];
  /**
   * "+3 bonus uses", or `null` when the server said nothing about a bonus
   * balance (older API) or the balance is empty. A null hides the line.
   */
  bonusLabel: string | null;
}

/** The price list, keyed to the route that charges it. */
interface CostSpec {
  id: string;
  label: string;
  detail: string;
  cost: number;
  featureKey?: string;
}

/**
 * Every action that spends AI uses.
 *
 * Verified against the server on 2026-09-07:
 *   generate-flashcards / notes/:id/generate-flashcards  aiRateLimitForFeature('generate_flashcards')
 *   generate-questions  / notes/:id/quiz / daily-quiz    aiRateLimitForFeature('generate_questions')
 *   notes/:id/summarize                                  aiRateLimitWithCost(getSmartNotesCreditCost)
 *   notes OCR import                                     chargeAiCredits(NOTE_OCR_CREDIT_COST)
 *   notes/transcribe-audio                               aiRateLimit  ← NOT free
 *   ai-companion (tutor)                                 aiRateLimitForFeature('companion')
 *   explain-answer / study-recommendations / ask-tutor /
 *   enhance-flashcard / generate-listing-description     aiRateLimitForFeature(...)
 *   ai/study-pack/draft                                  aiRateLimitWithCost(STUDY_PACK_DRAFT_CREDITS)
 */
export const AI_COST_SPECS: readonly CostSpec[] = [
  {
    id: 'flashcards',
    label: 'Make flashcards from a note',
    detail: 'One run makes a deck from the note you are in.',
    cost: AI_CREDIT_COSTS.generate_flashcards,
    featureKey: 'generate_flashcards',
  },
  {
    id: 'questions',
    label: 'Make a test from a note',
    detail: 'One run makes a set of questions. The daily quiz uses this too.',
    cost: AI_CREDIT_COSTS.generate_questions,
    featureKey: 'generate_questions',
  },
  {
    id: 'smart_notes_standard',
    label: 'Smart note (concise or standard)',
    detail: 'Rewrites a note into a study version.',
    cost: SMART_NOTES_CREDIT_COST.standard,
  },
  {
    id: 'smart_notes_deep',
    label: 'Smart note (deep dive)',
    detail: 'Reads a long source in chunks, then merges and checks it.',
    cost: SMART_NOTES_CREDIT_COST.deep,
  },
  {
    id: 'note_ocr',
    label: 'Read handwriting from a photo',
    detail: 'Turns a photographed page into text. Runs when you add photo pages, or tap Run OCR.',
    cost: AI_CREDIT_COSTS.note_ocr,
  },
  {
    id: 'transcribe',
    label: 'Transcribe a lecture recording',
    // The one action whose price depends on its length, so the row says the
    // rule and prices the first block. `getLectureTranscriptionCost` is what
    // both the recorder and the server actually charge.
    detail: `Recording is free. Turning the audio into text costs one for every ${LECTURE_TRANSCRIPTION_MINUTES_PER_CREDIT} minutes, or part of one.`,
    cost: AI_FEATURE_CREDIT_COST,
  },
  {
    id: 'tutor',
    label: 'Ask Lantern AI a question',
    detail: 'Each reply in the tutor chat.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'companion',
  },
  {
    id: 'explain',
    label: 'Explain an answer',
    detail: 'Why an answer was right or wrong, after a test.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'explain',
  },
  {
    id: 'study_plan',
    label: 'Ask for a study plan',
    detail: 'A plan built from what you have been revising.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'study_plan',
  },
  {
    id: 'study_recommendations',
    label: 'Study recommendations',
    detail: 'What to revise next, from your recent results.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'study_recommendations',
  },
  {
    id: 'enhance_flashcard',
    label: 'Improve one flashcard',
    detail: 'Rewrites a single card you already have.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'enhance_flashcard',
  },
  {
    id: 'listing_description',
    label: 'Write a listing description',
    detail: 'Draft copy for something you are selling.',
    cost: AI_FEATURE_CREDIT_COST,
    featureKey: 'listing_description',
  },
  {
    id: 'study_pack_draft',
    label: 'Turn notes into a study product',
    detail: 'Drafts a whole pack in one go, so it costs the most.',
    cost: STUDY_PACK_DRAFT_CREDITS,
  },
];

/**
 * What still works at zero.
 *
 * Each row was read off the route that serves it — none of these go anywhere
 * near `aiRateLimit`, so none of them can be refused for want of credits.
 */
export const ZERO_CREDIT_DOORS: readonly AIFreeRow[] = [
  {
    id: 'manual_cards',
    label: 'Write flashcards yourself',
    detail: 'Making and editing cards by hand never touches AI.',
  },
  {
    id: 'import',
    label: 'Import a deck — text, CSV or Anki',
    detail: 'The file is parsed and saved as-is. No AI reads it.',
  },
  {
    id: 'study',
    label: 'Study everything you already have',
    detail: 'Reviews, cram, match, learn, tests and notes are all free, always.',
  },
  {
    id: 'record',
    label: 'Record a lecture',
    detail: 'Recording and keeping the audio is free. Transcribing it is not.',
  },
  {
    id: 'retry_save',
    label: 'Save AI work that failed to save',
    detail: 'The material is already made and held — saving it again is free.',
  },
  {
    id: 'browse',
    label: 'Browse, buy, sell and chat',
    detail: 'Nothing in the marketplace, community or chat spends AI uses.',
  },
];

/** "3 of 15 used today", or undefined when the server sent no counts. */
function featureCapLabel(usage: AIFeatureUsage | undefined): string | undefined {
  if (!usage || usage.limit <= 0) return undefined;
  return `${usage.used} of ${usage.limit} used today`;
}

/**
 * Build the whole screen from a server snapshot.
 *
 * `nowMs` is injected so the countdown is testable — the screen passes
 * Date.now() and re-renders on its own tick.
 */
export function buildAIUsageView(
  snapshot: AIUsageSnapshot,
  options: {
    nowMs?: number;
    extraSteps?: readonly AIUsageNextStep[];
    includeReferral?: boolean;
  } = {}
): AIUsageView {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(0, snapshot.limit || 0);
  // The server is the arithmetic. Clamp rather than recompute: a `used` above
  // `limit` (a refund race) must read as zero left, never as a negative.
  const used = Math.min(Math.max(0, snapshot.used || 0), limit);
  const remaining = Math.max(0, limit - used);
  const ratio = limit > 0 ? remaining / limit : 0;

  const byFeature = new Map<string, AIFeatureUsage>();
  for (const row of snapshot.features ?? []) {
    if (row && typeof row.feature === 'string') byFeature.set(row.feature, row);
  }

  const costRows: AICostRow[] = AI_COST_SPECS.map((spec) => {
    const feature = spec.featureKey ? byFeature.get(spec.featureKey) : undefined;
    return {
      id: spec.id,
      label: spec.label,
      detail: spec.detail,
      cost: spec.cost,
      costLabel: formatCreditCost(spec.cost),
      featureKey: spec.featureKey,
      featureCapLabel: featureCapLabel(feature),
      featureCapReached: Boolean(feature && feature.limit > 0 && feature.used >= feature.limit),
      affordable: remaining >= spec.cost,
    };
  });

  return {
    used,
    limit,
    remaining,
    ratio,
    countLabel:
      limit > 0
        ? `${remaining} of ${limit} AI uses left today`
        : 'AI uses are not available on this account',
    resetRelative: getAIResetLabel(snapshot.resetsAt, { used, limit, nowMs }),
    resetAbsolute: formatAIResetTime(snapshot.resetsAt),
    exhausted: limit > 0 && remaining <= 0,
    low: limit > 0 && remaining > 0 && remaining <= 2,
    costRows,
    freeRows: [...ZERO_CREDIT_DOORS],
    bonusLabel: formatBonusAIUses(snapshot.bonusRemaining),
    nextSteps: planZeroCreditSteps(snapshot, {
      nowMs,
      extraSteps: options.extraSteps,
      includeReferral: options.includeReferral,
    }),
  };
}

/**
 * The founder's answer to "I am out of AI uses": earn more, never buy them.
 *
 * Both halves of the reward are the same number and both come from
 * `REFERRAL_REWARD_AI_USES`, so the screen cannot promise an amount the server
 * does not grant. The reward is deliberately tied to the friend STARTING to
 * study rather than to the install: an invite that never opens a deck helps
 * nobody, and paying for it would make the invite list the product.
 *
 * There is no price and no checkout here, and there must never be one — see
 * the note on `planZeroCreditSteps`.
 */
export const REFERRAL_NEXT_STEP: AIUsageNextStep = {
  id: 'referral',
  label: `Invite a friend — you both get ${formatCreditCost(REFERRAL_REWARD_AI_USES)} when they start studying`,
  detail: 'Share your invite link. Nothing to pay, now or ever.',
  kind: 'referral',
};

/**
 * What to offer a student who has run out.
 *
 * Deliberately a separate exported planner, and deliberately additive: the
 * founder's pending decision (a top-up, a referral reward, both, neither) is
 * expressed by passing `extraSteps`. This function builds NO purchase flow and
 * must not grow one — a step that takes money belongs behind a real checkout,
 * not behind a list of suggestions.
 */
export function planZeroCreditSteps(
  snapshot: AIUsageSnapshot,
  options: {
    nowMs?: number;
    extraSteps?: readonly AIUsageNextStep[];
    /** Off only where there is nowhere to send the student (a screen with no invite route). */
    includeReferral?: boolean;
  } = {}
): AIUsageNextStep[] {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(0, snapshot.limit || 0);
  const used = Math.min(Math.max(0, snapshot.used || 0), limit);
  const remaining = Math.max(0, limit - used);

  const steps: AIUsageNextStep[] = [
    // First, because it is the only step that CHANGES the number. Everything
    // below it is either waiting or a door that was already open.
    ...(options.includeReferral === false ? [] : [REFERRAL_NEXT_STEP]),
    {
      id: 'wait',
      label: getAIResetLabel(snapshot.resetsAt, { used, limit, nowMs }) || 'Resets at midnight GMT',
      detail:
        remaining > 0
          ? `You still have ${remaining} today.`
          : 'Your full daily allowance comes back then.',
      kind: 'wait',
    },
    ...ZERO_CREDIT_DOORS.map(
      (door): AIUsageNextStep => ({
        id: door.id,
        label: door.label,
        detail: door.detail,
        kind: 'free-door',
      })
    ),
  ];

  // The seam. Nothing supplies these yet, and nothing here decides to.
  for (const extra of options.extraSteps ?? []) {
    if (extra && extra.id && !steps.some((step) => step.id === extra.id)) {
      steps.push({ ...extra, kind: 'extension' });
    }
  }

  return steps;
}
