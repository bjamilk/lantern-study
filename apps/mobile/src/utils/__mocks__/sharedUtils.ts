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

/**
 * Same reasoning as the parsers above: "Member" is the literal a reader sees
 * when nothing identifies a sender, so a stub that returned something else
 * would let a test pass while the app showed the wrong label.
 */
export { formatChatSenderLabel } from '../../../../../packages/shared/src/utils/displayNames';

/**
 * Peer-verification rule + the one copy object the question card shows.
 * Re-exported, not restubbed: QuestionVoteBar imports these from
 * `@lantern/shared/utils`, and a stub would let the card's copy drift from the
 * server's 409 body while a test still passed.
 */
export {
  canVerifyQuestion,
  countPeerUpvotes,
  peerUpvotesRemaining,
  QUESTION_VERIFY_COPY,
  VERIFY_PEER_UPVOTES,
} from '../../../../../packages/shared/src/utils/questionVerification';
