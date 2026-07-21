/**
 * Detect accidental / low-signal companion messages so we don't invent
 * random study advice when the user hasn't asked anything meaningful.
 */

export type CompanionMessageClarity =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'low_signal' };

const CONTINUATION_OR_GREETING =
  /^(y|n|yes|no|ok|okay|k|sure|thanks|thank you|ty|thx|yep|yeah|yea|nope|nah|idk|help|hi|hey|hello|yo|pls|please|\d{1,3})$/i;

/** Common short study acronyms / words that are real questions on their own. */
const ALLOWED_SHORT_TOKENS =
  /^(ai|srs|gpa|sat|act|mcat|lsat|gre|faq|tip|tips|plan|quiz|test|cards|notes|budget|groups?)$/i;

function letterCount(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Returns whether the user message is clear enough to answer productively.
 * Short continuations (yes/ok/2) are allowed when there is prior conversation.
 */
export function assessCompanionMessageClarity(
  message: string,
  history: Array<{ role: string; content: string }> = []
): CompanionMessageClarity {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, reason: 'too_short' };

  const hasPriorTurn = history.some((m) => m.role === 'assistant' || m.role === 'user');
  if (CONTINUATION_OR_GREETING.test(trimmed) && (hasPriorTurn || /^(hi|hey|hello|yo|help)$/i.test(trimmed))) {
    return { ok: true };
  }
  if (CONTINUATION_OR_GREETING.test(trimmed) && !hasPriorTurn && /^(y|n|yes|no|ok|okay|k|sure|yep|yeah|yea|nope|nah|\d{1,3})$/i.test(trimmed)) {
    // Bare "yes" / "2" with no prior turn is not actionable.
    return { ok: false, reason: 'low_signal' };
  }
  if (ALLOWED_SHORT_TOKENS.test(trimmed)) return { ok: true };

  const alnum = letterCount(trimmed);

  if (trimmed.length <= 2) {
    return { ok: false, reason: 'too_short' };
  }

  if (alnum.length < 2) {
    return { ok: false, reason: 'low_signal' };
  }

  // Single token of 1–3 letters that isn't an allowed short word (e.g. "t", "asd").
  if (/^[a-z]{1,3}$/i.test(trimmed) && !ALLOWED_SHORT_TOKENS.test(trimmed) && !CONTINUATION_OR_GREETING.test(trimmed)) {
    return { ok: false, reason: 'low_signal' };
  }

  // Short alphabetic mash: no vowels, or very low character diversity.
  if (trimmed.length <= 10 && /^[a-z]+$/i.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    const hasVowel = /[aeiou]/.test(lower);
    const uniqueRatio = new Set(lower).size / lower.length;
    if (!hasVowel || uniqueRatio < 0.35) {
      return { ok: false, reason: 'low_signal' };
    }
  }

  // Repeated character spam ("aaaa", "!!!!!!")
  if (/^(.)\1{2,}$/.test(trimmed) || /^(..)\1{2,}$/.test(trimmed)) {
    return { ok: false, reason: 'low_signal' };
  }

  return { ok: true };
}

export interface ClarifyCompanionOptions {
  userName?: string;
  weakTopics?: string[];
  dueCardsCount?: number;
  currentScreen?: string;
  noteTitle?: string;
}

/**
 * Short clarifying reply grounded in known student context — never invents topics.
 */
export function buildCompanionClarifyReply(options: ClarifyCompanionOptions = {}): string {
  const name = options.userName && options.userName !== 'Student' ? options.userName : null;
  const hello = name ? `${name}, I didn't catch a clear question there.` : `I didn't catch a clear question there.`;

  const optionsList: string[] = [];
  if ((options.dueCardsCount ?? 0) > 0) {
    optionsList.push(`review your ${options.dueCardsCount} due flashcards`);
  }
  if (options.weakTopics && options.weakTopics.length > 0) {
    optionsList.push(`work on ${options.weakTopics.slice(0, 2).join(' or ')}`);
  }
  if (options.noteTitle) {
    optionsList.push(`dig into your note “${options.noteTitle.slice(0, 60)}”`);
  }
  if (options.currentScreen) {
    optionsList.push(`help with what you're doing on ${options.currentScreen}`);
  }

  if (optionsList.length === 0) {
    return `${hello} Tell me what you need — a study tip, flashcards, a quiz, notes help, or a plan — and I'll jump in.`;
  }

  const offered =
    optionsList.length === 1
      ? optionsList[0]
      : `${optionsList.slice(0, -1).join(', ')}, or ${optionsList[optionsList.length - 1]}`;

  return `${hello} Want me to ${offered}? Or type a fuller question and I'll take it from there.`;
}
