/**
 * The companion's pure logic: what the chat is called, which prompt chips it
 * earns, what "Regenerate" re-asks, and what a keystroke in the composer means.
 *
 * React-free on purpose, the way the phone's twin
 * (`apps/mobile/src/components/companion/companionScope.ts`) is: every rule
 * below is a decision a student can be surprised by, so each one is unit-tested
 * without a renderer. The two files are deliberate twins rather than a shared
 * package — the mobile half also carries route-scope tables that only a
 * navigator has, and web reads its scope from props.
 */
import type { FeatureKey } from '@lantern/shared/design';
import type { AppIconName } from '../ui/appIconMap';

/**
 * The generic pills. The same seven, in the same order, as the phone — this is
 * the list the mobile file was brought up to match, so changing one without the
 * other re-opens the parity gap.
 */
export const QUICK_PROMPTS: readonly string[] = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
  'Build my study plan for this week',
  'How am I spending this month?',
];

export interface QuickPromptChip {
  /** What the chip says AND what it asks — these prompts are already sentences. */
  prompt: string;
  /** The 16 px glyph, drawn in `feature`'s ink. */
  icon: AppIconName;
  /**
   * Whose ink the glyph takes: the INTENT the prompt serves, not `ai` for all
   * seven. A row of identical sparkles is a row you have to read; "quiz me"
   * wearing the tests hue and "how am I spending" wearing the budget hue are
   * findable by colour before they are read.
   */
  feature: FeatureKey;
}

/** The generic pills with their intent glyph, in `QUICK_PROMPTS` order. */
export const QUICK_PROMPT_CHIPS: readonly QuickPromptChip[] = [
  { prompt: QUICK_PROMPTS[0], icon: 'sunny', feature: 'ai' },
  { prompt: QUICK_PROMPTS[1], icon: 'layers', feature: 'flashcards' },
  { prompt: QUICK_PROMPTS[2], icon: 'help-circle', feature: 'tests' },
  { prompt: QUICK_PROMPTS[3], icon: 'bulb', feature: 'ai' },
  { prompt: QUICK_PROMPTS[4], icon: 'repeat', feature: 'flashcards' },
  { prompt: QUICK_PROMPTS[5], icon: 'calendar', feature: 'sets' },
  { prompt: QUICK_PROMPTS[6], icon: 'wallet', feature: 'budget' },
];

/**
 * How many generic pills show before "View more".
 *
 * The drawer is `max-w-sm` — narrower than the phone's 360 dp column once its
 * padding is taken out — so all seven stack into a wall above the composer and
 * bury the scoped chips, which are the better answer.
 */
export const QUICK_PROMPT_PREVIEW_COUNT = 4;

/** The pills to draw, given whether "View more" has been tapped. */
export function visibleQuickPrompts(expanded: boolean): readonly string[] {
  return expanded ? QUICK_PROMPTS : QUICK_PROMPTS.slice(0, QUICK_PROMPT_PREVIEW_COUNT);
}

/**
 * What "I don't understand" sends. One fixed re-ask, so the thread's own
 * context (same conversation id, same attachment) does the narrowing rather
 * than the student having to restate the question.
 */
export const EXPLAIN_SIMPLY_PROMPT = 'Explain that more simply.';

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export interface CompanionConversationLike {
  id: string;
  title?: string | null;
  noteTitle?: string | null;
  preview?: string | null;
}

/** Past-chats search: title, the note it is attached to, and its preview. */
export function filterConversations<T extends CompanionConversationLike>(
  conversations: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...conversations];
  return conversations.filter((c) =>
    [c.title, c.noteTitle, c.preview].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(q)
    )
  );
}

export interface CompanionMessageLike {
  id: string;
  role: string;
  content: string;
}

/**
 * The question an assistant answer was answering — what "Regenerate" re-asks.
 *
 * Walks BACK from the assistant message rather than taking the last user turn
 * in the thread, so regenerating an answer from the middle of a long scroll
 * re-asks the question above IT, not whatever was typed most recently.
 */
export function previousUserMessage(
  messages: readonly CompanionMessageLike[],
  assistantMessageId: string
): string | null {
  const index = messages.findIndex((m) => m.id === assistantMessageId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return clean(messages[i].content);
  }
  return null;
}

/** The longest a derived title gets before it is cut at a word boundary. */
const TITLE_MAX_CHARS = 42;

/** The name a thread gets before the server has named it. */
export const UNTITLED_CHAT_TITLE = 'New chat';

/**
 * The chat's own title: the first thing the student asked.
 *
 * Derived rather than stored, because the header has to show a name from the
 * first keystroke of the first answer — long before the server's conversation
 * row (which is what Past chats lists) exists. Newlines collapse so a pasted
 * paragraph cannot push the header to three lines, and the cut lands on a word
 * boundary so a title never ends mid-word.
 */
export function deriveChatTitle(messages: readonly CompanionMessageLike[]): string {
  const first = messages.find((m) => m.role === 'user' && clean(m.content));
  const text = clean(first?.content)?.replace(/\s+/g, ' ');
  if (!text) return UNTITLED_CHAT_TITLE;
  if (text.length <= TITLE_MAX_CHARS) return text;
  const cut = text.slice(0, TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a word boundary that leaves a real title behind; a first
  // "word" longer than the limit is truncated mid-word rather than erased.
  const body = lastSpace > TITLE_MAX_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

export type ComposerKeyIntent = 'send' | 'newline' | 'ignore';

export interface ComposerKeyEventLike {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /**
   * True while an IME candidate window is open. A CJK or accent composition
   * commits with Enter, and treating that Enter as "send" fires a half-typed
   * question — which is why this is checked before anything else.
   */
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}

/**
 * What a keystroke in the composer means.
 *
 * Enter sends and Shift+Enter opens a line, which is what every chat surface
 * the student already uses does — the panel previously required a mouse trip to
 * the send button for every single question. Extracted from the component so
 * the rule is testable: a jsdom keydown cannot be driven through a real IME,
 * and the browser pane cannot deliver an OS keypress at all.
 */
export function composerKeyIntent(event: ComposerKeyEventLike): ComposerKeyIntent {
  if (event.key !== 'Enter') return 'ignore';
  if (event.isComposing || event.nativeEvent?.isComposing) return 'ignore';
  // Alt/Ctrl/Cmd+Enter are the OS's own "insert a break" gestures in several
  // editors; none of them mean send here.
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return 'newline';
  return 'send';
}
