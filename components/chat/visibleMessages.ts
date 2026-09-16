/**
 * Which messages the conversation actually shows, as two pure functions.
 *
 * Extracted verbatim from the `visibleMessages` / `visibleThreadMessages`
 * memos in `components/ChatWindow.tsx` (lane M8, step 4). ChatWindow still owns
 * the `useMemo`s and their dependency arrays — only the predicate moved — so
 * nothing about when the list recomputes changed.
 *
 * The TEAM-S2 plan named this step `QuestionMessage.tsx`. There is no
 * question or poll RENDERING in ChatWindow to extract: that lives in
 * `components/MessageItem.tsx`. What ChatWindow owns about questions is this
 * filter — the group-only question-visibility mode — so that is what came out,
 * together with the rest of the visibility chain it sits in.
 *
 * Touches: nothing. No React, no state, no I/O — which is the point: the rule
 * about what a student can and cannot see is now testable on its own.
 *
 * Gotchas:
 *  - The filter ORDER is load-bearing and is preserved exactly: archived-out,
 *    then the removed-tombstone policy (a removed message still renders when
 *    something replies to it), then question visibility, then starred-only,
 *    then the in-chat search.
 *  - The question-visibility and archived rules are group-only. Applying them
 *    to a DM would hide half of a marketplace negotiation.
 *  - A search of fewer than two characters is not a filter at all — one
 *    character would hide nearly everything on the first keystroke.
 */
import {
  messagePassesQuestionVisibility,
  shouldRenderRemovedMessage,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';
import type { Message } from '../../types';

export interface VisibleMessagesInput {
  messages: Message[];
  isGroupChat: boolean;
  questionVisibilityMode: QuestionVisibilityMode;
  starredOnly: boolean;
  starredIds: Set<string>;
  /** The in-chat search box. Ignored below two characters. */
  threadSearch: string;
}

/**
 * What the list actually renders, in filter order: archived-out, removed
 * tombstone policy (a removed message still renders when something replies to
 * it), the group question-visibility mode, the starred-only view, then the
 * in-chat search (2+ chars). EVERY scroll and unread computation in ChatWindow
 * works on this array, not on `messages` — the divider must sit at the first
 * unread row the reader can actually see.
 */
export function selectVisibleMessages({
  messages,
  isGroupChat,
  questionVisibilityMode,
  starredOnly,
  starredIds,
  threadSearch,
}: VisibleMessagesInput): Message[] {
  return messages.filter((msg) => {
    if (isGroupChat && msg.isArchived) return false;
    if (!shouldRenderRemovedMessage(msg, messages)) return false;
    if (isGroupChat && !messagePassesQuestionVisibility(msg, questionVisibilityMode)) {
      return false;
    }
    if (starredOnly && !starredIds.has(msg.id)) return false;
    const query = threadSearch.trim().toLowerCase();
    if (query.length >= 2) {
      const hay = `${msg.text || ''} ${msg.questionStem || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

/**
 * The same, for the thread side panel. A thread applies only the two rules that
 * are about the message itself: the star, question and search views belong to
 * the main list, and a thread that hid its own replies would read as broken.
 */
export function selectVisibleThreadMessages(
  threadMessages: Message[],
  isGroupChat: boolean
): Message[] {
  return threadMessages.filter(
    (message) =>
      !(isGroupChat && message.isArchived) &&
      shouldRenderRemovedMessage(message, threadMessages)
  );
}
