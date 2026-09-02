import { useGroupStore } from '../stores/groupStore';
import { sumUnread, useMarketplaceStore } from '../stores/marketplaceStore';

/**
 * Every number a Shop surface may badge, all of them counts of things that
 * need you now, never lifetime totals. The exception is savedCount, which is
 * shown as grey hint text — saving is not attention.
 */
export interface ShopBadges {
  /** Line items in the cart (quantity summed). */
  cartCount: number;
  /** Orders where the buyer must pay or confirm pickup. */
  buyerActionOrders: number;
  /** Orders where the seller must confirm cash or hand the item over. */
  sellerActionOrders: number;
  /** Offers on this seller's listings where it is the seller's turn. */
  offersAwaitingMe: number;
  /** Offers this user made where the seller countered and the buyer must answer. */
  offersAwaitingYou: number;
  /** Unread messages on inquiry threads, both sides combined. */
  unreadInquiries: number;
  /** Unread buyer messages on this seller's open inquiries. */
  unreadSellerInquiries: number;
  /** Unread seller replies on inquiries this user sent. */
  unreadBuyerInquiries: number;
  /** Open inquiries on this seller's listings — hub detail text, not a badge. */
  openInquiries: number;
  /** Seller orders where the buyer still has to pay online — grey text, never red. */
  sellerAwaitingBuyerPayment: number;
  /** Everything the seller side must handle: hand-overs + offers + unread questions. */
  sellerAttention: number;
  /** The You icon's badge. */
  needsYou: number;
  /** Live listings (active + reserved). */
  activeListings: number;
  /** Saved listings. */
  savedCount: number;
}

/**
 * The one place badge arithmetic lives. The header icons, the quick-access
 * band and the Shop home used to each sum their own expression over the
 * summary, and they had started to disagree — one counted every open inquiry
 * as attention, another counted the seller's own counter-offers. Read from
 * here and they cannot drift.
 *
 * Inquiry badges join the summary's thread ids with groupStore's unread map,
 * so opening the DM (markDMAsRead) clears the badge on its own. They are only
 * as fresh as that map: if fetchDmThreads never ran they read 0, which is the
 * conservative failure.
 */
export function useShopBadges(): ShopBadges {
  const summary = useMarketplaceStore((s) => s.shopSummary);
  const savedCount = useMarketplaceStore((s) => s.favorites.size);
  const dmUnread = useGroupStore((s) => s.dmUnreadCounts);

  const unreadSellerInquiries = sumUnread(summary.sellerInquiryThreadIds, dmUnread);
  const unreadBuyerInquiries = sumUnread(summary.buyerInquiryThreadIds, dmUnread);
  const unreadInquiries = unreadSellerInquiries + unreadBuyerInquiries;
  const sellerAttention =
    summary.sellerActionOrders + summary.pendingOffersReceived + unreadSellerInquiries;

  return {
    cartCount: summary.cartCount,
    buyerActionOrders: summary.buyerActionOrders,
    sellerActionOrders: summary.sellerActionOrders,
    offersAwaitingMe: summary.pendingOffersReceived,
    offersAwaitingYou: summary.offersAwaitingYou,
    unreadInquiries,
    unreadSellerInquiries,
    unreadBuyerInquiries,
    openInquiries: summary.openInquiries,
    sellerAwaitingBuyerPayment: summary.sellerAwaitingBuyerPayment,
    sellerAttention,
    // Buyer and seller order sets are disjoint for one user (the server filters
    // by buyer_id or seller_id, never both), so this never double counts.
    // A seller's counter-offer is the buyer's to answer, so offersAwaitingYou
    // is attention too — leaving it out told a buyer "nothing needs you" while
    // a counter sat waiting to expire.
    needsYou:
      summary.sellerActionOrders +
      summary.buyerActionOrders +
      summary.pendingOffersReceived +
      summary.offersAwaitingYou +
      unreadInquiries,
    activeListings: summary.activeListings,
    savedCount,
  };
}
