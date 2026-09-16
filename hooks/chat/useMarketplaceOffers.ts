/**
 * The marketplace half of a DM: the inquiry this thread belongs to, the offer
 * under negotiation, its history, and the order that an accepted offer creates.
 *
 * A DM that the server says is a marketplace inquiry grows a second application
 * inside `ChatWindow` — a Chat/Offers tab pair with its own money actions. This
 * hook owns that application's ten pieces of state and the two effects that
 * fill them; `components/chat/OffersPanel.tsx` renders them.
 *
 * Touches:
 *  - services/supabase: `getInquiryByThread`, `fetchOffers`, `respondToOffer`,
 *    `updateInquiryStatus`, `fetchOrderForInquiry`.
 *  - `onSendMessage` (the caller's prop) for the fire-and-forget narration line
 *    that leaves a visible trail of each offer action in the conversation.
 *  - `refreshBudgetTransactions` (passed in, NOT called via `useBudgetHandlers`
 *    here: that hook is called by the shell, and calling it from inside this one
 *    would move a hook call and change the shell's hook order).
 *
 * Effect order: this hook is called at exactly the point in `ChatWindow` where
 * its state used to be declared, and there is no other hook call between that
 * point and the two effects it now carries. Its effects therefore still run in
 * the same position relative to every other effect in the shell — after the
 * chat-reset, typing, chat-read and thread effects, and before the scroll and
 * unread effects. Nothing else in the component reads offer/order state from an
 * effect, so no ordering pair was even at risk.
 *
 * Gotchas:
 *  - `loadOfferHistory` fetches for the viewer's ROLE and narrows client-side;
 *    the "active" offer is the newest still-pending one, everything else is
 *    history. Both facts are load-bearing for the turn-based Accept/Decline UI.
 *  - the accept path can navigate away (Paystack) and returns early. Anything
 *    added after that branch will not run for a buyer.
 */
import { useEffect, useState } from 'react';
import {
  getInquiryByThread,
  fetchOffers,
  respondToOffer,
  updateInquiryStatus,
  fetchOrderForInquiry,
} from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import type { SendMessageOptions } from '../../components/MessageInputBar';
import type {
  ChatItem,
  MarketplaceInquiry,
  MarketplaceOffer,
  MarketplaceOrder,
  User,
} from '../../types';

interface UseMarketplaceOffersOptions {
  chat: ChatItem | null;
  currentUser: User;
  /** The shell's `onSendMessage` prop — used only for narration lines. */
  onSendMessage: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  /** From the shell's `useBudgetHandlers()`; see the effect-order note above. */
  refreshBudgetTransactions: (userId: string) => void | Promise<unknown>;
}

export function useMarketplaceOffers({
  chat,
  currentUser,
  onSendMessage,
  refreshBudgetTransactions,
}: UseMarketplaceOffersOptions) {
  // Marketplace Inquiry & Offers states
  const [inquiry, setInquiry] = useState<MarketplaceInquiry | null>(null);
  const [activeOffer, setActiveOffer] = useState<MarketplaceOffer | null>(null);
  const [offerHistory, setOfferHistory] = useState<MarketplaceOffer[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'offers'>('chat');
  const [showMakeOfferModal, setShowMakeOfferModal] = useState(false);
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [counterValue, setCounterValue] = useState('');
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState('');
  const [activeOrder, setActiveOrder] = useState<MarketplaceOrder | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState(false);

  // --- Marketplace negotiation. Offers are fetched for the viewer's ROLE and
  // then narrowed to this listing/pair client-side; the "active" offer is the
  // newest still-pending one, everything else is history.
  const loadOfferHistory = async (inquiryData: MarketplaceInquiry) => {
    try {
      const role = currentUser.id === inquiryData.buyer_id ? 'buyer' : 'seller';
      const offers = await fetchOffers(role);
      const filtered = offers.filter(
        (o: MarketplaceOffer) =>
          o.listing_id === inquiryData.listing_id &&
          (o.buyer_id === inquiryData.buyer_id || o.seller_id === inquiryData.seller_id)
      );
      // History oldest → newest; active offer is latest pending only
      filtered.sort(
        (a: MarketplaceOffer, b: MarketplaceOffer) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setOfferHistory(filtered);

      const pending = filtered.filter((o: MarketplaceOffer) => o.status === 'pending');
      const active = pending.length > 0 ? pending[pending.length - 1] : null;
      setActiveOffer(active);
    } catch (err) {
      console.error('Error loading offer history:', err);
    }
  };

  // Accept / decline / counter / withdraw. Order of effects matters:
  //  1. the server call (money side),
  //  2. a plain chat message so the negotiation leaves a visible trail — fired
  //     without awaiting, and a failure here is logged only: a lost narration
  //     line must never look like a failed offer response,
  //  3. accept-as-buyer leaves the app for Paystack and returns early; every
  //     other path re-reads the inquiry from the server rather than assuming a
  //     status (forcing 'negotiating' once left the pill amber over a live order).
  const handleRespond = async (action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
    if (!activeOffer || !inquiry) return;
    setOfferLoading(true);
    setOfferError('');
    try {
      const acceptResult = await respondToOffer(activeOffer.id, action, counterAmount);
      
      // Send DM notification for visual history
      let dmContent = '';
      if (action === 'accept') {
        const payUrl =
          (acceptResult as { authorizationUrl?: string })?.authorizationUrl ||
          (acceptResult as { checkout?: { authorizationUrl?: string } })?.checkout?.authorizationUrl;
        dmContent = payUrl
          ? `[Offer] I accepted your offer of ₦${activeOffer.amount.toLocaleString()}! Complete Paystack checkout to pay — you pay the offer amount, nothing added.`
          : `[Offer] I accepted your offer of ₦${activeOffer.amount.toLocaleString()}! An order has been created — arrange pickup or delivery in Orders.`;
      } else if (action === 'decline') {
        dmContent = `[Offer] I declined the offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'withdraw') {
        dmContent = `[Offer] I withdrew my offer of ₦${activeOffer.amount.toLocaleString()}.`;
      } else if (action === 'counter' && counterAmount) {
        dmContent = `[Offer] I countered your offer with a counter-offer of ₦${counterAmount.toLocaleString()}.`;
      }

      if (dmContent) {
        // FIXED (F1): `onSendMessage` may return a promise, and a bare try/catch
        // cannot see its rejection — a failed narration message escaped as an
        // unhandled rejection. It now goes through Promise.resolve().catch, which
        // also matters because onSendMessage REJECTS on a busy send lock since
        // E3 H16 (see MessageSendBusyError in hooks/useGroupHandlers). This is a
        // fire-and-forget narration line: log it, never surface it.
        void Promise.resolve()
          .then(() => onSendMessage(dmContent))
          .catch((msgErr) => {
            console.error('Failed to send status update message to chat:', msgErr);
          });
      }

      if (action === 'accept') {
        const payUrl =
          (acceptResult as { authorizationUrl?: string })?.authorizationUrl ||
          (acceptResult as { checkout?: { authorizationUrl?: string } })?.checkout?.authorizationUrl;
        const isBuyer = currentUser?.id === activeOffer.buyer_id;
        if (payUrl && isBuyer) {
          window.location.assign(payUrl);
          return;
        }
        try {
          // The server sets the inquiry status when an offer is accepted; re-fetch it
          // as the source of truth instead of forcing 'negotiating' (which left the
          // status pill stuck on amber even though a live order already existed).
          const refreshedInquiry = await getInquiryByThread(chat.id);
          if (refreshedInquiry) setInquiry(refreshedInquiry);
          const order = await fetchOrderForInquiry(inquiry.id);
          if (order) setActiveOrder(order);
          await refreshBudgetTransactions(currentUser.id);
          if (payUrl && !isBuyer) {
            useToastStore.getState().showToast(
              'Offer accepted. The buyer will complete Paystack checkout.',
              'info'
            );
          }
        } catch (err) {
          console.error('Failed to load order after offer acceptance:', err);
        }
      } else if (action === 'counter') {
        try {
          await updateInquiryStatus(inquiry.id, 'negotiating');
          const updated = await getInquiryByThread(chat.id);
          if (updated) setInquiry(updated);
        } catch (err) {
          console.error('Failed to update inquiry status to negotiating:', err);
        }
      }

      await loadOfferHistory(inquiry);
      setShowCounterInput(false);
    } catch (err: any) {
      setOfferError(err.message || `Failed to ${action} offer`);
    } finally {
      setOfferLoading(false);
    }
  };

  // Reset offer/order UI only when the conversation itself changes.
  useEffect(() => {
    setActiveTab('chat');
    setInquiry(null);
    setActiveOffer(null);
    setOfferHistory([]);
    setShowCounterInput(false);
    setCounterValue('');
    setOfferError('');
    setActiveOrder(null);
  }, [chat?.id]);

  // Resolve marketplace inquiry context durably: ask the server whether THIS thread
  // is an inquiry (source of truth) rather than substring-matching a fragile "[Offer]"
  // marker in message text, which false-negatives on seed drift and false-positives on
  // a literally typed "[Offer]". Depends only on the chat id, so it never re-fires on an
  // unrelated parent re-render (which used to bounce the user off the Offers tab).
  useEffect(() => {
    if (!chat || chat.chatType !== 'dm') return;
    let cancelled = false;
    const loadInquiryContext = async () => {
      try {
        const inquiryData = await getInquiryByThread(chat.id);
        if (cancelled) return;
        if (inquiryData) {
          setInquiry(inquiryData);
          await loadOfferHistory(inquiryData);
          if (cancelled) return;
          const order = await fetchOrderForInquiry(inquiryData.id);
          if (!cancelled && order) setActiveOrder(order);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading inquiry context:', err);
        }
      }
    };
    void loadInquiryContext();
    return () => { cancelled = true; };
  }, [chat?.id, chat?.chatType]);

  return {
    inquiry,
    setInquiry,
    activeOffer,
    offerHistory,
    activeTab,
    setActiveTab,
    showMakeOfferModal,
    setShowMakeOfferModal,
    showCounterInput,
    setShowCounterInput,
    counterValue,
    setCounterValue,
    offerLoading,
    offerError,
    activeOrder,
    setActiveOrder,
    orderActionLoading,
    setOrderActionLoading,
    loadOfferHistory,
    handleRespond,
  };
}

export type MarketplaceOffersApi = ReturnType<typeof useMarketplaceOffers>;
