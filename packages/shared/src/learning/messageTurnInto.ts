/**
 * Turning ONE chat answer into study material.
 *
 * Lantern's Turn-into already works on the note attached to a conversation.
 * This module covers the other half a student expects: the answer in front of
 * them, which may have been typed straight into the thread and never written
 * down anywhere.
 *
 * Nothing here talks to a store or an API. Both clients need the same two
 * answers — "what can this message become?" and "what note does it become?" —
 * and a shared pure module is the only way they stay the same answer.
 */
import type { TurnIntoTargetId } from './courseWorkspace';
import { TURN_INTO_TARGETS } from './courseWorkspace';

/**
 * How a target behaves when the source is a message rather than a note.
 *
 * - `generate` — the target is made FROM text, so a message can feed it
 *   directly: save the answer as a note, then run the existing note → deck /
 *   note → test job on it. Cards and tests, and nothing else.
 * - `studio` — the target is a PLACE that opens on a note (lesson, recap and
 *   essay read one; play shuffles a set's cards). A message cannot open a
 *   studio on its own, so the action is honestly two steps: save the answer as
 *   a note, then open that studio.
 */
export type MessageTurnIntoKind = 'generate' | 'studio';

export const MESSAGE_TURN_INTO_KIND: Record<TurnIntoTargetId, MessageTurnIntoKind> = {
  cards: 'generate',
  quiz: 'generate',
  test: 'generate',
  notes: 'studio',
  lesson: 'studio',
  recap: 'studio',
  essay: 'studio',
  play: 'studio',
};

/** The two targets a message can become without a detour through a studio. */
export const MESSAGE_GENERATE_TARGETS: readonly TurnIntoTargetId[] = TURN_INTO_TARGETS.filter(
  (target) => MESSAGE_TURN_INTO_KIND[target.id] === 'generate'
).map((target) => target.id);

export function messageTurnIntoKind(id: TurnIntoTargetId): MessageTurnIntoKind {
  return MESSAGE_TURN_INTO_KIND[id];
}

/**
 * What the row under the pills promises for one target.
 *
 * A studio target says both steps out loud. A pill that reads "Lesson" and
 * then silently files a note the student never asked for is the kind of
 * surprise that makes people stop trusting the button.
 */
export function messageTurnIntoActionLabel(id: TurnIntoTargetId): string {
  const target = TURN_INTO_TARGETS.find((row) => row.id === id);
  const label = target?.label ?? id;
  return MESSAGE_TURN_INTO_KIND[id] === 'generate'
    ? label
    : `Save as note, then open ${label}`;
}

/** Every target stays offered; the two kinds differ only in what they promise. */
export const MESSAGE_TURN_INTO_TARGETS = TURN_INTO_TARGETS;

export interface MessageNoteDraftInput {
  /** The answer body, exactly as it was shown. */
  content: string;
  /** `assistant` answers are the only ones worth filing; a user turn is the question. */
  role?: string;
  /** ISO timestamp of the turn; falls back to `now`. */
  createdAt?: string;
}

export interface MessageNoteDraft {
  title: string;
  body: string;
  sourceType: 'typed';
}

export const MESSAGE_NOTE_TITLE_MAX = 80;
export const MESSAGE_NOTE_CAPTION_PREFIX = 'From Lantern AI';
export const MESSAGE_NOTE_FALLBACK_TITLE = 'Lantern AI answer';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A fixed, locale-free date. `toLocaleDateString` would put a different string
 * in the note body depending on which device filed it, and two students
 * comparing the same saved answer would see two different captions.
 */
function formatCaptionDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Strip the markdown that decorates a first line so the note LIST shows words,
 * not `## **Photosynthesis**`. Only leading furniture goes; the body keeps
 * every character.
 */
function titleFromLine(line: string): string {
  let text = line.trim();
  text = text.replace(/^#{1,6}\s+/, '');
  text = text.replace(/^[-*+]\s+/, '');
  text = text.replace(/^\d+[.)]\s+/, '');
  text = text.replace(/^>\s+/, '');
  // Inline emphasis and code, unwrapped rather than deleted.
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/`(.+?)`/g, '$1');
  // A heading that ends in its own colon reads better without it.
  text = text.replace(/[:：]\s*$/, '');
  return text.trim();
}

function truncateTitle(text: string): string {
  if (text.length <= MESSAGE_NOTE_TITLE_MAX) return text;
  const cut = text.slice(0, MESSAGE_NOTE_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const stem = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:-]+$/, '');
  return `${stem}…`;
}

/**
 * Build the note a chat answer becomes.
 *
 * The BODY is the answer verbatim — a generated deck is only as good as the
 * text it read, and a "cleaned up" body would quietly drop the very lines the
 * student wanted cards from. The caption is appended, not woven in, so the
 * provenance is on the page without editing the answer.
 *
 * The TITLE is the answer's own first line when it has one, the conversation's
 * title when the answer opens with prose too long to be a heading, and a plain
 * fallback when neither exists.
 */
export function messageToNoteDraft(
  message: MessageNoteDraftInput,
  conversationTitle?: string | null,
  now: Date = new Date()
): MessageNoteDraft {
  const content = (message.content || '').replace(/\r\n/g, '\n');
  const trimmedBody = content.trim();

  const firstLine = trimmedBody.split('\n').find((line) => line.trim().length > 0) || '';
  const headingish = titleFromLine(firstLine);
  const conversation = (conversationTitle || '').trim();

  let title: string;
  if (headingish && headingish.length <= MESSAGE_NOTE_TITLE_MAX) {
    title = headingish;
  } else if (conversation) {
    title = truncateTitle(conversation);
  } else if (headingish) {
    title = truncateTitle(headingish);
  } else {
    title = MESSAGE_NOTE_FALLBACK_TITLE;
  }

  const stamp = Number.isFinite(Date.parse(message.createdAt || ''))
    ? new Date(message.createdAt as string)
    : now;
  const caption = `${MESSAGE_NOTE_CAPTION_PREFIX} · ${formatCaptionDate(stamp)}`;

  const body = trimmedBody ? `${trimmedBody}\n\n${caption}` : caption;
  return { title, body, sourceType: 'typed' };
}
