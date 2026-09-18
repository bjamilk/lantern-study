/**
 * The create wizard as a state machine, so the numbering cannot drift from the
 * screens.
 *
 * WHY A FUNCTION AND NOT A CONSTANT. The wizard is not one flow: how many
 * questions it asks depends on the kind (only a quiz is asked how many
 * questions and which types) AND on the source the student picked on step one
 * (a deck picker is one screen; a topic is two). A stepper that says "2 of 4"
 * while the screens go on to a fifth is a lie the student catches, so the
 * count and the screens are read out of the same list here.
 *
 * Touches: `CreateFromSource` renders `wizardSteps(kind, source)[index]` and
 * shows `index + 1` of `length`. Nothing else consumes it.
 *
 * Gotcha: on step one there is no source yet, so there is no exact length. The
 * preview is the LONGEST path the kind can take (`longestSourceForKind`), i.e.
 * the most screens the student could be in for. Once a source is picked the
 * number is exact, and it only ever shrinks — never grows under them.
 */
import {
  CREATE_FROM_SOURCE_NOUN,
  sourcesForKind,
  type CreateFromSourceId,
  type CreateFromSourceKind,
} from '@lantern/shared';

export type WizardStepId =
  | 'source'
  | 'materials'
  | 'decks'
  | 'topic'
  | 'depth'
  | 'count'
  | 'types'
  | 'details'
  | 'anki';

export interface WizardStep {
  id: WizardStepId;
  /** The one line at the top of the screen. One question, always. */
  question: string;
  /**
   * The word inside `question` set in italic serif — `Headline`'s accent. It
   * must appear in `question` verbatim or the line renders unaccented.
   */
  accent?: string;
}

/** The kinds whose materials path ends on the name-it screen. */
const NAMES_ITSELF: readonly CreateFromSourceKind[] = ['quiz', 'recap', 'lesson', 'essay'];

/** What follows the source screen, per source. `scratch` leaves the wizard. */
function stepsAfterSource(
  kind: CreateFromSourceKind,
  source: CreateFromSourceId
): WizardStepId[] {
  switch (source) {
    case 'materials': {
      const rest: WizardStepId[] = ['materials'];
      // Only the quiz door asks how many and which types; every other kind
      // takes the defaults, exactly as it did before the split.
      if (kind === 'quiz') rest.push('count', 'types');
      if (NAMES_ITSELF.includes(kind)) rest.push('details');
      return rest;
    }
    case 'topic':
      return ['topic', 'depth'];
    case 'flashcards':
      return ['decks'];
    case 'import':
      return ['anki'];
    case 'scratch':
    default:
      return [];
  }
}

/**
 * The source whose path has the most screens — what step one counts against.
 * Ties go to the earlier source, so the preview follows the order the cards
 * are drawn in.
 */
export function longestSourceForKind(kind: CreateFromSourceKind): CreateFromSourceId {
  const sources = sourcesForKind(kind);
  // `sourcesForKind` never returns an empty list; the fallback is only here so
  // the type is exact rather than "maybe undefined" all the way down.
  let best: CreateFromSourceId = sources[0] ?? 'scratch';
  let bestLength = -1;
  for (const source of sources) {
    const length = stepsAfterSource(kind, source).length;
    if (length > bestLength) {
      best = source;
      bestLength = length;
    }
  }
  return best;
}

function questionFor(id: WizardStepId, kind: CreateFromSourceKind): { question: string; accent?: string } {
  const noun = CREATE_FROM_SOURCE_NOUN[kind];
  switch (id) {
    case 'source':
      return { question: `How would you like to create your ${noun}?`, accent: 'your' };
    case 'materials':
      return { question: 'Which material should we use?', accent: 'material' };
    case 'decks':
      return { question: 'Which decks should we use?', accent: 'decks' };
    case 'topic':
      return { question: 'What do you want to study?', accent: 'study' };
    case 'depth':
      return { question: 'How deep should it go?', accent: 'deep' };
    case 'count':
      return { question: 'How many questions?', accent: 'many' };
    case 'types':
      return { question: 'Which question types?', accent: 'types' };
    case 'details':
      return { question: `What should we call this ${noun}?`, accent: noun };
    case 'anki':
      return { question: 'Paste your Anki or Quizlet export', accent: 'Anki' };
    default:
      return { question: '' };
  }
}

/**
 * Every screen this run of the wizard will show, in order.
 *
 * `source` null means step one, where the path is not chosen yet: the list is
 * the longest path the kind can take, so the stepper has a number to show.
 */
export function wizardSteps(
  kind: CreateFromSourceKind,
  source: CreateFromSourceId | null
): WizardStep[] {
  const resolved = source ?? longestSourceForKind(kind);
  const ids: WizardStepId[] = ['source', ...stepsAfterSource(kind, resolved)];
  return ids.map((id) => ({ id, ...questionFor(id, kind) }));
}

/** Where `id` sits in this path, or 0 when it is not on it (step one). */
export function wizardStepIndex(steps: readonly WizardStep[], id: WizardStepId): number {
  const at = steps.findIndex((step) => step.id === id);
  return at < 0 ? 0 : at;
}
