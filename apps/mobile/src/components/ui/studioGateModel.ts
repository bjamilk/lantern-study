/**
 * `studioGate` — what a studio says when it cannot start yet.
 *
 * Every studio has a door it will not open: the quiz needs a note to write
 * questions from, the tutor and the recap need material to read, Play needs a
 * deck. Until build 203 each of those rendered as one grey sentence on bare
 * cream ground — *"Import or create a note first."* with no card, no mark and
 * NOTHING TO TAP (SF2 mobile evidence §4.2, `ln-19-quiz-empty.png`). The
 * student was told the blocker and handed no way through it.
 *
 * So the copy and the way out are modelled together, here, as data: a blocked
 * studio maps to a title, one line of body, and the actions that RESOLVE the
 * named blocker. The screen supplies only what it alone knows — the formatted
 * credit cost, and where the actions land — which keeps this file pure and
 * testable, and keeps the five studios from drifting into five dialects of
 * the same sentence.
 *
 * The existing strings are preserved in meaning, not paraphrased away: the
 * quiz still says questions are written from a note and still prices the next
 * step in AI uses, and Play still names its own container ("set" or "course")
 * through `body`, because only the caller knows the scope noun.
 */

/** The studios that can be blocked. Essay and Lecture never are: both open
 *  onto a usable composer, so neither has a gate to model. */
export type StudioGateStudio = 'quiz' | 'notes' | 'lesson' | 'recap' | 'play';

/**
 * Why the door is shut. One reason per studio shape, not per studio:
 * `no_material` is "this container holds nothing to build from", `no_open_note`
 * is "the container has notes but none is open", `no_deck` is Play's.
 */
export type StudioGateReason = 'no_material' | 'no_open_note' | 'no_deck';

/**
 * What the student can tap. The id — not a route — is what the model returns:
 * the target depends on whether the studio was opened on a set or on a bare
 * course, and that is the screen's business.
 */
export type StudioGateActionId = 'import_materials' | 'create_note' | 'open_materials';

export interface StudioGateAction {
  id: StudioGateActionId;
  label: string;
  /** Exactly one action per gate is `primary`; see the invariant test. */
  variant: 'primary' | 'secondary';
}

export interface StudioGateInput {
  studio: StudioGateStudio;
  reason: StudioGateReason;
  /**
   * The honest price of the step the gate leads to, already formatted by
   * `formatCreditCost` (e.g. `'1 AI use'`). Omitted when the next step is
   * free — a gate must never invent a cost, and must never hide one.
   */
  cost?: string;
  /**
   * What the cost buys, as the sentence's subject — `'Writing new questions'`
   * by default, because the quiz is the gate that priced itself first. A
   * studio that spends its credits on something else names that something
   * else rather than inheriting the quiz's verb.
   */
  costVerb?: string;
  /**
   * Replaces the default body when the caller owns a scope-aware string of
   * its own (Play's `playBlockerCopy`, which names "set" or "course"). The
   * shipped sentence wins over a generic one.
   */
  body?: string;
}

export interface StudioGateContent {
  /** Names the way through, not the absence. Set in the serif. */
  title: string;
  /** One sentence. Two is a paragraph, and a paragraph is not a gate. */
  body: string;
  /** The cost line, or undefined when the next step spends nothing. */
  costLine?: string;
  /** One or two. A gate with none is the bug this file exists to fix. */
  actions: StudioGateAction[];
}

/**
 * The labels, in one place. The VARIANT is not here: which of two actions is
 * the black pill depends on the blocker, and an action that is primary on one
 * gate and secondary on another must not carry a fixed answer around with it.
 */
const LABELS: Record<StudioGateActionId, string> = {
  import_materials: 'Import materials',
  create_note: 'Create a note',
  open_materials: 'Open a note',
};

/** First id is the black pill; the second, if any, is the outline. */
function toActions(ids: readonly StudioGateActionId[]): StudioGateAction[] {
  return ids.map((id, index) => ({
    id,
    label: LABELS[id],
    variant: index === 0 ? 'primary' : 'secondary',
  }));
}

/** Title and body per studio, for the reason that studio can actually hit. */
const COPY: Record<StudioGateStudio, { title: string; body: string }> = {
  quiz: {
    title: 'Start from a note',
    // Keeps "Import or create a note first." — the blocker — and the reason
    // the studio needs one at all.
    body: 'Import or create a note first. Questions are written from what it says.',
  },
  notes: {
    // The one gate that is not about an empty container: the set has notes,
    // none is open, and the studio works on the open one.
    title: 'Open a note to study it',
    body: 'Open a note in this set first. Everything here is built from the note you pick.',
  },
  lesson: {
    title: 'Start from a note',
    body: 'Import or write a note first. The lesson is built from that material.',
  },
  recap: {
    title: 'Start from a note',
    body: 'Import or write a note first. The recap is built from that material.',
  },
  play: {
    // Not "Create a deck": mobile has no deck-maker of its own. A deck is
    // made by opening a note and turning it into cards, so the gate says the
    // step that exists rather than offering a button with nowhere to go.
    title: 'Play needs a deck',
    body: 'File a deck first. Cards are made from a note, in the note’s studio.',
  },
};

function actionsFor(studio: StudioGateStudio, reason: StudioGateReason): StudioGateAction[] {
  // Play's way out is a deck, and a deck is made from a note: opening one
  // leads, importing follows for the student who has no notes either.
  if (reason === 'no_deck' || studio === 'play') {
    return toActions(['open_materials', 'import_materials']);
  }
  // The container is not empty; the studio just has nothing open. Importing
  // more would not help, so opening leads and creating follows.
  if (reason === 'no_open_note') return toActions(['open_materials', 'create_note']);
  return toActions(['import_materials', 'create_note']);
}

/**
 * The gate's whole content, from the studio and its blocker.
 *
 * Pure: same input, same object. No theme, no navigation, no store — the
 * component renders what this returns and the screen routes the ids.
 */
export function studioGate(input: StudioGateInput): StudioGateContent {
  const copy = COPY[input.studio];
  return {
    title: copy.title,
    body: input.body?.trim() || copy.body,
    costLine: input.cost
      ? studioGateCostLine(input.costVerb || 'Writing new questions', input.cost)
      : undefined,
    actions: actionsFor(input.studio, input.reason),
  };
}

/** The one shape a price takes on a gate: `<verb> uses <cost>.` */
export function studioGateCostLine(verb: string, cost: string): string {
  return `${verb} uses ${cost}.`;
}
