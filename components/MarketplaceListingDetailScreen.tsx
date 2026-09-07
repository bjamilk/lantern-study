import React, { useState, useEffect, useRef } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import {
  fetchMarketplaceListingFull,
  fetchNegotiationHistory,
  addMarketplaceReview,
  setMarketplaceReviewHelpful,
  createInquiry,
  addToFavorites,
  removeFromFavorites,
  addRecentlyViewed,
  getRecentlyViewed,
  fetchMarketplaceListingsByIds,
  fetchSellerStats,
  boostMarketplaceListing,
  buyMarketplaceListingNow,
  addToMarketplaceCart,
  fetchMarketplacePaymentsConfig,
  validateMarketplaceCoupon,
  fetchPickupNudge,
  downloadQuestionBank,
  fetchQuestionBankPreview,
  fetchQuestionBankLeaderboard,
  downloadStudyPack,
  fetchStudyPackPreview,
  type MarketplaceQuestionBankMeta,
  type QuestionBankPreview,
  type QuestionBankLeaderboardEntry,
  type MarketplaceStudyPackMeta,
  type StudyPackPreview,
} from '../services/supabase';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import {
  computeMarketplaceCheckoutFees,
  MARKETPLACE_DEFAULT_SERVICE_FEE_BPS,
  nairaToKobo,
  koboToNaira,
  isMarketplaceListingEditable,
  isMarketplaceListingModerated,
  isDigitalListingKind,
  summarizeStudyPackCounts,
  MARKETPLACE_LISTING_STATUS_LABELS,
  marketplaceListingModerationNotice,
  listingBreadcrumb,
  listingSpecRows,
  listingTypeLabel,
  computeMarketplaceReviewSummary,
  reviewHistogramPercentages,
  sortMarketplaceReviews,
  filterReviewsByStar,
  REVIEW_SORT_LABELS,
  type ReviewSortOption,
} from '@lantern/shared/marketplace';
import {
  generateListingLink,
  formatCampusLabel,
  SUPPORT_EMAIL,
  LISTING_APPEAL_STATUS_LABELS,
  canAppealListing,
} from '@lantern/shared';
import { ScaleIcon } from '@heroicons/react/24/outline';
import ReportContentModal from './moderation/ReportContentModal';
import AppealListingModal from './moderation/AppealListingModal';
import { usePageSeo } from '../hooks/usePageSeo';
import MarketplaceComplianceBanner from './marketplace/MarketplaceComplianceBanner';
import SaleCountdown from './marketplace/SaleCountdown';
import { MarketplaceListingRail } from './marketplace/MarketplaceListingRail';
import { useAuthStore } from '../stores/authStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import { MarketplaceListing, MarketplaceReview, MarketplacePickupNudge } from '../types';
import MakeOfferModal from './MakeOfferModal';
import Modal from './ui/Modal';
import { shouldShowTrustChip, trustLabel } from '@lantern/shared/network';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  ClockIcon,
  StarIcon,
  ChatBubbleLeftIcon,
  ShoppingBagIcon,
  ExclamationTriangleIcon,
  UserIcon,
  HeartIcon,
  ShareIcon,
  FlagIcon,
  EyeIcon,
  CurrencyDollarIcon,
  PencilSquareIcon,
  ClipboardDocumentListIcon,
  CheckBadgeIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon, HeartIcon as HeartSolidIcon } from '@heroicons/react/24/solid';

interface MarketplaceListingDetailScreenProps {
  listingId: string;
  onNavigate: (screen: string, params?: any) => void;
  onBack: () => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
  /** Prefill from Buy again; capped by stock when listing loads. */
  initialQuantity?: number;
}

const MarketplaceListingDetailScreen: React.FC<MarketplaceListingDetailScreenProps> = ({
  listingId,
  onNavigate,
  onBack,
  guestMode = false,
  onSignInRequired,
  initialQuantity,
}) => {
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  // 'top' sorts by helpful votes with a recency tiebreak, so before any votes
  // exist (or pre-migration, when counts are absent) it reads as most-recent.
  const [reviewSort, setReviewSort] = useState<ReviewSortOption>('top');
  const [reviewStarFilter, setReviewStarFilter] = useState<number | null>(null);
  const [votingReviewId, setVotingReviewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '' });
  const [isFavorited, setIsFavorited] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [similarListings, setSimilarListings] = useState<MarketplaceListing[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<MarketplaceListing[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sellerStats, setSellerStats] = useState<{ totalListings: number; soldCount: number } | null>(null);
  const [negotiationHistory, setNegotiationHistory] = useState<any[]>([]);
  const [buyingNow, setBuyingNow] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState('');
  const [couponPreview, setCouponPreview] = useState<{
    discountAmount: number;
    finalAmount: number;
  } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [boostingListing, setBoostingListing] = useState(false);
  const [pickupNudge, setPickupNudge] = useState<MarketplacePickupNudge | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [questionBank, setQuestionBank] = useState<MarketplaceQuestionBankMeta | null>(null);
  const [studyPack, setStudyPack] = useState<MarketplaceStudyPackMeta | null>(null);
  const [studyPackPreview, setStudyPackPreview] = useState<StudyPackPreview | null>(null);
  const [downloadingBank, setDownloadingBank] = useState(false);
  const [bankPreview, setBankPreview] = useState<QuestionBankPreview | null>(null);
  const [leaderboard, setLeaderboard] = useState<{
    entries: QuestionBankLeaderboardEntry[];
    viewerEntry: QuestionBankLeaderboardEntry | null;
  } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // Payment mode drives the Buy Now fee quote. Manual/cash mode charges no
  // service fee server-side, so the confirm dialog must not quote one.
  const [paymentConfig, setPaymentConfig] = useState<{
    paystackEnabled: boolean;
    serviceFeeBps: number;
    /** Buyer surcharge on digital listings (Phase 2 · I); 0 = buyer pays list price. */
    digitalBuyerFeeBps: number;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listingLoadId = useRef(0);
  const { currentUser } = useAuthStore();
  const { refreshBudgetTransactions } = useBudgetHandlers();
  // Guard on the viewer AND the loaded listing: before the listing arrives
  // (and always in guest mode) both sides are undefined, which made isOwner
  // true — firing owner-only fetches that 401 and, via notifySessionExpired,
  // bounced every guest off public listing pages to /welcome.
  const isOwner =
    !!currentUser?.id &&
    !!listing &&
    (listing.user_id === currentUser.id || listing.seller_id === currentUser.id);

  const seoPricing = listing ? resolveListingDisplayPrice(listing).effective : null;
  const campusLabel = listing?.campus
    ? formatCampusLabel(listing.campus as { name: string; city: string })
    : listing?.location || 'Nigeria';

  usePageSeo(
    listing
      ? {
          title: `${listing.title}${seoPricing ? ` — ₦${seoPricing.toLocaleString()}` : ''} — ${campusLabel} | Lantern Study`,
          description: (listing.description || `Nigerian marketplace listing: ${listing.title}`).slice(0, 160),
          canonicalUrl: generateListingLink(listing.id),
          ogImage: listing.images?.[0] || 'https://lanternstudy.com/lantern-icon-v2.png',
          ogType: 'product',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: listing.title,
            description: listing.description,
            image: listing.images?.[0],
            url: generateListingLink(listing.id),
            ...(seoPricing
              ? {
                  offers: {
                    '@type': 'Offer',
                    priceCurrency: 'NGN',
                    price: seoPricing,
                    availability: 'https://schema.org/InStock',
                  },
                }
              : {}),
            areaServed: campusLabel,
          },
        }
      : null
  );

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const requireAuth = () => {
    if (guestMode) {
      onSignInRequired?.();
      return true;
    }
    return false;
  };

  useEffect(() => {
    const loadId = ++listingLoadId.current;
    void loadListingFull(loadId);
    if (!guestMode) {
      addRecentlyViewed(listingId);
    }
    void import('../services/productAnalytics').then(({ trackListingView }) => {
      trackListingView(listingId, guestMode ? 'guest' : 'app');
    });
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [listingId, guestMode]);

  useEffect(() => {
    if (guestMode) return;
    const ids = getRecentlyViewed().filter((id) => id !== listingId).slice(0, 8);
    if (ids.length === 0) {
      setRecentlyViewed([]);
      return;
    }
    void fetchMarketplaceListingsByIds(ids)
      .then((rows) => {
        setRecentlyViewed(rows.filter((row) => row.id !== listingId && row.status === 'active'));
      })
      .catch(() => setRecentlyViewed([]));
  }, [listingId, guestMode]);

  useEffect(() => {
    let alive = true;
    fetchMarketplacePaymentsConfig()
      .then((config) => {
        if (alive) {
          setPaymentConfig({
            paystackEnabled: !!config.paystackEnabled,
            serviceFeeBps: config.serviceFeeBps,
            digitalBuyerFeeBps: Number((config as { digitalBuyerFeeBps?: number }).digitalBuyerFeeBps ?? 0),
          });
        }
      })
      .catch(() => {
        if (alive) setPaymentConfig(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (isOwner) {
      loadSellerStats();
      loadNegotiationHistory();
    }
  }, [isOwner]);

  const loadNegotiationHistory = async () => {
    if (!listingId) return;
    try {
      const history = await fetchNegotiationHistory(listingId);
      setNegotiationHistory(history);
    } catch (error) {
      console.error('Error loading negotiation history:', error);
    }
  };

  const loadSellerStats = async () => {
    try {
      const stats = await fetchSellerStats();
      if (stats) {
        setSellerStats({
          totalListings: stats.totalListings ?? stats.activeListings ?? 0,
          soldCount: stats.soldListings ?? stats.soldCount ?? 0,
        });
      }
    } catch (error) {
      console.error('Error loading seller stats:', error);
    }
  };

  // Batched load: listing + isFavorited + similarListings in one request
  const loadListingFull = async (loadId?: number) => {
    setLoading(true);
    try {
      const data = await fetchMarketplaceListingFull(listingId, currentUser?.id);
      if (loadId !== undefined && loadId !== listingLoadId.current) return;
      setListing(data.listing);
      if (data.listing?.quantity == null) {
        setSelectedQuantity(1);
      } else {
        const stock = Math.max(1, Number(data.listing.quantity) || 1);
        const pref = Math.max(1, Math.floor(Number(initialQuantity) || 1));
        setSelectedQuantity(Math.min(pref, stock));
      }
      setReviews(data.listing.reviews || []);
      setIsFavorited(data.isFavorited);
      setSimilarListings(data.similarListings);
      setCanReview(!!data.canReview);
      setQuestionBank(data.questionBank || null);
      setStudyPack(data.studyPack || null);
      if (data.listing?.listing_kind === 'question_bank') {
        // Preview is decorative; a failure must not block the listing.
        void fetchQuestionBankPreview(listingId)
          .then((preview) => {
            if (loadId === undefined || loadId === listingLoadId.current) {
              setBankPreview(preview);
            }
          })
          .catch(() => setBankPreview(null));
        void fetchQuestionBankLeaderboard(listingId, 10)
          .then((board) => {
            if (loadId === undefined || loadId === listingLoadId.current) {
              setLeaderboard(board);
            }
          })
          .catch(() => setLeaderboard(null));
        setStudyPackPreview(null);
      } else if (data.listing?.listing_kind === 'study_pack') {
        void fetchStudyPackPreview(listingId)
          .then((preview) => {
            if (loadId === undefined || loadId === listingLoadId.current) {
              setStudyPackPreview(preview);
            }
          })
          .catch(() => setStudyPackPreview(null));
        setBankPreview(null);
        setLeaderboard(null);
      } else {
        setBankPreview(null);
        setLeaderboard(null);
        setStudyPackPreview(null);
      }
      const sellerId = data.listing.user_id || data.listing.seller_id;
      if (sellerId && currentUser?.id && sellerId !== currentUser.id) {
        setPickupNudge(await fetchPickupNudge(sellerId));
      } else {
        setPickupNudge(null);
      }
    } catch (error) {
      console.error('Error loading listing:', error);
    } finally {
      if (loadId === undefined || loadId === listingLoadId.current) {
        setLoading(false);
      }
    }
  };

  const handleAddReview = async () => {
    if (!listing) return;

    try {
      const newReview = await addMarketplaceReview(listing.id, reviewForm);
      // Posting again edits the existing review server-side (upsert), so
      // replace rather than duplicate when the reviewer already has one.
      setReviews(prev => {
        const rest = prev.filter(r => r.reviewer_id !== newReview.reviewer_id);
        return [newReview, ...rest];
      });
      setReviewForm({ rating: 5, comment: '' });
      setShowReviewForm(false);
    } catch (error) {
      console.error('Error adding review:', error);
      showToast('Failed to add review. Please try again.', 'error');
    }
  };

  const handleToggleHelpful = async (review: MarketplaceReview) => {
    if (!listing || requireAuth()) return;
    if (votingReviewId) return;
    setVotingReviewId(review.id);
    try {
      const result = await setMarketplaceReviewHelpful(
        listing.id,
        review.id,
        !review.viewerMarkedHelpful,
      );
      setReviews(prev =>
        prev.map(r =>
          r.id === review.id
            ? {
                ...r,
                helpfulCount: result.helpfulCount,
                viewerMarkedHelpful: result.viewerMarkedHelpful,
              }
            : r,
        ),
      );
    } catch (error) {
      console.error('Error updating review vote:', error);
      showToast('Could not record that. Please try again.', 'error');
    } finally {
      setVotingReviewId(null);
    }
  };

  // Reporting goes through the shared ReportContentModal (reasons from
  // reasonsForTarget('listing'); POST /reports; 409 = already reported).

  const handleContactSeller = () => {
    if (!listing) return;
    if (requireAuth()) return;
    setShowContactForm(true);
  };

  const handleSendInquiry = async () => {
    if (!listing || !contactMessage.trim()) return;
    if (requireAuth()) return;

    const sellerId = listing.user_id || listing.seller_id;
    if (!sellerId) {
      showToast('Could not find this seller. Please try again.', 'error');
      return;
    }

    setContactLoading(true);
    try {
      // Create inquiry to link the conversation to the listing
      await createInquiry(listing.id, contactMessage.trim());
      void import('../services/productAnalytics').then(({ trackInquiryStarted }) => {
        trackInquiryStarted(listing.id);
      });
      // Signal chat shell to refetch DM threads so the new conversation appears without a full reload.
      window.dispatchEvent(new CustomEvent('lantern:refresh-dm-threads'));
      
      // Navigate to direct messages with seller (API listings use user_id, not seller_id)
      onNavigate('DirectMessages', { userId: sellerId });
      
      setShowContactForm(false);
      setContactMessage('');
    } catch (error) {
      console.error('Error sending inquiry:', error);
      showToast('Failed to send inquiry. Please try again.', 'error');
    } finally {
      setContactLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (requireAuth()) return;
    const next = !isFavorited;
    setIsFavorited(next); // optimistic update
    try {
      if (!next) {
        await removeFromFavorites(listingId);
      } else {
        await addToFavorites(listingId);
      }
    } catch (error) {
      setIsFavorited(!next); // rollback on failure
      showToast('Could not update favorites. Please try again.', 'error');
    }
  };

  const handleBuyNow = async () => {
    if (!listing || !listing.price || listing.price <= 0) return;
    if (requireAuth()) return;
    const pricing = resolveListingDisplayPrice(listing);
    const unitPay = couponPreview?.finalAmount ?? pricing.effective;
    const qty = listing.quantity == null ? 1 : selectedQuantity;
    const itemTotal = Math.round(unitPay * qty * 100) / 100;
    // Manual/cash mode charges no service fee server-side; only Paystack does.
    // Default conservative (no fee) until config loads, matching usePaystackEnabled.
    const paystackEnabled = paymentConfig?.paystackEnabled ?? false;
    // Digital products charge the buyer the LIST price (the platform's cut comes
    // out of the creator's payout), so quoting the physical 5% here would
    // overstate what the server actually charges.
    const serviceFeeBps = isDigital
      ? (paymentConfig?.digitalBuyerFeeBps ?? 0)
      : (paymentConfig?.serviceFeeBps ?? MARKETPLACE_DEFAULT_SERVICE_FEE_BPS);
    const fees = computeMarketplaceCheckoutFees(
      nairaToKobo(itemTotal),
      paystackEnabled ? serviceFeeBps : 0
    );
    const serviceFee = koboToNaira(fees.serviceFeeKobo);
    const payAmount = koboToNaira(fees.totalChargeKobo);
    const showFee = paystackEnabled && fees.serviceFeeKobo > 0;
    const serviceFeePct = serviceFeeBps / 100;
    const confirmed = await confirmDialog({
      title: 'Confirm purchase',
      message: showFee
        ? `Confirm purchase of ${listing.title}${qty > 1 ? ` ×${qty}` : ''}?\n\nItem: ₦${itemTotal.toLocaleString()}\nService charge (${serviceFeePct}%): ₦${serviceFee.toLocaleString()}\nTotal: ₦${payAmount.toLocaleString()}`
        : `Confirm purchase of ${listing.title}${qty > 1 ? ` ×${qty}` : ''}?\n\nTotal: ₦${payAmount.toLocaleString()}`,
      confirmLabel: paystackEnabled ? 'Pay now' : 'Place order',
    });
    if (!confirmed) return;

    setBuyingNow(true);
    try {
      void import('../services/productAnalytics').then(({ trackCheckoutStarted }) => {
        trackCheckoutStarted(listing.id);
      });
      const result = await buyMarketplaceListingNow(
        listing.id,
        couponPreview ? couponCode.trim() : undefined,
        qty
      );
      if (result?.authorizationUrl) {
        showToast('Redirecting to Paystack to complete payment…');
        window.location.assign(result.authorizationUrl);
        return;
      }
      showToast('Order placed. Arrange pickup or delivery with the seller.');
      if (result?.order?.id) {
        onNavigate('MarketplaceOrderDetail', { orderId: result.order.id });
      } else {
        await loadListingFull();
      }
    } catch (error: any) {
      showToast(error?.message || 'Could not complete purchase.', 'error');
    } finally {
      setBuyingNow(false);
    }
  };

  const handleAddToCart = async () => {
    if (!listing || !listing.price || listing.price <= 0) return;
    if (requireAuth()) return;
    const qty = listing.quantity == null ? 1 : selectedQuantity;
    setAddingToCart(true);
    try {
      await addToMarketplaceCart(listing.id, qty);
      showToast(qty > 1 ? `Added ${qty} to cart` : 'Added to cart');
    } catch (error: any) {
      showToast(error?.message || 'Could not add to cart.', 'error');
    } finally {
      setAddingToCart(false);
    }
  };

  const handleApplyCoupon = async () => {
    if (!listing || !couponCode.trim()) return;
    setValidatingCoupon(true);
    try {
      const result = await validateMarketplaceCoupon(couponCode.trim(), listing.id);
      setCouponPreview({
        discountAmount: result.discountAmount,
        finalAmount: result.finalAmount,
      });
      showToast(`Coupon applied — ₦${result.discountAmount.toLocaleString()} off`);
    } catch (error: any) {
      setCouponPreview(null);
      showToast(error?.message || 'Invalid coupon', 'error');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleDownloadDigital = async () => {
    if (!listing) return;
    if (requireAuth()) return;
    setDownloadingBank(true);
    try {
      if (listing.listing_kind === 'study_pack') {
        await downloadStudyPack(listing.id);
        setStudyPack(prev => (prev ? { ...prev, owned: true } : prev));
        showToast('Added to your Library — available on all your devices.');
      } else {
        await downloadQuestionBank(listing.id);
        setQuestionBank(prev => (prev ? { ...prev, owned: true } : prev));
        showToast('Added to your Offline Mode — available on all your devices.');
      }
    } catch (error: any) {
      showToast(error?.message || 'Could not download this item.', 'error');
    } finally {
      setDownloadingBank(false);
    }
  };

  const handleBoostListing = async () => {
    if (!listing) return;
    setBoostingListing(true);
    try {
      await boostMarketplaceListing(listing.id, 72);
      showToast('Listing boosted for 72 hours.');
      await loadListingFull();
    } catch (error: any) {
      showToast(error?.message || 'Failed to boost listing.', 'error');
    } finally {
      setBoostingListing(false);
    }
  };

  const nextImage = () => {
    if (!listing?.images?.length) return;
    setCurrentImageIndex((prev) => (prev + 1) % listing.images!.length);
  };

  const prevImage = () => {
    if (!listing?.images?.length) return;
    setCurrentImageIndex((prev) => (prev - 1 + listing.images!.length) % listing.images!.length);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-lantern-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-lantern-primary/30 border-t-lantern-primary mx-auto mb-3"></div>
          <p className="text-sm text-lantern-text-secondary">Loading listing...</p>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-lantern-background p-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-lantern-background-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ExclamationTriangleIcon className="w-8 h-8 text-lantern-text-tertiary" />
          </div>
          <h2 className="text-lg font-semibold text-lantern-text mb-1">Listing not found</h2>
          <p className="text-sm text-lantern-text-secondary mb-5 max-w-sm">The listing you're looking for doesn't exist or has been removed.</p>
          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center gap-2 mx-auto transition-colors duration-150 text-sm shadow-sm"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const reviewSummary = computeMarketplaceReviewSummary(reviews);
  const averageRating = reviewSummary.average ?? 0;
  const histogramPct = reviewHistogramPercentages(reviewSummary);
  const displayReviews = sortMarketplaceReviews(
    filterReviewsByStar(reviews, reviewStarFilter),
    reviewSort,
  );

  const pricing = listing ? resolveListingDisplayPrice(listing) : null;
  const isDigital = isDigitalListingKind(listing.listing_kind);
  const isStudyPack = listing.listing_kind === 'study_pack';
  const digitalOwned = isStudyPack ? !!studyPack?.owned : !!questionBank?.owned;
  // quantity null = unlimited/digital stock (not sold out); only a literal 0 is sold out.
  const isSoldOut = listing.quantity === 0;
  const taxonomyCrumbs = listing ? listingBreadcrumb(listing) : [];
  const specRows = listing ? listingSpecRows(listing) : [];
  const typeLabel = listing ? listingTypeLabel(listing) : '';

  const openBrowseNode = (nodeId: string, department?: string, category?: string) => {
    onNavigate('Marketplace', {
      browseNodeId: nodeId,
      tab: department === 'student-life' ? 'student-life' : 'academic',
      category,
    });
  };

  return (
    <div className="flex-1 bg-lantern-background overflow-y-auto">
      <div className="px-3 sm:px-4 md:px-6 pt-3">
        <MarketplaceComplianceBanner />
      </div>
      {/* Header */}
      <div className="bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-2.5 sm:py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 sm:gap-2 text-sm text-lantern-text-secondary hover:text-lantern-text font-medium transition-colors duration-150 px-2 py-1.5 -ml-2 rounded-lg hover:bg-lantern-background-secondary"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Marketplace</span>
            <span className="sm:hidden">Back</span>
          </button>

          <div className="flex items-center gap-1">
            {!guestMode && (
            <button
              onClick={toggleFavorite}
              className="p-2 rounded-lg hover:bg-lantern-background-secondary transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
              aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorited ? (
                <HeartSolidIcon className="w-5 h-5 text-red-500" />
              ) : (
                <HeartIcon className="w-5 h-5 text-lantern-text-tertiary" />
              )}
            </button>
            )}
            <button
              onClick={() => {
                if (!listing) return;
                const url = generateListingLink(listingId);
                const text = `Check out "${listing.title}" on Lantern Study Marketplace`;
                if (navigator.share) {
                  navigator.share({ title: listing.title, text, url }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(`${text}: ${url}`).then(() => {
                    showToast('Link copied to clipboard!');
                  }).catch(() => {
                    showToast('Could not copy link.', 'error');
                  });
                }
              }}
              className="p-2 rounded-lg text-lantern-text-tertiary hover:text-lantern-text-secondary dark:hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
              aria-label="Share listing"
            >
              <ShareIcon className="w-5 h-5" />
            </button>
            {!guestMode && !isOwner && (
            <button
              onClick={() => setShowReportForm(true)}
              className="p-2 rounded-lg text-lantern-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label="Report listing"
            >
              <FlagIcon className="w-5 h-5" />
            </button>
            )}
          </div>
        </div>
        {taxonomyCrumbs.length > 0 ? (
          <nav className="mt-2 flex flex-wrap items-center gap-1 text-[11px] sm:text-xs text-lantern-text-secondary" aria-label="Listing type">
            <button type="button" onClick={onBack} className="hover:text-lantern-primary">
              Explore
            </button>
            {taxonomyCrumbs.map((node) => (
              <React.Fragment key={node.id}>
                <span aria-hidden className="text-lantern-text-tertiary">›</span>
                <button
                  type="button"
                  onClick={() => openBrowseNode(node.id, node.department, node.listingCategory)}
                  className="hover:text-lantern-primary"
                >
                  {node.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
          {/* Images Section */}
          <div className="space-y-3">
            <div className="relative bg-lantern-background-secondary dark:bg-lantern-surface-secondary/50 rounded-2xl overflow-hidden ring-1 ring-lantern-border/60">
              {listing.images && listing.images.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="block w-full relative group"
                    aria-label="Enlarge photo"
                  >
                    <img
                      src={listing.images[currentImageIndex]}
                      alt={listing.title}
                      className="w-full h-56 sm:h-72 md:h-96 object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-lantern-surface/90 text-[11px] font-medium text-lantern-text opacity-0 group-hover:opacity-100 transition-opacity">
                      <MagnifyingGlassIcon className="w-3.5 h-3.5" />
                      Zoom
                    </span>
                  </button>
                  {listing.images.length > 1 && (
                    <>
                      <button
                        onClick={prevImage}
                        className="absolute left-3 top-1/2 transform -translate-y-1/2 p-2 bg-lantern-surface/80 dark:bg-lantern-surface/80 backdrop-blur-sm rounded-xl hover:bg-lantern-surface dark:hover:bg-lantern-surface-secondary transition-colors duration-150 shadow-sm"
                        aria-label="Previous image"
                      >
                        <ArrowLeftIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={nextImage}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 bg-lantern-surface/80 dark:bg-lantern-surface/80 backdrop-blur-sm rounded-xl hover:bg-lantern-surface dark:hover:bg-lantern-surface-secondary transition-colors duration-150 shadow-sm"
                        aria-label="Next image"
                      >
                        <ArrowLeftIcon className="w-4 h-4 rotate-180" />
                      </button>
                      <div className="absolute bottom-3 left-1/2 transform -translate-x-1/2 flex gap-1.5">
                        {listing.images.map((_, index) => (
                          <button
                            key={index}
                            onClick={() => setCurrentImageIndex(index)}
                            className={`w-2 h-2 rounded-full transition-all duration-200 ${
                              index === currentImageIndex ? 'bg-lantern-surface w-5' : 'bg-lantern-surface/50 hover:bg-lantern-surface/70'
                            }`}
                            aria-label={`View image ${index + 1}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-56 sm:h-72 md:h-96 flex items-center justify-center">
                  <div className="text-center">
                    <ShoppingBagIcon className="w-12 h-12 text-lantern-text-tertiary mx-auto mb-3" />
                    <p className="text-sm text-lantern-text-tertiary">No images available</p>
                  </div>
                </div>
              )}
            </div>

            {/* Thumbnail Gallery */}
            {listing.images && listing.images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-none">
                {listing.images.map((image, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentImageIndex(index)}
                    className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden ring-2 transition-all duration-150 ${
                      index === currentImageIndex
                        ? 'ring-lantern-primary ring-offset-2 dark:ring-offset-lantern-background'
                        : 'ring-transparent hover:ring-lantern-border'
                    }`}
                    aria-label={`Select image ${index + 1}`}
                  >
                    <img src={image} alt={`Thumbnail ${index + 1}`} loading="lazy" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details Section — sticky buy column on large screens */}
          <div className="space-y-4 sm:space-y-5 lg:sticky lg:top-4 lg:self-start">
            {/* Title and Price */}
            <div>
              {typeLabel ? (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-1">
                  {typeLabel}
                </p>
              ) : null}
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-lantern-text mb-2 sm:mb-3">
                {listing.title}
              </h1>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {pricing?.onSale ? (
                    <>
                      <span className="text-2xl font-bold text-lantern-primary">
                        ₦{pricing.effective.toLocaleString()}
                      </span>
                      <span className="text-lg text-lantern-text-tertiary line-through">
                        ₦{pricing.base.toLocaleString()}
                      </span>
                      {listing.promo_label && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">
                          {listing.promo_label}
                        </span>
                      )}
                      <SaleCountdown saleEndsAt={listing.sale_ends_at} />
                    </>
                  ) : (
                    <span className="text-2xl font-bold text-lantern-primary">
                      {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {listing.quantity != null && (
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium ${
                      listing.quantity > 0
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                    }`}>
                      {listing.quantity > 0 ? `${listing.quantity} left` : 'Sold out'}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-sm text-lantern-text-secondary">
                    <StarIcon className="w-4 h-4 text-amber-400 fill-current" />
                    <span className="font-semibold">{averageRating.toFixed(1)}</span>
                    <span className="text-lantern-text-tertiary">({reviews.length})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Meta Information */}
            <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-lantern-text-secondary">
              <span className="flex items-center gap-1 bg-lantern-background-secondary px-2.5 py-1 rounded-lg">
                <MapPinIcon className="w-3.5 h-3.5" />
                {listing.location || 'Not specified'}
              </span>
              <span className="flex items-center gap-1 bg-lantern-background-secondary px-2.5 py-1 rounded-lg">
                <ClockIcon className="w-3.5 h-3.5" />
                {new Date(listing.created_at).toLocaleDateString()}
              </span>
            </div>

            {pickupNudge?.message && !isOwner && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-sm text-emerald-800 dark:text-emerald-200">
                {pickupNudge.message}
              </div>
            )}

            {listing.listing_kind === 'bundle' && listing.bundle_items && listing.bundle_items.length > 0 && (
              <div className="p-3 rounded-xl bg-lantern-primary-background dark:bg-lantern-primary-background border border-lantern-primary/30 dark:border-lantern-primary/30">
                <h3 className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light mb-2">Bundle includes</h3>
                <ul className="space-y-1 text-sm text-lantern-primary-dark dark:text-lantern-primary-light">
                  {listing.bundle_items.map((item, idx) => (
                    <li key={item.listing_id || idx}>
                      • {item.title}
                      {item.price != null ? ` (₦${Number(item.price).toLocaleString()})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Description */}
            <div>
              <h3 className="text-sm font-semibold text-lantern-text mb-1.5 uppercase tracking-wide">Description</h3>
              <p className="text-sm text-lantern-text-secondary leading-relaxed">
                {listing.description || 'No description provided.'}
              </p>
            </div>

            {/* Item details */}
            {specRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-lantern-text mb-2 uppercase tracking-wide">About this item</h3>
                <div className="grid grid-cols-2 gap-2">
                  {specRows.map((row) => (
                    <div key={row.key} className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">{row.label}</span>
                      <p className="text-sm font-medium text-lantern-text">{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Seller Information */}
            <div className="bg-lantern-background-secondary/50 rounded-xl p-4 ring-1 ring-lantern-border/60">
              <h3 className="text-xs font-semibold text-lantern-text-secondary mb-3 uppercase tracking-wide">Seller</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-lantern-primary-background dark:bg-lantern-primary-dark/30 rounded-xl flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-lantern-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      onClick={() => onNavigate(isDigital ? 'CreatorProfile' : 'SellerProfile', { userId: listing.user_id || listing.seller_id })}
                      className="font-semibold text-sm text-lantern-primary hover:underline truncate block text-left"
                    >
                      {listing.seller?.name || listing.profiles?.name || 'Anonymous Seller'}
                    </button>
                    {/*
                      Phase 3 N: trust on the SELLER EMBED, where the buying
                      decision is actually made. 'new' shows no chip on purpose —
                      labelling every newcomer reads as a warning and punishes
                      exactly the people we want publishing.
                    */}
                    {shouldShowTrustChip((listing.seller as { trustLevel?: string } | undefined)?.trustLevel) && (
                      <span className="shrink-0 rounded-full bg-lantern-primary/10 px-2 py-0.5 text-label tracking-normal font-medium text-lantern-primary">
                        {trustLabel((listing.seller as { trustLevel?: string } | undefined)?.trustLevel)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(isDigital ? 'CreatorProfile' : 'SellerProfile', { userId: listing.user_id || listing.seller_id })}
                    className="text-[11px] font-semibold text-lantern-text-secondary hover:text-lantern-primary"
                  >
                    View shop
                  </button>
                  <div className="flex items-center gap-2 text-xs text-lantern-text-secondary">
                    {averageRating > 0 && (
                      <span className="flex items-center gap-0.5">
                        <StarIcon className="w-3 h-3 text-amber-400 fill-current" />
                        {averageRating.toFixed(1)} rating
                      </span>
                    )}
                    <span>· {reviews.length} review{reviews.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
              {/* Seller since */}
              <div className="mt-2.5 pt-2.5 border-t border-lantern-border/60 dark:border-lantern-border/60 flex items-center gap-3 text-xs text-lantern-text-secondary">
                <span className="flex items-center gap-1">
                  <ClockIcon className="w-3 h-3" />
                  Listed {new Date(listing.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {listing.views_count != null && listing.views_count > 0 && (
                  <span className="flex items-center gap-1">
                    <EyeIcon className="w-3 h-3" />
                    {listing.views_count} view{listing.views_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Owner Management Panel */}
            {isOwner && (
              <div className="bg-lantern-primary-background rounded-xl ring-1 ring-lantern-primary/20 dark:ring-lantern-primary/30 overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="px-2 py-0.5 bg-lantern-primary text-white text-label tracking-normal font-bold rounded-md">YOU</span>
                  <span className="text-xs text-lantern-primary font-medium">This is your listing</span>
                </div>

                {/* Moderation takedown: read-only for the seller (mirrors MyListingsScreen) */}
                {isMarketplaceListingModerated(listing.status) ? (
                  <div className="mx-3 mb-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40">
                    <span className="inline-block px-1.5 py-0.5 text-label tracking-normal font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 rounded">
                      {MARKETPLACE_LISTING_STATUS_LABELS[listing.status]}
                    </span>
                    <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
                      {marketplaceListingModerationNotice(listing.status)}
                      {listing.takedown_reason ? (
                        <>
                          {' '}
                          <span className="font-semibold">Reason given:</span> {listing.takedown_reason}.
                        </>
                      ) : null}{' '}
                      Contact {SUPPORT_EMAIL} if you think this is a mistake.
                    </p>
                    {listing.appeal_status && listing.appeal_status !== 'none' ? (
                      <p className="mt-1.5 text-[11px] font-semibold text-lantern-text-secondary">
                        {LISTING_APPEAL_STATUS_LABELS[listing.appeal_status]}
                        {listing.appeal_status === 'requested' ? ' — a reviewer will reply in your notifications.' : ''}
                      </p>
                    ) : canAppealListing(listing) ? (
                      <button
                        type="button"
                        onClick={() => setShowAppealForm(true)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-lantern-primary hover:underline"
                      >
                        <ScaleIcon className="w-3.5 h-3.5" aria-hidden />
                        Appeal this takedown
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Stats row */}
                {sellerStats && (
                  <div className="flex items-center gap-4 px-3 pb-2 text-xs text-lantern-primary">
                    <span className="flex items-center gap-1">
                      <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
                      {sellerStats.totalListings} published
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckBadgeIcon className="w-3.5 h-3.5" />
                      {sellerStats.soldCount} sold
                    </span>
                    {negotiationHistory.length > 0 && (
                      <span className="flex items-center gap-1">
                        <CurrencyDollarIcon className="w-3.5 h-3.5" />
                        {negotiationHistory.length} offer events
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons (hidden once moderation has locked the listing) */}
                {isMarketplaceListingEditable(listing.status) ? (
                  <div className="flex items-center gap-2 px-3 pb-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); onNavigate('EditMarketplaceListing', { listing }); }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                    >
                      <PencilSquareIcon className="w-3.5 h-3.5" />
                      Edit Listing
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBoostListing(); }}
                      disabled={boostingListing}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-lantern-surface text-lantern-primary text-xs font-semibold rounded-lg ring-1 ring-lantern-primary/20 dark:ring-lantern-primary/30 hover:bg-lantern-primary-background transition-colors"
                    >
                      {boostingListing ? 'Boosting...' : 'Boost Listing'}
                    </button>
                  </div>
                ) : null}

                {negotiationHistory.length > 0 && (
                  <div className="px-3 pb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-lantern-primary mb-1.5">Negotiation Timeline</p>
                    <div className="max-h-24 overflow-y-auto space-y-1.5">
                      {negotiationHistory.slice(-5).map((offer: any) => (
                        <div key={offer.id} className="text-[11px] text-lantern-primary bg-lantern-surface/70 dark:bg-lantern-surface/70 rounded-md px-2 py-1">
                          {new Date(offer.created_at).toLocaleDateString()} · ₦{Number(offer.amount || 0).toLocaleString()} · {offer.status}
                          {offer.parent_offer_id ? ' · counter' : ' · initial'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 sm:space-y-2.5 pt-2 rounded-2xl border border-lantern-border bg-lantern-surface p-3 shadow-sm">
              {listing.status === 'reserved' ? (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Sale in progress</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    This listing is reserved for an open order. It will leave Explore again after the sale completes, or return if the order is cancelled.
                  </p>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => onNavigate('MarketplaceOrders')}
                      className="mt-2 text-xs font-semibold text-lantern-primary hover:underline"
                    >
                      Open orders
                    </button>
                  ) : null}
                </div>
              ) : null}
              {/* Sold out (quantity 0): the buy/cart/offer CTAs and coupon box are
                  gated off above; mirror the reserved treatment and leave chat open. */}
              {!isOwner &&
                listing.status !== 'reserved' &&
                listing.price &&
                listing.price > 0 &&
                !(isDigital && digitalOwned) &&
                isSoldOut && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 space-y-2">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">Sold out</p>
                  <p className="text-xs text-red-800 dark:text-red-300">
                    Every unit of this listing has been sold. Message the seller to ask whether
                    they'll restock.
                  </p>
                  <button
                    onClick={handleContactSeller}
                    className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                  >
                    <ChatBubbleLeftIcon className="w-4 h-4" />
                    Contact Seller
                  </button>
                </div>
              )}
              {/* Digital products (question banks, study packs): download/own panel replaces physical CTAs. */}
              {isDigital && (
                <div className="p-3 rounded-xl bg-lantern-primary-background border border-lantern-primary/20 text-xs sm:text-sm text-lantern-text-secondary">
                  {isStudyPack ? (
                    <>
                      <span className="font-semibold text-lantern-primary">Digital study pack</span>
                      {studyPack && summarizeStudyPackCounts(studyPack.counts)
                        ? ` · ${summarizeStudyPackCounts(studyPack.counts)}`
                        : ''}{' '}
                      · delivered instantly to your Library on all your devices
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-lantern-primary">Digital question bank</span>
                      {questionBank ? ` · ${questionBank.questionCount} questions` : ''} · delivered
                      instantly to Offline Mode on all your devices
                    </>
                  )}
                </div>
              )}
              {isDigital && !isOwner && digitalOwned && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 space-y-2">
                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                    You own this {isStudyPack ? 'study pack' : 'question bank'}
                  </p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    {isStudyPack
                      ? 'Find it in your Library — notes, flashcards and questions.'
                      : 'Find it under Offline Mode → Downloaded Test Bundles.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDownloadDigital()}
                    disabled={downloadingBank}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                  >
                    {downloadingBank ? 'Downloading…' : 'Download again'}
                  </button>
                </div>
              )}
              {isDigital &&
                !isOwner &&
                !digitalOwned &&
                !(listing.price && listing.price > 0) && (
                  <button
                    type="button"
                    onClick={() => void handleDownloadDigital()}
                    disabled={downloadingBank}
                    className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-primary/50 text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                  >
                    <CheckBadgeIcon className="w-4 h-4" />
                    {downloadingBank ? 'Downloading…' : 'Download free'}
                  </button>
                )}

              {/* Free / unpriced physical listings: chat is the only path, so it stays primary. */}
              {!isDigital && !isOwner && listing.status !== 'reserved' && !(listing.price && listing.price > 0) && (
                <button
                  onClick={handleContactSeller}
                  className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                >
                  <ChatBubbleLeftIcon className="w-4 h-4" />
                  Contact Seller
                </button>
              )}
              {!isOwner && listing.status !== 'reserved' && listing.price && listing.price > 0 && listing.quantity != null && listing.quantity > 0 && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-lantern-background-secondary/50 border border-lantern-border">
                  <div>
                    <p className="text-xs font-semibold text-lantern-text-secondary">Quantity</p>
                    <p className="text-[11px] text-lantern-text-tertiary mt-0.5">{listing.quantity} available</p>
                  </div>
                  <div className="inline-flex items-center rounded-lg border border-lantern-border overflow-hidden bg-lantern-surface">
                    <button
                      type="button"
                      className="px-3 py-2 text-sm hover:bg-lantern-background-secondary disabled:opacity-40"
                      disabled={selectedQuantity <= 1}
                      onClick={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="px-3 py-2 text-sm font-semibold min-w-[2.5rem] text-center">
                      {selectedQuantity}
                    </span>
                    <button
                      type="button"
                      className="px-3 py-2 text-sm hover:bg-lantern-background-secondary disabled:opacity-40"
                      disabled={selectedQuantity >= listing.quantity}
                      onClick={() =>
                        setSelectedQuantity((q) => Math.min(Number(listing.quantity), q + 1))
                      }
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
              {!isOwner && listing.status !== 'reserved' && listing.price && listing.price > 0 && !(isDigital && digitalOwned) && !isSoldOut && (
                <div className="p-3 rounded-xl bg-lantern-background-secondary/50 border border-lantern-border space-y-2">
                  <p className="text-xs font-semibold text-lantern-text-secondary">Have a coupon?</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => {
                        setCouponCode(e.target.value.toUpperCase());
                        setCouponPreview(null);
                      }}
                      placeholder="Enter code"
                      className="lantern-field flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void handleApplyCoupon()}
                      disabled={validatingCoupon || !couponCode.trim()}
                      className="px-3 py-2 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-primary/50 text-white text-xs font-semibold"
                    >
                      {validatingCoupon ? 'Checking…' : 'Apply'}
                    </button>
                  </div>
                  {couponPreview && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Coupon applied — ₦
                      {(
                        couponPreview.discountAmount *
                        (listing.quantity == null ? 1 : selectedQuantity)
                      ).toLocaleString()}{' '}
                      off. Pay ₦
                      {(
                        couponPreview.finalAmount *
                        (listing.quantity == null ? 1 : selectedQuantity)
                      ).toLocaleString()}
                      .
                    </p>
                  )}
                </div>
              )}
              {/* Purchase actions, strongest first: Buy Now is the one path with
                  buyer protection, so it leads; cart and offer are secondary;
                  chat is the fallback, not the headline. */}
              {!isOwner && listing.status !== 'reserved' && listing.price && listing.price > 0 && !(isDigital && digitalOwned) && !isSoldOut && (
                <>
                  <button
                    onClick={handleBuyNow}
                    disabled={buyingNow}
                    className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-primary/50 text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                  >
                    <CheckBadgeIcon className="w-4 h-4" />
                    {buyingNow
                      ? 'Processing Purchase...'
                      : (() => {
                          const qty = listing.quantity == null ? 1 : selectedQuantity;
                          const unit =
                            couponPreview?.finalAmount ??
                            pricing?.effective ??
                            listing.price;
                          if (unit == null) return 'Buy Now';
                          return `Buy Now · ₦${(unit * qty).toLocaleString()}${
                            qty > 1 ? ` (${qty})` : ''
                          }`;
                        })()}
                  </button>

                  {/* Digital banks are fixed-price with instant delivery — no cart, no offers. */}
                  {!isDigital && (
                    <div className="flex gap-2 sm:gap-2.5">
                      <button
                        type="button"
                        onClick={() => void handleAddToCart()}
                        disabled={addingToCart || buyingNow}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 sm:py-3 bg-lantern-surface text-lantern-primary ring-1 ring-lantern-primary/30 hover:bg-lantern-primary-background disabled:opacity-50 rounded-xl font-semibold transition-colors duration-150 text-xs sm:text-sm"
                      >
                        <ShoppingBagIcon className="w-4 h-4" />
                        {addingToCart
                          ? 'Adding…'
                          : `Add to cart${
                              listing.quantity != null && selectedQuantity > 1
                                ? ` · ${selectedQuantity}`
                                : ''
                            }`}
                      </button>
                      <button
                        onClick={() => {
                          if (requireAuth()) return;
                          setShowOfferModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 sm:py-3 bg-lantern-surface text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-600/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-xl font-semibold transition-colors duration-150 text-xs sm:text-sm"
                      >
                        <CurrencyDollarIcon className="w-4 h-4" />
                        Make an Offer
                      </button>
                    </div>
                  )}

                  <p className="flex items-start gap-1.5 text-[11px] sm:text-xs text-lantern-text-secondary px-1">
                    <CheckBadgeIcon className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span>
                      <span className="font-semibold text-lantern-text">Buyer protection:</span>{' '}
                      {isStudyPack
                        ? 'pay in the app and your study pack is delivered instantly to your Library.'
                        : isDigital
                          ? 'pay in the app and your question bank is delivered instantly to Offline Mode.'
                          : "pay in the app and Lantern holds your payment until you confirm you received the item. Payments made outside the app aren't covered."}
                    </span>
                  </p>

                  <button
                    onClick={handleContactSeller}
                    className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 text-lantern-text-secondary hover:text-lantern-text ring-1 ring-lantern-border hover:ring-lantern-primary/30 rounded-xl font-medium transition-colors duration-150 text-xs sm:text-sm"
                  >
                    <ChatBubbleLeftIcon className="w-4 h-4" />
                    Ask the seller a question
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Question bank preview — answers are stripped server-side */}
        {isDigital && bankPreview && bankPreview.questions.length > 0 && (
          <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
            <div className="flex items-baseline justify-between gap-3 mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-bold text-lantern-text">Sample questions</h2>
              <p className="text-xs text-lantern-text-tertiary">
                {bankPreview.previewCount} of {bankPreview.questionCount}
              </p>
            </div>
            <ol className="space-y-3">
              {bankPreview.questions.map((question, index) => (
                <li
                  key={question.id || index}
                  className="rounded-xl bg-lantern-background-secondary/50 border border-lantern-border p-3"
                >
                  <p className="text-sm font-medium text-lantern-text">
                    {index + 1}. {question.questionStem || question.text || 'Question'}
                  </p>
                  {question.options && question.options.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {question.options.map((option, optionIndex) => (
                        <li key={option.id || optionIndex} className="text-xs text-lantern-text-secondary">
                          {String.fromCharCode(65 + optionIndex)}. {option.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-lantern-text-tertiary">
              Answers and explanations are included with the full bank
              {questionBank?.owned ? ', which you own.' : '.'}
            </p>
          </div>
        )}

        {/* Study pack preview — a peek at the guide, cards and questions */}
        {isStudyPack && studyPackPreview && (
          <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-lantern-text">What's inside</h2>
              <p className="text-xs text-lantern-text-tertiary">
                {summarizeStudyPackCounts(studyPackPreview.counts)}
              </p>
            </div>

            {studyPackPreview.toc.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-lantern-text-secondary uppercase tracking-wide mb-2">
                  Study guide
                </h3>
                <ul className="space-y-1">
                  {studyPackPreview.toc.slice(0, 8).map((entry, index) => (
                    <li key={entry.anchor || index} className="text-sm text-lantern-text-secondary flex gap-2">
                      <span className="text-lantern-text-tertiary">{index + 1}.</span>
                      {entry.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {studyPackPreview.summaryPreview && (
              <div>
                <h3 className="text-xs font-semibold text-lantern-text-secondary uppercase tracking-wide mb-2">
                  Summary preview
                </h3>
                <p className="text-sm text-lantern-text-secondary whitespace-pre-wrap line-clamp-6">
                  {studyPackPreview.summaryPreview}
                  {studyPackPreview.summaryPreview.length >= 600 ? '…' : ''}
                </p>
              </div>
            )}

            {studyPackPreview.flashcardFronts.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-lantern-text-secondary uppercase tracking-wide mb-2">
                  Sample flashcards
                </h3>
                <ul className="space-y-1.5">
                  {studyPackPreview.flashcardFronts.map((front, index) => (
                    <li
                      key={index}
                      className="text-sm text-lantern-text-secondary rounded-lg bg-lantern-background-secondary/50 border border-lantern-border px-3 py-2"
                    >
                      {front}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {studyPackPreview.questions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-lantern-text-secondary uppercase tracking-wide mb-2">
                  Sample questions
                </h3>
                <ol className="space-y-3">
                  {studyPackPreview.questions.map((question, index) => (
                    <li
                      key={question.id || index}
                      className="rounded-xl bg-lantern-background-secondary/50 border border-lantern-border p-3"
                    >
                      <p className="text-sm font-medium text-lantern-text">
                        {index + 1}. {question.questionStem || question.text || 'Question'}
                      </p>
                      {question.options && question.options.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {question.options.map((option, optionIndex) => (
                            <li key={option.id || optionIndex} className="text-xs text-lantern-text-secondary">
                              {String.fromCharCode(65 + optionIndex)}. {option.text}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <p className="text-xs text-lantern-text-tertiary">
              The full guide, all flashcards and every question — with answers — are included when you
              {digitalOwned ? ' open this pack in your Library.' : ' get this pack.'}
            </p>
          </div>
        )}

        {/* Per-bank leaderboard */}
        {isDigital && leaderboard && (leaderboard.entries.length > 0 || leaderboard.viewerEntry) && (
          <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
            <h2 className="text-base sm:text-lg font-bold text-lantern-text mb-1">Leaderboard</h2>
            <p className="text-xs text-lantern-text-tertiary mb-3">
              Best score per student across offline attempts.
            </p>
            {leaderboard.entries.length > 0 ? (
              <ol className="space-y-1.5">
                {leaderboard.entries.map((entry) => (
                  <li
                    key={entry.userId}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                      entry.isViewer
                        ? 'bg-lantern-primary-background ring-1 ring-lantern-primary/30'
                        : 'bg-lantern-background-secondary/50'
                    }`}
                  >
                    <span className="w-6 text-sm font-bold text-lantern-text-secondary tabular-nums">
                      {entry.rank}
                    </span>
                    <span className="flex-1 min-w-0 text-sm text-lantern-text truncate">
                      {entry.isViewer ? 'You' : entry.name}
                    </span>
                    <span className="text-xs text-lantern-text-tertiary">
                      {entry.correct}/{entry.total}
                    </span>
                    <span className="text-sm font-semibold text-lantern-primary tabular-nums">
                      {entry.scorePct.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-lantern-text-secondary">
                No scores yet — be the first to run this bank offline.
              </p>
            )}
            {leaderboard.viewerEntry &&
            !leaderboard.entries.some((entry) => entry.isViewer) ? (
              <div className="mt-2 pt-2 border-t border-lantern-border flex items-center gap-3 px-3 py-2">
                <span className="w-6 text-sm font-bold text-lantern-text-secondary tabular-nums">
                  {leaderboard.viewerEntry.rank}
                </span>
                <span className="flex-1 text-sm text-lantern-text">You</span>
                <span className="text-sm font-semibold text-lantern-primary tabular-nums">
                  {leaderboard.viewerEntry.scorePct.toFixed(0)}%
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Reviews Section */}
        <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
          <div className="flex items-center justify-between mb-4 sm:mb-5 gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-lantern-text">Reviews</h2>
              <p className="text-sm text-lantern-text-secondary">{reviewSummary.count} review{reviewSummary.count !== 1 ? 's' : ''}</p>
            </div>
            {/* Verified purchases only — the API enforces the same rule. */}
            {canReview ? (
              <button
                onClick={() => setShowReviewForm(true)}
                className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center gap-1.5 transition-colors duration-150 text-sm shadow-sm"
              >
                <StarIcon className="w-4 h-4" />
                Write Review
              </button>
            ) : !isOwner ? (
              <p className="text-xs text-lantern-text-tertiary text-right max-w-[180px]">
                Reviews open after a completed purchase
              </p>
            ) : null}
          </div>

          {reviewSummary.count > 0 && (
            <div className="mb-5 grid gap-4 sm:grid-cols-[minmax(0,11rem)_1fr] items-start">
              <div className="flex flex-col items-start gap-1">
                <p className="text-3xl font-bold text-lantern-text leading-none">
                  {averageRating.toFixed(1)}
                  <span className="text-base font-medium text-lantern-text-tertiary"> / 5</span>
                </p>
                <div className="flex items-center gap-0.5" aria-hidden>
                  {[...Array(5)].map((_, i) => (
                    <StarSolidIcon
                      key={i}
                      className={`w-4 h-4 ${
                        i < Math.round(averageRating) ? 'text-amber-400' : 'text-lantern-border'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-lantern-text-tertiary">
                  {reviewSummary.count} rating{reviewSummary.count !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="space-y-1.5" role="group" aria-label="Filter reviews by star rating">
                {[5, 4, 3, 2, 1].map(star => {
                  const bucketCount = reviewSummary.histogram[star - 1] ?? 0;
                  const pct = histogramPct[star - 1] ?? 0;
                  const active = reviewStarFilter === star;
                  const clickable = bucketCount > 0 || active;
                  return (
                    <button
                      key={star}
                      type="button"
                      disabled={!clickable}
                      onClick={() => setReviewStarFilter(active ? null : star)}
                      aria-pressed={active}
                      aria-label={`${star} star: ${bucketCount} review${bucketCount !== 1 ? 's' : ''} (${pct}%)`}
                      className={`w-full flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors ${
                        clickable ? 'hover:bg-lantern-background-secondary cursor-pointer' : 'opacity-40 cursor-default'
                      } ${active ? 'bg-lantern-primary/10' : ''}`}
                    >
                      <span className="w-10 shrink-0 text-left text-xs text-lantern-text-secondary">{star} star</span>
                      <span className="flex-1 h-2.5 rounded-full bg-lantern-background-secondary overflow-hidden">
                        <span
                          className={`block h-full rounded-full ${active ? 'bg-lantern-primary' : 'bg-amber-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-lantern-text-tertiary">{pct}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(reviewSummary.count > 1 || reviewStarFilter !== null) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {reviewSummary.count > 1 && (
                <>
                  <label htmlFor="marketplace-review-sort" className="text-xs font-medium text-lantern-text-secondary">
                    Sort by
                  </label>
                  <select
                    id="marketplace-review-sort"
                    value={reviewSort}
                    onChange={e => setReviewSort(e.target.value as ReviewSortOption)}
                    className="px-2.5 py-1.5 rounded-lg bg-lantern-surface border border-lantern-border text-lantern-text text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                  >
                    {(Object.keys(REVIEW_SORT_LABELS) as ReviewSortOption[]).map(option => (
                      <option key={option} value={option}>
                        {REVIEW_SORT_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {reviewStarFilter !== null && (
                <button
                  type="button"
                  onClick={() => setReviewStarFilter(null)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-lantern-primary/10 text-lantern-primary text-xs font-medium hover:bg-lantern-primary/20 transition-colors"
                >
                  {reviewStarFilter}-star only
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {reviews.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-14 h-14 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-2xl flex items-center justify-center mb-3">
                <StarIcon className="w-7 h-7 text-lantern-text-tertiary" />
              </div>
              <p className="text-sm text-lantern-text-secondary">
                {canReview ? 'No reviews yet. Be the first to leave one!' : 'No reviews yet.'}
              </p>
            </div>
          ) : displayReviews.length === 0 ? (
            <p className="py-6 text-center text-sm text-lantern-text-secondary">
              No {reviewStarFilter}-star reviews.{' '}
              <button
                type="button"
                onClick={() => setReviewStarFilter(null)}
                className="text-lantern-primary font-medium hover:underline"
              >
                Show all reviews
              </button>
            </p>
          ) : (
            <div className="space-y-3">
              {displayReviews.map(review => (
                <div key={review.id} className="border-b border-lantern-border pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-lantern-primary-background dark:bg-lantern-primary-dark/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <UserIcon className="w-4 h-4 text-lantern-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-lantern-text flex items-center gap-1.5 flex-wrap">
                          {review.reviewer?.name || review.reviewer?.username || 'User'}
                          {review.verifiedPurchase && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-label tracking-normal font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckBadgeIcon className="w-3 h-3" aria-hidden />
                              Verified purchase
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-0.5">
                          {[...Array(5)].map((_, i) => (
                            <StarSolidIcon
                              key={i}
                              className={`w-3 h-3 ${
                                i < review.rating ? 'text-amber-400' : 'text-lantern-text-secondary dark:text-lantern-text-secondary'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-lantern-text-tertiary flex-shrink-0">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-lantern-text-secondary mt-2 ml-[42px]">
                      {review.comment}
                    </p>
                  )}
                  {typeof review.helpfulCount === 'number' && (
                    <div className="mt-2 ml-[42px]">
                      {review.reviewer_id === currentUser?.id ? (
                        review.helpfulCount > 0 ? (
                          <span className="text-xs text-lantern-text-tertiary">
                            {review.helpfulCount} {review.helpfulCount === 1 ? 'person' : 'people'} found this helpful
                          </span>
                        ) : null
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleHelpful(review)}
                          disabled={votingReviewId === review.id}
                          aria-pressed={!!review.viewerMarkedHelpful}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${
                            review.viewerMarkedHelpful
                              ? 'border-lantern-primary bg-lantern-primary/10 text-lantern-primary font-medium'
                              : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-primary/40 hover:text-lantern-text'
                          }`}
                        >
                          Helpful{review.helpfulCount > 0 ? ` (${review.helpfulCount})` : ''}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Related listings */}
        {similarListings.length > 0 && (
          <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
            <h2 className="text-base sm:text-lg font-bold text-lantern-text mb-3 sm:mb-4">Related on campus</h2>
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
              {similarListings.map(item => (
                <button
                  key={item.id}
                  onClick={() => onNavigate('MarketplaceListingDetail', { listingId: item.id })}
                  className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-xl overflow-hidden ring-1 ring-lantern-border/60 hover:ring-lantern-primary/30 dark:hover:ring-lantern-primary/40 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-8 h-8 text-lantern-text-tertiary" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-lantern-text line-clamp-1 group-hover:text-lantern-primary dark:group-hover:text-lantern-primary-light transition-colors">{item.title}</p>
                    <p className="text-sm font-bold text-lantern-primary mt-0.5">{item.price ? `₦${item.price.toLocaleString()}` : 'Free'}</p>
                    {(item.rating_count ?? 0) > 0 && item.rating_avg != null ? (
                      <p className="mt-0.5 flex items-center gap-0.5 text-[11px] text-lantern-text-tertiary">
                        <StarSolidIcon className="w-3 h-3 text-amber-400" aria-hidden />
                        {Number(item.rating_avg).toFixed(1)} ({item.rating_count})
                      </p>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {recentlyViewed.length > 0 && (
          <div className="mt-5 sm:mt-8">
            <MarketplaceListingRail
              title="Recently viewed"
              listings={recentlyViewed}
              onPress={(item) => onNavigate('MarketplaceListingDetail', { listingId: item.id })}
            />
          </div>
        )}
      </div>

      {/* Review Modal */}
      {showReviewForm && (
        <Modal
          isOpen={showReviewForm}
          onClose={() => setShowReviewForm(false)}
          ariaLabelledBy="listing-review-title"
          maxWidthClass="max-w-md"
          panelClassName="!p-0 overflow-hidden rounded-xl"
        >
          <div className="w-full">
            <div className="flex items-center justify-between p-6 border-b border-lantern-border">
              <h3 id="listing-review-title" className="text-lg font-bold text-lantern-text">Write a Review</h3>
              <button
                type="button"
                onClick={() => setShowReviewForm(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors duration-200"
                aria-label="Close review form"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" aria-hidden />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Rating
                </label>
                <div className="flex space-x-1">
                  {[1, 2, 3, 4, 5].map(num => (
                    <button
                      key={num}
                      onClick={() => setReviewForm(prev => ({ ...prev, rating: num }))}
                      className={`p-1 transition-colors duration-200 ${
                        num <= reviewForm.rating ? 'text-yellow-400' : 'text-lantern-text-tertiary'
                      }`}
                    >
                      <StarSolidIcon className="w-6 h-6" />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Comment
                </label>
                <textarea
                  value={reviewForm.comment}
                  onChange={(e) => setReviewForm(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Share your experience with this listing..."
                  rows={4}
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowReviewForm(false)}
                  className="px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddReview}
                  className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg font-semibold transition-colors duration-200"
                >
                  Submit Review
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Report (non-owners): shared modal, reasons from reasonsForTarget('listing') */}
      {showReportForm && !isOwner && (
        <ReportContentModal
          isOpen={showReportForm}
          onClose={() => setShowReportForm(false)}
          targetType="listing"
          targetId={listing.id}
          targetLabel={listing.title}
        />
      )}

      {/* Appeal (owner, moderated listing): one-shot note to the admin appeals queue */}
      {showAppealForm && isOwner && (
        <AppealListingModal
          isOpen={showAppealForm}
          onClose={() => setShowAppealForm(false)}
          listing={listing}
          onAppealed={() => {
            setShowAppealForm(false);
            void loadListingFull();
          }}
        />
      )}

      {/* Contact Seller Modal */}
      {showContactForm && (
        <Modal
          isOpen={showContactForm}
          onClose={() => setShowContactForm(false)}
          ariaLabelledBy="listing-contact-title"
          maxWidthClass="max-w-md"
          loading={contactLoading}
          closeOnBackdrop={!contactLoading}
          panelClassName="!p-0 overflow-hidden rounded-xl"
        >
          <div className="w-full">
            <div className="flex items-center justify-between p-6 border-b border-lantern-border">
              <h3 id="listing-contact-title" className="text-lg font-bold text-lantern-text">Contact Seller</h3>
              <button
                type="button"
                onClick={() => setShowContactForm(false)}
                disabled={contactLoading}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors duration-200 disabled:opacity-50"
                aria-label="Close contact form"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" aria-hidden />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-lg p-4">
                <p className="text-sm text-lantern-text-secondary mb-2">
                  Inquiring about:
                </p>
                <p className="font-semibold text-lantern-text">
                  {listing?.title}
                </p>
                <p className="text-lantern-primary font-medium">
                  {listing?.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Quick Inquiries
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    "Is this still available?",
                    "Can I inspect the item today?",
                    "Is the price negotiable?"
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setContactMessage(preset)}
                      className="px-3 py-1.5 bg-lantern-background-secondary hover:bg-lantern-primary-background dark:bg-lantern-surface-secondary dark:hover:bg-lantern-primary-dark/30 text-lantern-text hover:text-lantern-primary dark:text-lantern-text-tertiary dark:hover:text-lantern-primary-light rounded-full text-xs font-medium border border-lantern-border hover:border-lantern-primary/30 dark:hover:border-lantern-primary/30 transition-all"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Your Message
                </label>
                <textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Hi, I'm interested in this item. Is it still available?"
                  rows={4}
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary resize-none"
                />
              </div>

              {listing?.price && listing.price > 0 ? (
                <p className="text-xs text-lantern-text-secondary bg-lantern-background-secondary/60 rounded-lg px-3 py-2">
                  Tip: pay through the app when you're ready — Lantern holds the payment
                  until you confirm delivery. Payments arranged in chat aren't covered
                  by buyer protection.
                </p>
              ) : null}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowContactForm(false)}
                  className="px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendInquiry}
                  disabled={!contactMessage.trim() || contactLoading}
                  className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors duration-200 flex items-center"
                >
                  {contactLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Sending...
                    </>
                  ) : (
                    <>
                      <ChatBubbleLeftIcon className="w-4 h-4 mr-2" />
                      Send & Start Chat
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {/* Make Offer Modal */}
      {listing && (
        <MakeOfferModal
          isOpen={showOfferModal}
          onClose={() => setShowOfferModal(false)}
          listing={listing}
          onSuccess={() => showToast('Offer submitted! The seller will be notified.')}
        />
      )}

      {lightboxOpen && listing.images && listing.images.length > 0 ? (
        <div
          className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Listing photo"
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={listing.images[currentImageIndex]}
            alt={listing.title}
            className="max-h-[90vh] max-w-full object-contain rounded-lg"
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-white/90 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      ) : null}

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white pointer-events-none transition-all duration-200 ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default MarketplaceListingDetailScreen;