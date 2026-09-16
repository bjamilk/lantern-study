/**
 * The Offers tab: everything a DM grows once the server says its thread is a
 * marketplace inquiry — the listing strip with the Chat/Offers tabs, the sticky
 * deal bar, the order bar, and the Offers panel itself (listing card, active
 * offer with its turn-based actions, and the negotiation history).
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b). The conversation
 * itself is NOT duplicated here: the shell passes it in as `chatPanel`, which is
 * the same node it renders bare for a non-marketplace conversation, so the two
 * can never drift apart.
 *
 * Touches:
 *  - `hooks/chat/useMarketplaceOffers.ts` for every piece of state and both
 *    money handlers; this file holds no state of its own.
 *  - services/supabase: `updateMarketplaceOrder` and
 *    `resumeMarketplaceOrderCheckout`, called by the order bar's buttons.
 *  - `@lantern/shared/utils`: `canRespondToOffer` / `canWithdrawOffer` /
 *    `getOfferProposedBy` decide whose turn it is, so web and mobile cannot
 *    disagree about it.
 *
 * Gotchas:
 *  - the deal bar is hidden once an order exists — the order bar owns those
 *    states — so the two can never offer contradictory actions.
 *  - `OrderBar` and `NoActiveOffer` return from their own guards rather than
 *    being guarded by the caller. Those are the same conditions the inline JSX
 *    used; they live inside the component only so the caller stays flat.
 *  - the sub-components below are split by JSX depth, not by concern: the
 *    inline version nested 12 deep and every piece here stays at 6 or less.
 */
import React from 'react';
import { Tabs, TabList, Tab, TabPanel } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { normalizeStorageUrl } from '../../utils/storageUrl';
import {
  canRespondToOffer,
  canWithdrawOffer,
  getOfferProposedBy,
} from '@lantern/shared/utils';
import {
  updateMarketplaceOrder,
  resumeMarketplaceOrderCheckout,
} from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import type {
  MarketplaceInquiry,
  MarketplaceOffer,
  MarketplaceOrder,
  User,
} from '../../types';

/** Accept / decline / counter / withdraw, from `useMarketplaceOffers`. */
type RespondFn = (
  action: 'accept' | 'decline' | 'counter' | 'withdraw',
  counterAmount?: number
) => Promise<void> | void;

type TabValue = 'chat' | 'offers';


/** The listing summary that doubles as the Chat/Offers tab bar. */
const InquiryStrip: React.FC<{
  inquiry: MarketplaceInquiry;
  activeOffer: MarketplaceOffer | null;
}> = ({ inquiry, activeOffer }) => (
  <div className="flex-shrink-0 bg-lantern-surface border-b border-lantern-border px-4 py-3 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3 min-w-0">
      {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
        <img
          src={normalizeStorageUrl(inquiry.listing.images[0])}
          alt={inquiry.listing.title}
          className="w-12 h-12 rounded-lg object-cover bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex-shrink-0 border border-lantern-border"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center flex-shrink-0 border border-lantern-border">
          <AppIcon name="bag" size={24} className="text-lantern-text-tertiary" />
        </div>
      )}
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-lantern-text truncate leading-snug">
          {inquiry.listing?.title}
        </h4>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-sm font-bold text-lantern-primary">
            {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
          </span>
          <span className={`text-label tracking-normal font-semibold px-2 py-0.5 rounded-full capitalize ${
            inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
            inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
            inquiry.status === 'closed' ? 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary' :
            'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light'
          }`}>
            {inquiry.status}
          </span>
        </div>
      </div>
    </div>
    <TabList className="bg-lantern-background p-0.5 rounded-lg border border-lantern-border !border-solid">
      <Tab value="chat" index={0} className="!text-xs !font-semibold !px-3 !py-2 !rounded-md">
        Chat
      </Tab>
      <Tab
        value="offers"
        index={1}
        className="!text-xs !font-semibold !px-3 !py-2 !rounded-md"
        badge={activeOffer ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> : undefined}
      >
        Offers
      </Tab>
    </TabList>
  </div>
);


/* Sticky deal bar — surfaces the ONE primary action in the chat view so a
   buyer/seller never has to hunt in the Offers tab. Hidden once an order
   exists (the order bar below drives those states). */
const DealBar: React.FC<{
  inquiry: MarketplaceInquiry;
  activeOffer: MarketplaceOffer | null;
  currentUser: User;
  offerLoading: boolean;
  activeTab: TabValue;
  setActiveTab: (value: TabValue) => void;
  setShowMakeOfferModal: (value: boolean) => void;
  handleRespond: RespondFn;
}> = ({
  inquiry,
  activeOffer,
  currentUser,
  offerLoading,
  activeTab,
  setActiveTab,
  setShowMakeOfferModal,
  handleRespond,
}) => {
  const pending = activeOffer && activeOffer.status === 'pending' ? activeOffer : null;
  const canRespond = pending ? canRespondToOffer(pending, currentUser.id) : false;
  const canWithdraw = pending ? canWithdrawOffer(pending, currentUser.id) : false;
  const isBuyer = currentUser.id === inquiry.buyer_id;
  if (inquiry.status === 'purchased' || inquiry.status === 'closed') return null;
  return (
    <div className="flex-shrink-0 px-4 py-2.5 bg-lantern-surface border-b border-lantern-border flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {pending ? (
        <>
          <span className="text-xs font-semibold text-lantern-text">
            {getOfferProposedBy(pending) === 'seller' ? 'Counter-offer' : 'Offer'}: ₦{pending.amount.toLocaleString()}
          </span>
          {canRespond ? (
            <div className="flex items-center gap-1.5">
              <button type="button" disabled={offerLoading} onClick={() => void handleRespond('accept')} className="text-xs font-semibold px-3 py-1.5 rounded-lantern bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Accept</button>
              <button type="button" disabled={offerLoading} onClick={() => void handleRespond('decline')} className="text-xs font-semibold px-3 py-1.5 rounded-lantern border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-50">Decline</button>
              <button type="button" onClick={() => setActiveTab('offers')} className="text-xs font-medium px-2 py-1.5 text-lantern-primary hover:underline">Counter</button>
            </div>
          ) : canWithdraw ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-lantern-text-secondary">Waiting for a response</span>
              <button type="button" disabled={offerLoading} onClick={() => void handleRespond('withdraw')} className="text-xs font-medium px-2 py-1.5 text-lantern-text-secondary hover:text-red-600 hover:underline disabled:opacity-50">Withdraw</button>
            </div>
          ) : (
            <span className="text-xs text-lantern-text-secondary">Awaiting a response</span>
          )}
        </>
      ) : isBuyer ? (
        <>
          <span className="text-xs text-lantern-text-secondary">No active offer.</span>
          <button type="button" onClick={() => setShowMakeOfferModal(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lantern bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5">
            <AppIcon name="currency" size={14} /> Make an offer
          </button>
        </>
      ) : (
        <span className="text-xs text-lantern-text-secondary">Waiting for the buyer to make an offer.</span>
      )}
      <button type="button" onClick={() => setActiveTab(activeTab === 'offers' ? 'chat' : 'offers')} className="ml-auto text-[11px] font-medium text-lantern-primary hover:underline">
        {activeTab === 'offers' ? 'View chat' : 'View details'}
      </button>
      <span className="basis-full text-label tracking-normal text-lantern-text-tertiary">Paystack-protected · you pay the listed price</span>
    </div>
  );
};


/** The live-order strip. Its own guard, verbatim from the inline condition. */
const OrderBar: React.FC<{
  inquiry: MarketplaceInquiry;
  activeOrder: MarketplaceOrder | null;
  currentUser: User;
  orderActionLoading: boolean;
  setOrderActionLoading: (value: boolean) => void;
  setActiveOrder: (order: MarketplaceOrder) => void;
}> = ({
  inquiry,
  activeOrder,
  currentUser,
  orderActionLoading,
  setOrderActionLoading,
  setActiveOrder,
}) => {
  if (!activeOrder || activeOrder.status === 'completed' || activeOrder.status === 'cancelled') {
    return null;
  }
  return (
    <div className="flex-shrink-0 px-4 py-2 bg-lantern-primary-background dark:bg-lantern-primary-background border-b border-lantern-primary/20 dark:border-lantern-primary/30 flex flex-wrap gap-2 items-center">
      <span className="text-xs font-medium text-lantern-primary-dark dark:text-lantern-primary-light">
        Order: {activeOrder.status.replace(/_/g, ' ')} · ₦{Number(activeOrder.amount).toLocaleString()}
      </span>
      {currentUser.id === inquiry.seller_id && activeOrder.status === 'paid' && (
        <button
          type="button"
          disabled={orderActionLoading}
          className="text-xs px-2 py-1 rounded-md bg-lantern-primary text-white disabled:opacity-50"
          onClick={async () => {
            setOrderActionLoading(true);
            try {
              const updated = await updateMarketplaceOrder(activeOrder.id, { action: 'mark_ready' });
              setActiveOrder(updated);
            } catch (e: any) { useToastStore.getState().showToast(e.message || 'Something went wrong', 'error'); }
            finally { setOrderActionLoading(false); }
          }}
        >
          Mark ready
        </button>
      )}
      {currentUser.id === inquiry.seller_id && ['pending_payment', 'awaiting_payment'].includes(activeOrder.status) && (
        <span className="text-xs text-lantern-text-secondary">Awaiting buyer payment</span>
      )}
      {currentUser.id === inquiry.buyer_id && ['pending_payment', 'awaiting_payment'].includes(activeOrder.status) && (
        <button
          type="button"
          disabled={orderActionLoading}
          className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white disabled:opacity-50"
          onClick={async () => {
            setOrderActionLoading(true);
            try {
              // Resume the Paystack checkout for an unpaid order (buyers pay in-app).
              const res = await resumeMarketplaceOrderCheckout(activeOrder.id);
              if (res?.authorizationUrl) {
                window.location.assign(res.authorizationUrl);
                return;
              }
              useToastStore.getState().showToast('Could not start checkout. Please try again.', 'error');
            } catch (e: any) { useToastStore.getState().showToast(e.message || 'Could not start checkout', 'error'); }
            finally { setOrderActionLoading(false); }
          }}
        >
          Pay now · ₦{Number(activeOrder.amount).toLocaleString()}
        </button>
      )}
      {currentUser.id === inquiry.buyer_id && ['paid', 'ready_for_pickup'].includes(activeOrder.status) && (
        <button
          type="button"
          disabled={orderActionLoading}
          className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white"
          onClick={async () => {
            setOrderActionLoading(true);
            try {
              const updated = await updateMarketplaceOrder(activeOrder.id, { action: 'confirm_received' });
              setActiveOrder(updated);
            } catch (e: any) { useToastStore.getState().showToast(e.message || 'Something went wrong', 'error'); }
            finally { setOrderActionLoading(false); }
          }}
        >
          Confirm received
        </button>
      )}
    </div>
  );
};


/** Listing Card */
const ListingCard: React.FC<{ inquiry: MarketplaceInquiry }> = ({ inquiry }) => (
<div className="bg-lantern-surface rounded-2xl p-4 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm flex flex-col sm:flex-row gap-4 mb-6">
  {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
    <img
      src={normalizeStorageUrl(inquiry.listing.images[0])}
      alt={inquiry.listing.title}
      className="w-full sm:w-32 h-32 rounded-xl object-cover bg-lantern-background-secondary dark:bg-lantern-surface-secondary border border-lantern-border flex-shrink-0"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  ) : (
    <div className="w-full sm:w-32 h-32 rounded-xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center border border-lantern-border flex-shrink-0">
      <AppIcon name="bag" size={40} className="text-lantern-text-tertiary" />
    </div>
  )}
  <div className="flex-1 flex flex-col justify-between min-w-0">
    <div>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-lantern-text line-clamp-2">
          {inquiry.listing?.title}
        </h3>
        <span className={`text-label font-bold px-2 py-0.5 rounded-md uppercase flex-shrink-0 ${
          inquiry.status === 'purchased' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
          inquiry.status === 'negotiating' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
          inquiry.status === 'closed' ? 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary' :
          'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light'
        }`}>
          {inquiry.status}
        </span>
      </div>
      <p className="text-xs text-lantern-text-secondary mt-1 capitalize font-medium">
        Category: {inquiry.listing?.category || 'academic'}
      </p>
    </div>

    <div className="flex items-baseline gap-2 mt-4">
      <span className="text-xs text-lantern-text-secondary">Asking Price:</span>
      <span className="text-lg font-extrabold text-lantern-primary">
        {inquiry.listing?.price ? `₦${inquiry.listing.price.toLocaleString()}` : 'Free'}
      </span>
    </div>
  </div>
</div>
);


/* `canRespondToOffer` and `canWithdrawOffer` are shared helpers,
   so web and mobile cannot disagree about whose turn it is; the
   Accept/Decline labels flip to "Counter" from the same source. */
/* Action Controls — turn-based on proposed_by */
const OfferActions: React.FC<{
  activeOffer: MarketplaceOffer;
  currentUser: User;
  offerLoading: boolean;
  showCounterInput: boolean;
  setShowCounterInput: (value: boolean) => void;
  counterValue: string;
  setCounterValue: (value: string) => void;
  handleRespond: RespondFn;
}> = ({
  activeOffer,
  currentUser,
  offerLoading,
  showCounterInput,
  setShowCounterInput,
  counterValue,
  setCounterValue,
  handleRespond,
}) => {
  const proposedBy = getOfferProposedBy(activeOffer);
  const canRespond = canRespondToOffer(activeOffer, currentUser.id);
  const canWithdraw = canWithdrawOffer(activeOffer, currentUser.id);
  const isBuyerView = currentUser.id === activeOffer.buyer_id;
  const acceptLabel = proposedBy === 'seller' ? 'Accept Counter' : 'Accept Offer';
  const declineLabel = proposedBy === 'seller' ? 'Decline Counter' : 'Decline Offer';

  if (canWithdraw && !canRespond) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          disabled={offerLoading}
          onClick={() => handleRespond('withdraw')}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
        >
          {offerLoading ? 'Withdrawing...' : 'Withdraw Offer'}
        </button>
      </div>
    );
  }

  if (!canRespond) {
    return (
      <p className="text-xs text-lantern-text-secondary font-medium">
        {isBuyerView
          ? 'Waiting for the seller to respond…'
          : 'Waiting for the buyer to respond…'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!showCounterInput && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={offerLoading}
            onClick={() => handleRespond('accept')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            {acceptLabel}
          </button>
          <button
            disabled={offerLoading}
            onClick={() => handleRespond('decline')}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            {declineLabel}
          </button>
          <button
            disabled={offerLoading}
            onClick={() => { setShowCounterInput(true); setCounterValue(''); }}
            className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            Counter Offer
          </button>
          {canWithdraw && (
            <button
              disabled={offerLoading}
              onClick={() => handleRespond('withdraw')}
              className="px-4 py-2 border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary text-xs font-bold rounded-xl transition-colors"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      {showCounterInput && (
        <div className="flex flex-col gap-2 p-3 bg-lantern-background dark:bg-lantern-surface-secondary/30 rounded-xl border border-lantern-border">
          <label className="text-xs font-bold text-lantern-text">
            Counter Offer Amount (₦)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={counterValue}
              onChange={(e) => setCounterValue(e.target.value)}
              placeholder="Enter counter amount"
              className="flex-1 px-3 py-1.5 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary bg-lantern-surface text-lantern-text text-sm font-semibold"
            />
            <button
              disabled={offerLoading || !counterValue || parseFloat(counterValue) <= 0}
              onClick={() => handleRespond('counter', parseFloat(counterValue))}
              className="px-4 py-1.5 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border text-white text-xs font-bold rounded-lg transition-colors"
            >
              Send Counter
            </button>
            <button
              disabled={offerLoading}
              onClick={() => setShowCounterInput(false)}
              className="px-3 py-1.5 bg-lantern-surface text-lantern-text border border-lantern-border text-xs font-bold rounded-lg transition-colors hover:bg-lantern-background"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


/** The card body when an offer exists: amount, status pill, actions. */
const ActiveOfferBody: React.FC<{
  activeOffer: MarketplaceOffer;
  currentUser: User;
  offerError: string;
  offerLoading: boolean;
  showCounterInput: boolean;
  setShowCounterInput: (value: boolean) => void;
  counterValue: string;
  setCounterValue: (value: string) => void;
  handleRespond: RespondFn;
}> = ({
  activeOffer,
  currentUser,
  offerError,
  offerLoading,
  showCounterInput,
  setShowCounterInput,
  counterValue,
  setCounterValue,
  handleRespond,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-lantern-background dark:bg-lantern-surface-secondary/40 rounded-xl border border-lantern-border/60 dark:border-lantern-border/60 gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-lantern-text-secondary">Offered Amount:</span>
          <span className="text-lg font-bold text-lantern-text">
            ₦{activeOffer.amount.toLocaleString()}
          </span>
        </div>
        <p className="text-[11px] text-lantern-text-tertiary mt-0.5 font-medium">
          Submitted on {new Date(activeOffer.created_at).toLocaleDateString()}
        </p>
        {activeOffer.message && (
          <p className="text-xs italic text-lantern-text-secondary mt-2 bg-lantern-surface p-2 rounded-lg border border-lantern-border/50">
            "{activeOffer.message}"
          </p>
        )}
      </div>

      <div className="flex-shrink-0">
        <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${
          activeOffer.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
          activeOffer.status === 'countered' ? 'bg-lantern-primary-background text-lantern-primary-dark dark:bg-lantern-primary-background dark:text-lantern-primary-light' :
          activeOffer.status === 'accepted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
          activeOffer.status === 'declined' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' :
          'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-background-secondary/40 dark:text-lantern-text-tertiary'
        }`}>
          Offer {activeOffer.status}
        </span>
      </div>
    </div>

    {/* `canRespondToOffer` and `canWithdrawOffer` are shared helpers,
        so web and mobile cannot disagree about whose turn it is; the
        Accept/Decline labels flip to "Counter" from the same source. */}
    {/* Action Controls — turn-based on proposed_by */}
    <div className="pt-2">
      {offerError && <p className="text-xs text-red-500 mb-3 font-semibold">{offerError}</p>}

      <OfferActions
        activeOffer={activeOffer}
        currentUser={currentUser}
        offerLoading={offerLoading}
        showCounterInput={showCounterInput}
        setShowCounterInput={setShowCounterInput}
        counterValue={counterValue}
        setCounterValue={setCounterValue}
        handleRespond={handleRespond}
      />
    </div>
  </div>
);


/** The card body when there is none — which is not always an invitation. */
const NoActiveOffer: React.FC<{
  inquiry: MarketplaceInquiry;
  activeOrder: MarketplaceOrder | null;
  currentUser: User;
  setShowMakeOfferModal: (value: boolean) => void;
}> = ({ inquiry, activeOrder, currentUser, setShowMakeOfferModal }) => {
  const dealDone = inquiry.status === 'purchased' || inquiry.status === 'closed';
  const hasLiveOrder = !!activeOrder && activeOrder.status !== 'cancelled';
  if (dealDone || hasLiveOrder) {
    // A deal is struck — don't re-offer to buy an item already ordered.
    return (
      <p className="text-sm text-lantern-text-secondary font-medium">
        {activeOrder
          ? `This deal is confirmed — order ${activeOrder.status.replace(/_/g, ' ')}.`
          : 'This listing has been purchased or the inquiry is closed.'}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-lantern-text-secondary mb-4 font-medium">
        There are no active offers in negotiation.
      </p>
      {currentUser.id === inquiry.buyer_id && (
        <button
          onClick={() => setShowMakeOfferModal(true)}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center gap-1.5"
        >
          <AppIcon name="currency" size={16} />
          Make an Offer
        </button>
      )}
    </>
  );
};


/** Active Offer Section */
const ActiveOfferSection: React.FC<{
  inquiry: MarketplaceInquiry;
  activeOffer: MarketplaceOffer | null;
  activeOrder: MarketplaceOrder | null;
  currentUser: User;
  offerError: string;
  offerLoading: boolean;
  showCounterInput: boolean;
  setShowCounterInput: (value: boolean) => void;
  counterValue: string;
  setCounterValue: (value: string) => void;
  setShowMakeOfferModal: (value: boolean) => void;
  handleRespond: RespondFn;
}> = ({
  inquiry,
  activeOffer,
  activeOrder,
  currentUser,
  offerError,
  offerLoading,
  showCounterInput,
  setShowCounterInput,
  counterValue,
  setCounterValue,
  setShowMakeOfferModal,
  handleRespond,
}) => (
  <div className="bg-lantern-surface rounded-2xl p-5 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm mb-6">
    <h3 className="text-sm font-bold text-lantern-text mb-4 flex items-center gap-1.5">
      <AppIcon name="currency" size={20} className="text-emerald-500" />
      Active Offer
    </h3>
    {activeOffer ? (
      <ActiveOfferBody
        activeOffer={activeOffer}
        currentUser={currentUser}
        offerError={offerError}
        offerLoading={offerLoading}
        showCounterInput={showCounterInput}
        setShowCounterInput={setShowCounterInput}
        counterValue={counterValue}
        setCounterValue={setCounterValue}
        handleRespond={handleRespond}
      />
    ) : (
      <div className="flex flex-col items-center py-6 text-center">
        <NoActiveOffer
          inquiry={inquiry}
          activeOrder={activeOrder}
          currentUser={currentUser}
          setShowMakeOfferModal={setShowMakeOfferModal}
        />
      </div>
    )}
  </div>
);


/** One dot on the negotiation timeline. */
const HistoryRow: React.FC<{ offer: MarketplaceOffer; currentUser: User }> = ({
  offer,
  currentUser,
}) => (
  <div className="relative">
    {/* Dot indicator */}
    <span className={`absolute -left-[26px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-lantern-border ${
      offer.status === 'accepted' ? 'bg-emerald-500' :
      offer.status === 'declined' ? 'bg-red-500' :
      offer.status === 'withdrawn' ? 'bg-lantern-border' :
      offer.status === 'countered' ? 'bg-amber-500' :
      'bg-lantern-primary'
    }`} />

    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-lantern-text">
          ₦{offer.amount.toLocaleString()}
        </span>
        <span className="text-label tracking-normal text-lantern-text-tertiary font-medium">
          {new Date(offer.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-xs text-lantern-text-secondary mt-1">
        {getOfferProposedBy(offer) === 'seller'
          ? `${offer.seller_id === currentUser.id ? 'You' : 'Seller'} countered ₦${offer.amount.toLocaleString()} (${offer.status})`
          : `${offer.buyer_id === currentUser.id ? 'You' : 'Buyer'} offered ₦${offer.amount.toLocaleString()} (${offer.status})`}
      </p>
      {offer.message && (
        <p className="text-xs italic text-lantern-text-tertiary mt-1">
          "{offer.message}"
        </p>
      )}
    </div>
  </div>
);


/** Negotiation History Timeline */
const NegotiationHistory: React.FC<{
  offerHistory: MarketplaceOffer[];
  currentUser: User;
}> = ({ offerHistory, currentUser }) => (
  <div className="bg-lantern-surface rounded-2xl p-5 border border-lantern-border/60 dark:border-lantern-border/60 shadow-sm flex-1">
    <h3 className="text-sm font-bold text-lantern-text mb-4">
      Negotiation History
    </h3>

    {offerHistory.length === 0 ? (
      <p className="text-xs text-lantern-text-tertiary text-center py-8">
        No previous offers or counter-offers recorded.
      </p>
    ) : (
      <div className="relative border-l border-lantern-border ml-3 pl-5 space-y-6">
        {offerHistory.map((offer) => (
          <HistoryRow key={offer.id} offer={offer} currentUser={currentUser} />
        ))}
      </div>
    )}
  </div>
);


export interface OffersPanelProps {
  inquiry: MarketplaceInquiry;
  activeOffer: MarketplaceOffer | null;
  offerHistory: MarketplaceOffer[];
  activeOrder: MarketplaceOrder | null;
  currentUser: User;
  activeTab: TabValue;
  setActiveTab: (value: TabValue) => void;
  offerError: string;
  offerLoading: boolean;
  showCounterInput: boolean;
  setShowCounterInput: (value: boolean) => void;
  counterValue: string;
  setCounterValue: (value: string) => void;
  setShowMakeOfferModal: (value: boolean) => void;
  orderActionLoading: boolean;
  setOrderActionLoading: (value: boolean) => void;
  setActiveOrder: (order: MarketplaceOrder) => void;
  handleRespond: RespondFn;
  /** The conversation. The SAME node the shell renders bare without an inquiry. */
  chatPanel: React.ReactNode;
}

export const OffersPanel: React.FC<OffersPanelProps> = ({
  inquiry,
  activeOffer,
  offerHistory,
  activeOrder,
  currentUser,
  activeTab,
  setActiveTab,
  offerError,
  offerLoading,
  showCounterInput,
  setShowCounterInput,
  counterValue,
  setCounterValue,
  setShowMakeOfferModal,
  orderActionLoading,
  setOrderActionLoading,
  setActiveOrder,
  handleRespond,
  chatPanel,
}) => (
  <Tabs
    value={activeTab}
    onValueChange={(value) => setActiveTab(value as TabValue)}
    variant="segmented"
    aria-label="Marketplace conversation"
    className="flex flex-col flex-1 min-h-0"
  >
    <InquiryStrip inquiry={inquiry} activeOffer={activeOffer} />

    {!activeOrder && (
      <DealBar
        inquiry={inquiry}
        activeOffer={activeOffer}
        currentUser={currentUser}
        offerLoading={offerLoading}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setShowMakeOfferModal={setShowMakeOfferModal}
        handleRespond={handleRespond}
      />
    )}

    <OrderBar
      inquiry={inquiry}
      activeOrder={activeOrder}
      currentUser={currentUser}
      orderActionLoading={orderActionLoading}
      setOrderActionLoading={setOrderActionLoading}
      setActiveOrder={setActiveOrder}
    />

    <TabPanel value="chat" className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {chatPanel}
    </TabPanel>

    <TabPanel value="offers" className="flex-1 flex flex-col bg-lantern-background overflow-y-auto p-4 md:p-6 min-h-0">
      <ListingCard inquiry={inquiry} />
      <ActiveOfferSection
        inquiry={inquiry}
        activeOffer={activeOffer}
        activeOrder={activeOrder}
        currentUser={currentUser}
        offerError={offerError}
        offerLoading={offerLoading}
        showCounterInput={showCounterInput}
        setShowCounterInput={setShowCounterInput}
        counterValue={counterValue}
        setCounterValue={setCounterValue}
        setShowMakeOfferModal={setShowMakeOfferModal}
        handleRespond={handleRespond}
      />
      <NegotiationHistory offerHistory={offerHistory} currentUser={currentUser} />
    </TabPanel>
  </Tabs>
);

export default OffersPanel;
