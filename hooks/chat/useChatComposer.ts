/**
 * The two composers — the main one and the thread one — and everything they
 * hold between keystrokes: what is being replied to, what is being edited, and
 * the username a tapped author name seeds into the box.
 *
 * Extracted verbatim from `components/ChatWindow.tsx` (lane M8, step 6). Six
 * pieces of state and four handlers moved; NO effect did, which is why this
 * hook can be called exactly where the state it owns used to be declared and
 * nothing about effect order changed.
 *
 * Touches: `toastStore` for the result of an edit or a removal, and
 * `confirmStore.confirmDialog` for the removal prompt. Sending and editing
 * themselves are the shell's callbacks (`onSendMessage` / `onEditMessage` /
 * `onRemoveMessage`), because the optimistic row and its failure handling
 * belong to the app shell, not here.
 *
 * Gotchas:
 *  - `handleThreadSend`'s `|| threadRootId` fallback is what guarantees a
 *    thread reply never escapes into the main conversation. Removing it makes
 *    replies silently appear in the wrong place.
 *  - The main and thread composers keep SEPARATE reply, edit and mention-seed
 *    state on purpose: tapping an author's name must seed only the composer the
 *    reader can see.
 *  - Starting an edit clears the reply, and starting a reply clears the edit —
 *    one composer cannot be doing both, and the submit button reads
 *    `editingMessage` to decide which it is.
 *  - `loadThread` is passed in rather than owned: the thread's messages are
 *    message-list state and stayed in ChatWindow.
 */
import { useState } from 'react';
import { confirmDialog } from '../../stores/confirmStore';
import { useToastStore } from '../../stores/toastStore';
import type { SendMessageOptions } from '../../components/MessageInputBar';
import type { Message, MessageReplyPreview } from '../../types';

export interface UseChatComposerParams {
  /** The shell's send: owns the optimistic row and its failure handling. */
  onSendMessage: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  onEditMessage: (messageId: string, content: string) => Promise<unknown>;
  onRemoveMessage: (messageId: string) => Promise<unknown>;
  /** The open thread, or null. Owned by ChatWindow. */
  threadRootId: string | null;
  /** Refreshes the thread panel after a send, edit or removal inside it. */
  loadThread: (rootId: string) => Promise<void> | void;
}

export interface ChatComposer {
  replyTo: MessageReplyPreview | null;
  setReplyTo: React.Dispatch<React.SetStateAction<MessageReplyPreview | null>>;
  seedMentionUsername: string | null;
  setSeedMentionUsername: React.Dispatch<React.SetStateAction<string | null>>;
  editingMessage: { id: string; text: string } | null;
  setEditingMessage: React.Dispatch<React.SetStateAction<{ id: string; text: string } | null>>;
  threadReplyTo: MessageReplyPreview | null;
  setThreadReplyTo: React.Dispatch<React.SetStateAction<MessageReplyPreview | null>>;
  threadEditingMessage: { id: string; text: string } | null;
  setThreadEditingMessage: React.Dispatch<
    React.SetStateAction<{ id: string; text: string } | null>
  >;
  threadSeedMentionUsername: string | null;
  setThreadSeedMentionUsername: React.Dispatch<React.SetStateAction<string | null>>;
  handleComposerSend: (text: string, options?: SendMessageOptions) => Promise<void>;
  handleThreadSend: (text: string, options?: SendMessageOptions) => Promise<void>;
  beginEditingMessage: (message: Message, inThread?: boolean) => void;
  handleRemoveMessage: (message: Message, inThread?: boolean) => Promise<void>;
}

export function useChatComposer({
  onSendMessage,
  onEditMessage,
  onRemoveMessage,
  threadRootId,
  loadThread,
}: UseChatComposerParams): ChatComposer {
  const [replyTo, setReplyTo] = useState<MessageReplyPreview | null>(null);
  const [seedMentionUsername, setSeedMentionUsername] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [threadReplyTo, setThreadReplyTo] = useState<MessageReplyPreview | null>(null);
  const [threadEditingMessage, setThreadEditingMessage] = useState<{ id: string; text: string } | null>(null);
  // Separate mention seed for the thread composer so tapping an author's name
  // seeds only the visible composer (main vs thread), not both at once.
  const [threadSeedMentionUsername, setThreadSeedMentionUsername] = useState<string | null>(null);

  // One composer serves both send and edit: an active `editingMessage` turns the
  // submit into an edit. The optimistic message row and its failure handling
  // belong to `onSendMessage` in the shell, not to this component.
  const handleComposerSend = async (text: string, options?: SendMessageOptions) => {
    if (!editingMessage) {
      await onSendMessage(text, options);
      return;
    }
    await onEditMessage(editingMessage.id, text);
    useToastStore.getState().showToast('Message updated', 'success');
    if (threadRootId) void loadThread(threadRootId);
  };

  const handleThreadSend = async (text: string, options?: SendMessageOptions) => {
    if (threadEditingMessage) {
      await onEditMessage(threadEditingMessage.id, text);
      useToastStore.getState().showToast('Message updated', 'success');
      if (threadRootId) await loadThread(threadRootId);
      return;
    }
    // Reply target, most specific first. The `|| threadRootId` fallback is what
    // guarantees a thread reply never escapes into the main conversation.
    const replyId = options?.replyToMessageId || threadReplyTo?.id || threadRootId || undefined;
    await onSendMessage(text, { ...options, replyToMessageId: replyId });
    if (threadRootId) {
      // Brief delay so the new message is queryable, then refresh panel + bump feed counts
      window.setTimeout(() => void loadThread(threadRootId), 350);
    }
  };

  const beginEditingMessage = (message: Message, inThread = false) => {
    if (!message.text) return;
    if (inThread) {
      setThreadReplyTo(null);
      setThreadEditingMessage({ id: message.id, text: message.text });
      return;
    }
    setReplyTo(null);
    setEditingMessage({ id: message.id, text: message.text });
  };

  const handleRemoveMessage = async (message: Message, inThread = false) => {
    const confirmed = await confirmDialog({
      title: 'Remove message?',
      message:
        'This will remove the message for everyone. It cannot be restored in chat, but an audit record will be retained.',
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    try {
      await onRemoveMessage(message.id);
      if (editingMessage?.id === message.id) setEditingMessage(null);
      if (threadEditingMessage?.id === message.id) setThreadEditingMessage(null);
      if (inThread && threadRootId) await loadThread(threadRootId);
      useToastStore.getState().showToast('Message removed', 'success');
    } catch (error) {
      useToastStore.getState().showToast(
        error instanceof Error ? error.message : 'Could not remove message',
        'error'
      );
    }
  };

  return {
    replyTo,
    setReplyTo,
    seedMentionUsername,
    setSeedMentionUsername,
    editingMessage,
    setEditingMessage,
    threadReplyTo,
    setThreadReplyTo,
    threadEditingMessage,
    setThreadEditingMessage,
    threadSeedMentionUsername,
    setThreadSeedMentionUsername,
    handleComposerSend,
    handleThreadSend,
    beginEditingMessage,
    handleRemoveMessage,
  };
}
