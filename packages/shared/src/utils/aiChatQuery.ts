/**
 * In-chat AI tutor trigger, shared by web's MessageInputBar and mobile's chat
 * composers. Previously the regex was written out separately in each, so the
 * two could drift on what counts as a tutor query.
 *
 * Matches "@AI <question>" and "/ask <question>", case-insensitively, with the
 * question allowed to span lines.
 */
export const AI_QUERY_PATTERN = /^(?:@AI\s+|\/ask\s+)(.+)/is;

/** Prefix applied to the tutor's reply when it is posted back into the chat. */
export const AI_TUTOR_REPLY_PREFIX = '🤖 AI Tutor:';

/**
 * Extract the question from an AI tutor trigger.
 *
 * Returns `null` when the text is an ordinary message, so callers can branch on
 * it directly. A trigger with only whitespace after it is not a query — sending
 * an empty question to the tutor just wastes a request and the user's quota.
 */
export function parseAiQuery(text: string): string | null {
  const match = text.match(AI_QUERY_PATTERN);
  if (!match) return null;
  const question = (match[1] ?? '').trim();
  return question.length > 0 ? question : null;
}

/** Format a tutor answer for posting as a chat message. */
export function formatAiTutorReply(answer: string): string {
  return `${AI_TUTOR_REPLY_PREFIX}\n${answer}`;
}
