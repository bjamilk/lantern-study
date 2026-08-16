import React, { useState, useEffect, useRef } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import {
  fetchMarketplaceListingFull,
  fetchNegotiationHistory,
  addMarketplaceReview,
  reportMarketplaceListing,
  createInquiry,
  addToFavorites,
  removeFromFavorites,
  addRecentlyViewed,
  fetchSellerStats,
  boostMarketplaceListing,
  buyMarketplaceListingNow,
  addToMarketplaceCart,
  validateMarketplaceCoupon,
  fetchPickupNudge,
} from '../services/supabase';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import { generateListingLink, formatCampusLabel } from '@lantern/shared';
import { usePageSeo } from '../hooks/usePageSeo';
import MarketplaceComplianceBanner from './marketplace/MarketplaceComplianceBanner';
import SaleCountdown from './marketplace/SaleCountdown';
import { useAuthStore } from '../stores/authStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import { MarketplaceListing, MarketplaceReview, MarketplacePickupNudge } from '../types';
import MakeOfferModal from './MakeOfferModal';
import Modal from './ui/Modal';
import {
  ArrowLeftIcon,
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
  CheckBadgeIcon
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
  const [loading, setLoading] = useState(true);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '' });
  const [reportForm, setReportForm] = useState({ reason: '', details: '' });
  const [isFavorited, setIsFavorited] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [similarListings, setSimilarListings] = useState<MarketplaceListing[]>([]);
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
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
      setReviews(prev => [newReview, ...prev]);
      setReviewForm({ rating: 5, comment: '' });
      setShowReviewForm(false);
    } catch (error) {
      console.error('Error adding review:', error);
      showToast('Failed to add review. Please try again.', 'error');
    }
  };

  /**
   * The reports table only accepts scam/spam/inappropriate/other, so the more
   * specific UI choices ride on 'other' with the label folded into details —
   * admins can still tell a wrong-category report from a prohibited-item one.
   */
  const REPORT_REASON_OPTIONS: Array<{ value: string; label: string; dbReason: string }> = [
    { value: 'spam', label: 'Spam or misleading', dbReason: 'spam' },
    { value: 'inappropriate', label: 'Inappropriate content', dbReason: 'inappropriate' },
    { value: 'scam', label: 'Potential scam', dbReason: 'scam' },
    { value: 'wrong_category', label: 'Wrong category', dbReason: 'other' },
    { value: 'prohibited_item', label: 'Prohibited item', dbReason: 'other' },
    { value: 'other', label: 'Other', dbReason: 'other' },
  ];

  const handleReport = async () => {
    if (!listing) return;

    const option = REPORT_REASON_OPTIONS.find(o => o.value === reportForm.reason);
    if (!option) return;
    const details =
      option.dbReason === option.value
        ? reportForm.details
        : `[${option.label}] ${reportForm.details}`.trim();

    try {
      await reportMarketplaceListing(listing.id, { reason: option.dbReason, details });
      setReportForm({ reason: '', details: '' });
      setShowReportForm(false);
      showToast('Report submitted successfully.');
    } catch (error) {
      console.error('Error reporting listing:', error);
      showToast('Failed to submit report. Please try again.', 'error');
    }
  };

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
    const serviceFee = Math.round(itemTotal * 0.05 * 100) / 100;
    const payAmount = Math.round((itemTotal + serviceFee) * 100) / 100;
    const confirmed = await confirmDialog({
      title: 'Confirm purchase',
      message: `Confirm purchase of ${listing.title}${qty > 1 ? ` ×${qty}` : ''}?\n\nItem: ₦${itemTotal.toLocaleString()}\nService charge (5%): ₦${serviceFee.toLocaleString()}\nTotal: ₦${payAmount.toLocaleString()}`,
      confirmLabel: 'Pay now',
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

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  const pricing = listing ? resolveListingDisplayPrice(listing) : null;

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
            {!guestMode && (
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
      </div>

      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
          {/* Images Section */}
          <div className="space-y-3">
            <div className="relative bg-lantern-background-secondary dark:bg-lantern-surface-secondary/50 rounded-2xl overflow-hidden ring-1 ring-lantern-border/60">
              {listing.images && listing.images.length > 0 ? (
                <>
                  <img
                    src={listing.images[currentImageIndex]}
                    alt={listing.title}
                    className="w-full h-56 sm:h-72 md:h-96 object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
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

          {/* Details Section */}
          <div className="space-y-4 sm:space-y-5">
            {/* Title and Price */}
            <div>
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

            {/* Category-Specific Details */}
            {listing.category_specific_fields && Object.keys(listing.category_specific_fields).filter(k => k !== 'parentCategory').length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-lantern-text mb-2 uppercase tracking-wide">Details</h3>
                <div className="grid grid-cols-2 gap-2">
                  {listing.category_specific_fields.condition && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Condition</span>
                      <p className="text-sm font-medium text-lantern-text capitalize">{listing.category_specific_fields.condition}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.courseCode && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Course Code</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.courseCode}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.year && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Year</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.year}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.semester && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Semester</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.semester}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.isbn && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">ISBN</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.isbn}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.edition && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Edition</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.edition}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.bedrooms != null && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Bedrooms</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.bedrooms}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.furnished != null && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Furnished</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.furnished ? 'Yes' : 'No'}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.distanceToCampus && (
                    <div className="bg-lantern-background-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-lantern-text-secondary">Distance to Campus</span>
                      <p className="text-sm font-medium text-lantern-text">{listing.category_specific_fields.distanceToCampus}</p>
                    </div>
                  )}
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
                  <button
                    onClick={() => onNavigate('SellerProfile', { userId: listing.user_id || listing.seller_id })}
                    className="font-semibold text-sm text-lantern-primary hover:underline truncate block text-left"
                  >
                    {listing.seller?.name || listing.profiles?.name || 'Anonymous Seller'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('SellerProfile', { userId: listing.user_id || listing.seller_id })}
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
                  <span className="px-2 py-0.5 bg-lantern-primary text-white text-[10px] font-bold rounded-md">YOU</span>
                  <span className="text-xs text-lantern-primary font-medium">This is your listing</span>
                </div>

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

                {/* Action buttons */}
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
            <div className="space-y-2 sm:space-y-2.5 pt-2">
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
              {/* Free / unpriced listings: chat is the only path, so it stays primary. */}
              {!isOwner && listing.status !== 'reserved' && !(listing.price && listing.price > 0) && (
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
              {!isOwner && listing.status !== 'reserved' && listing.price && listing.price > 0 && (
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
              {!isOwner && listing.status !== 'reserved' && listing.price && listing.price > 0 && (
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

                  <p className="flex items-start gap-1.5 text-[11px] sm:text-xs text-lantern-text-secondary px-1">
                    <CheckBadgeIcon className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span>
                      <span className="font-semibold text-lantern-text">Buyer protection:</span>{' '}
                      pay in the app and Lantern holds your payment until you confirm
                      you received the item. Payments made outside the app aren't covered.
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

        {/* Reviews Section */}
        <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
          <div className="flex items-center justify-between mb-4 sm:mb-5 gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-lantern-text">Reviews</h2>
              <p className="text-sm text-lantern-text-secondary">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
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

          {reviews.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-14 h-14 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-2xl flex items-center justify-center mb-3">
                <StarIcon className="w-7 h-7 text-lantern-text-tertiary" />
              </div>
              <p className="text-sm text-lantern-text-secondary">
                {canReview ? 'No reviews yet. Be the first to leave one!' : 'No reviews yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="border-b border-lantern-border pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-lantern-primary-background dark:bg-lantern-primary-dark/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <UserIcon className="w-4 h-4 text-lantern-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-lantern-text">
                          {review.reviewer?.name || review.reviewer?.username || 'User'}
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
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Similar Listings */}
        {similarListings.length > 0 && (
          <div className="mt-5 sm:mt-8 bg-lantern-surface rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-lantern-border/60">
            <h2 className="text-base sm:text-lg font-bold text-lantern-text mb-3 sm:mb-4">You Might Also Like</h2>
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
                  </div>
                </button>
              ))}
            </div>
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

      {/* Report Modal */}
      {showReportForm && (
        <Modal
          isOpen={showReportForm}
          onClose={() => setShowReportForm(false)}
          ariaLabelledBy="listing-report-title"
          maxWidthClass="max-w-md"
          panelClassName="!p-0 overflow-hidden rounded-xl"
        >
          <div className="w-full">
            <div className="flex items-center justify-between p-6 border-b border-lantern-border">
              <h3 id="listing-report-title" className="text-lg font-bold text-lantern-text">Report Listing</h3>
              <button
                type="button"
                onClick={() => setShowReportForm(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors duration-200"
                aria-label="Close report form"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" aria-hidden />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Reason for report
                </label>
                <select
                  value={reportForm.reason}
                  onChange={(e) => setReportForm(prev => ({ ...prev, reason: e.target.value }))}
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text"
                >
                  <option value="">Select a reason</option>
                  {REPORT_REASON_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-lantern-text mb-2">
                  Additional details
                </label>
                <textarea
                  value={reportForm.details}
                  onChange={(e) => setReportForm(prev => ({ ...prev, details: e.target.value }))}
                  placeholder="Provide more information about the issue..."
                  rows={3}
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowReportForm(false)}
                  className="px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReport}
                  disabled={!reportForm.reason}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors duration-200"
                >
                  Submit Report
                </button>
              </div>
            </div>
          </div>
        </Modal>
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