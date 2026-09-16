/**
 * The viewer's relationship with the other side of a conversation: whether the
 * DM is still a message REQUEST, whether either party has blocked the other,
 * and whether notifications are muted.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 5). Three
 * server-backed facts, three effects that load them, and the five actions that
 * change them; the header menu and the composer both read the result, which is
 * why it did not belong to either of them.
 *
 * Touches: services/supabase — `acceptDmMessageRequest`,
 * `declineDmMessageRequest`, `getDmBlockStatus`, `blockUser`, `unblockUser`,
 * `getDmMuteStatus` / `getGroupMuteStatus`, `muteDmThread` / `muteGroupChat`,
 * `unmuteDmThread` / `unmuteGroupChat` — plus `confirmStore.confirmDialog` and
 * `toastStore`.
 *
 * Effect order: the hook is called at exactly the point in the shell where
 * `dmThreadForHooks` was declared, and no other hook call sat between there and
 * the three effects it carries, so all three keep their position in the shell's
 * effect order.
 *
 * Gotchas:
 *  - mute is NOT DM-only. A group chat mutes through a different pair of
 *    endpoints, chosen by `isGroup`; both are here so the header menu has one
 *    thing to call.
 *  - `handleToggleDmBlock` takes the peer's display NAME as an argument rather
 *    than deriving it. The shell computes that name after its `if (!chat)`
 *    early return, which is below every hook call — so it is passed at the call
 *    site instead. Only the confirmation copy uses it.
 *  - blocking is confirmed, unblocking is not: an accidental unblock is
 *    recoverable, an accidental block is not visible to the person it hits.
 */
import { useEffect, useState } from 'react';
import {
  acceptDmMessageRequest,
  declineDmMessageRequest,
  getDmBlockStatus,
  blockUser,
  unblockUser,
  getDmMuteStatus,
  muteDmThread,
  unmuteDmThread,
  getGroupMuteStatus,
  muteGroupChat,
  unmuteGroupChat,
} from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import { confirmDialog } from '../../stores/confirmStore';
import { formatMuteUntilLabel, type ChatMuteDurationId } from '@lantern/shared';
import type { ChatItem, DMThread, User } from '../../types';

interface UseDmRelationshipOptions {
  chat: ChatItem | null;
  currentUser: User;
  isGroup: boolean;
  /** Told when an accept or a decline changes the thread's status. */
  onDmThreadStatusChange?: (
    threadId: string,
    patch: { status: 'open' | 'declined'; requestedBy: string | null }
  ) => void;
}

export function useDmRelationship({
  chat,
  currentUser,
  isGroup,
  onDmThreadStatusChange,
}: UseDmRelationshipOptions) {

  const dmThreadForHooks =
    chat && chat.chatType !== 'group' ? (chat as DMThread & { chatType?: 'dm' }) : null;
  const [dmRequestStatus, setDmRequestStatus] = useState<'open' | 'pending' | 'declined'>('open');
  const [dmRequestBusy, setDmRequestBusy] = useState(false);
  const [dmBlocked, setDmBlocked] = useState(false);
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [dmBlockBusy, setDmBlockBusy] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);

  const dmPeerId =
    dmThreadForHooks && Array.isArray(dmThreadForHooks.participantIds)
      ? dmThreadForHooks.participantIds.find((id) => id !== currentUser.id)
      : undefined;

  useEffect(() => {
    setDmRequestStatus(dmThreadForHooks?.status || 'open');
  }, [dmThreadForHooks?.id, dmThreadForHooks?.status]);

  useEffect(() => {
    let cancelled = false;
    if (!dmPeerId || isGroup || !chat) {
      setDmBlocked(false);
      setIBlockedThem(false);
      return;
    }
    void getDmBlockStatus(currentUser.id, dmPeerId)
      .then((status) => {
        if (cancelled) return;
        setDmBlocked(!!status.blocked);
        setIBlockedThem(!!status.iBlockedThem);
      })
      .catch(() => {
        if (cancelled) return;
        setDmBlocked(false);
        setIBlockedThem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, dmPeerId, isGroup, chat?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!chat) {
      setChatMuted(false);
      setChatMutedUntil(null);
      return;
    }
    const load = isGroup
      ? getGroupMuteStatus(chat.id)
      : getDmMuteStatus(chat.id);
    void load
      .then((status) => {
        if (cancelled) return;
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setChatMuted(false);
        setChatMutedUntil(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chat?.id, isGroup]);

  const handleMuteFor = async (duration: ChatMuteDurationId) => {
    if (!chat || muteBusy) return;
    setMuteBusy(true);
    try {
      const status = isGroup
        ? await muteGroupChat(chat.id, duration)
        : await muteDmThread(chat.id, duration);
      if (!status?.muted) {
        useToastStore.getState().showToast('Could not mute notifications.', 'error');
        return;
      }
      setChatMuted(true);
      setChatMutedUntil(status.mutedUntil);
      const untilLabel = formatMuteUntilLabel(status.mutedUntil);
      useToastStore.getState().showToast(
        untilLabel ? `Notifications muted until ${untilLabel}.` : 'Notifications muted.',
        'success'
      );
    } finally {
      setMuteBusy(false);
    }
  };

  const handleUnmute = async () => {
    if (!chat || muteBusy) return;
    setMuteBusy(true);
    try {
      const status = isGroup
        ? await unmuteGroupChat(chat.id)
        : await unmuteDmThread(chat.id);
      if (!status || status.muted) {
        useToastStore.getState().showToast('Could not unmute notifications.', 'error');
        return;
      }
      setChatMuted(false);
      setChatMutedUntil(null);
      useToastStore.getState().showToast('Notifications unmuted.', 'success');
    } finally {
      setMuteBusy(false);
    }
  };

  const muteUntilLabel = formatMuteUntilLabel(chatMutedUntil);

  const handleAcceptDmRequest = async () => {
    if (!dmThreadForHooks?.id || dmRequestBusy) return;
    setDmRequestBusy(true);
    try {
      await acceptDmMessageRequest(dmThreadForHooks.id);
      setDmRequestStatus('open');
      onDmThreadStatusChange?.(dmThreadForHooks.id, { status: 'open', requestedBy: null });
      useToastStore.getState().showToast('Message request accepted', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not accept request', 'error');
    } finally {
      setDmRequestBusy(false);
    }
  };

  const handleDeclineDmRequest = async () => {
    if (!dmThreadForHooks?.id || dmRequestBusy) return;
    setDmRequestBusy(true);
    try {
      await declineDmMessageRequest(dmThreadForHooks.id);
      setDmRequestStatus('declined');
      onDmThreadStatusChange?.(dmThreadForHooks.id, {
        status: 'declined',
        requestedBy: dmThreadForHooks.requestedBy ?? null,
      });
      useToastStore.getState().showToast('Message request declined', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not decline request', 'error');
    } finally {
      setDmRequestBusy(false);
    }
  };

  const handleToggleDmBlock = async (peerName: string) => {
    if (!dmPeerId || dmBlockBusy) return;
    if (!iBlockedThem) {
      const ok = await confirmDialog({
        title: 'Block user',
        message: `Block ${peerName}? They won’t be able to message you, and you won’t be able to message them until you unblock.`,
        confirmLabel: 'Block',
        danger: true,
      });
      if (!ok) return;
    }
    setDmBlockBusy(true);
    try {
      if (iBlockedThem) {
        await unblockUser(currentUser.id, dmPeerId);
        setIBlockedThem(false);
        const status = await getDmBlockStatus(currentUser.id, dmPeerId);
        setDmBlocked(!!status.blocked);
        useToastStore.getState().showToast('User unblocked', 'success');
      } else {
        await blockUser(currentUser.id, dmPeerId);
        setIBlockedThem(true);
        setDmBlocked(true);
        useToastStore.getState().showToast('User blocked', 'success');
      }
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not update block', 'error');
    } finally {
      setDmBlockBusy(false);
    }
  };

  return {
    /** The open conversation as a DM thread, or null for a group. */
    dmThread: dmThreadForHooks,
    dmPeerId,
    dmRequestStatus,
    dmRequestBusy,
    dmBlocked,
    iBlockedThem,
    dmBlockBusy,
    chatMuted,
    muteBusy,
    muteUntilLabel,
    handleMuteFor,
    handleUnmute,
    handleAcceptDmRequest,
    handleDeclineDmRequest,
    handleToggleDmBlock,
  };
}
