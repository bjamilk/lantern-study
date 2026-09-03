export function shuffleArray<T>(items: T[]): T[] {
  return [...items];
}

/**
 * Chat media lives as markdown inside `messages.text`, and the board splits a
 * post into its photo / voice note / body with the SAME parsers the chat uses.
 * Re-exported from the real module rather than restubbed here: a second copy
 * of those regexes is exactly the third encoding convention the spec's trap 6
 * forbids, and a stub would let the two drift silently.
 */
export {
  isChatAudioMessage,
  isChatImageMessage,
  parseChatAudioUrl,
  parseChatImageUrl,
} from '../../../../../packages/shared/src/utils/chatMedia';
