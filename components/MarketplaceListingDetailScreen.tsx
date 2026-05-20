import React, { useState, useEffect } from 'react';
import {
  fetchMarketplaceListing,
  addMarketplaceReview,
  reportMarketplaceListing,
  createInquiry,
  addToFavorites,
  removeFromFavorites,
  checkIfFavorited,
  fetchSimilarListings,
  addRecentlyViewed,
  fetchSellerStats
} from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { MarketplaceListing, MarketplaceReview } from '../types';
import MakeOfferModal from './MakeOfferModal';
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
}

const MarketplaceListingDetailScreen: React.FC<MarketplaceListingDetailScreenProps> = ({
  listingId,
  onNavigate,
  onBack
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
  const [similarLoading, setSimilarLoading] = useState(false);
  const [sellerStats, setSellerStats] = useState<{ totalListings: number; soldCount: number } | null>(null);
  const { currentUser } = useAuthStore();
  const isOwner = listing?.user_id === currentUser?.id || listing?.seller_id === currentUser?.id;

  useEffect(() => {
    loadListing();
    loadFavoriteStatus();
    loadSimilarListings();
    addRecentlyViewed(listingId);
  }, [listingId]);

  useEffect(() => {
    if (isOwner) {
      loadSellerStats();
    }
  }, [isOwner]);

  const loadSellerStats = async () => {
    try {
      const stats = await fetchSellerStats(currentUser?.id);
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

  const loadSimilarListings = async () => {
    setSimilarLoading(true);
    try {
      const data = await fetchSimilarListings(listingId);
      setSimilarListings(data);
    } catch (error) {
      console.error('Error loading similar listings:', error);
    } finally {
      setSimilarLoading(false);
    }
  };

  const loadFavoriteStatus = async () => {
    try {
      const favorited = await checkIfFavorited(listingId);
      setIsFavorited(favorited);
    } catch (error) {
      console.error('Error checking favorite status:', error);
    }
  };

  const loadListing = async () => {
    setLoading(true);
    try {
      const data = await fetchMarketplaceListing(listingId);
      setListing(data);
      setReviews(data.reviews || []);
    } catch (error) {
      console.error('Error loading listing:', error);
    } finally {
      setLoading(false);
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
      alert('Failed to add review. Please try again.');
    }
  };

  const handleReport = async () => {
    if (!listing) return;

    try {
      await reportMarketplaceListing(listing.id, reportForm);
      setReportForm({ reason: '', details: '' });
      setShowReportForm(false);
      alert('Report submitted successfully.');
    } catch (error) {
      console.error('Error reporting listing:', error);
      alert('Failed to submit report. Please try again.');
    }
  };

  const handleContactSeller = () => {
    if (!listing) return;
    setShowContactForm(true);
  };

  const handleSendInquiry = async () => {
    if (!listing || !contactMessage.trim()) return;

    setContactLoading(true);
    try {
      // Create inquiry to link the conversation to the listing
      await createInquiry(listing.id, contactMessage.trim());
      
      // Navigate to direct messages with seller
      onNavigate('DirectMessages', { userId: listing.seller_id });
      
      setShowContactForm(false);
      setContactMessage('');
    } catch (error) {
      console.error('Error sending inquiry:', error);
      alert('Failed to send inquiry. Please try again.');
    } finally {
      setContactLoading(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      if (isFavorited) {
        await removeFromFavorites(listingId);
      } else {
        await addToFavorites(listingId);
      }
      setIsFavorited(!isFavorited);
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const nextImage = () => {
    if (!listing?.images) return;
    setCurrentImageIndex((prev) => (prev + 1) % listing.images.length);
  };

  const prevImage = () => {
    if (!listing?.images) return;
    setCurrentImageIndex((prev) => (prev - 1 + listing.images.length) % listing.images.length);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600 mx-auto mb-3"></div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading listing...</p>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ExclamationTriangleIcon className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-1">Listing not found</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">The listing you're looking for doesn't exist or has been removed.</p>
          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold flex items-center gap-2 mx-auto transition-colors duration-150 text-sm shadow-sm"
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

  return (
    <div className="flex-1 bg-slate-50 dark:bg-slate-900 overflow-y-auto">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 sm:gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium transition-colors duration-150 px-2 py-1.5 -ml-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Marketplace</span>
            <span className="sm:hidden">Back</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleFavorite}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorited ? (
                <HeartSolidIcon className="w-5 h-5 text-red-500" />
              ) : (
                <HeartIcon className="w-5 h-5 text-slate-400" />
              )}
            </button>
            <button
              onClick={() => {
                const url = window.location.href;
                const text = `Check out "${listing.title}" on Lantern Study Marketplace`;
                if (navigator.share) {
                  navigator.share({ title: listing.title, text, url }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(`${text}: ${url}`).then(() => {
                    alert('Link copied to clipboard!');
                  }).catch(() => {
                    alert('Could not copy link.');
                  });
                }
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label="Share listing"
            >
              <ShareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowReportForm(true)}
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label="Report listing"
            >
              <FlagIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
          {/* Images Section */}
          <div className="space-y-3">
            <div className="relative bg-slate-100 dark:bg-slate-700/50 rounded-2xl overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-700/60">
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
                        className="absolute left-3 top-1/2 transform -translate-y-1/2 p-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-colors duration-150 shadow-sm"
                        aria-label="Previous image"
                      >
                        <ArrowLeftIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={nextImage}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-colors duration-150 shadow-sm"
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
                              index === currentImageIndex ? 'bg-white w-5' : 'bg-white/50 hover:bg-white/70'
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
                    <ShoppingBagIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 dark:text-slate-500">No images available</p>
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
                        ? 'ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900'
                        : 'ring-transparent hover:ring-slate-300 dark:hover:ring-slate-600'
                    }`}
                    aria-label={`Select image ${index + 1}`}
                  >
                    <img src={image} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details Section */}
          <div className="space-y-4 sm:space-y-5">
            {/* Title and Price */}
            <div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2 sm:mb-3">
                {listing.title}
              </h1>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                </span>
                <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                  <StarIcon className="w-4 h-4 text-amber-400 fill-current" />
                  <span className="font-semibold">{averageRating.toFixed(1)}</span>
                  <span className="text-slate-400">({reviews.length})</span>
                </div>
              </div>
            </div>

            {/* Meta Information */}
            <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                <MapPinIcon className="w-3.5 h-3.5" />
                {listing.location || 'Not specified'}
              </span>
              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                <ClockIcon className="w-3.5 h-3.5" />
                {new Date(listing.created_at).toLocaleDateString()}
              </span>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5 uppercase tracking-wide">Description</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {listing.description || 'No description provided.'}
              </p>
            </div>

            {/* Category-Specific Details */}
            {listing.category_specific_fields && Object.keys(listing.category_specific_fields).filter(k => k !== 'parentCategory').length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2 uppercase tracking-wide">Details</h3>
                <div className="grid grid-cols-2 gap-2">
                  {listing.category_specific_fields.condition && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Condition</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 capitalize">{listing.category_specific_fields.condition}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.courseCode && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Course Code</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.courseCode}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.year && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Year</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.year}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.semester && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Semester</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.semester}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.isbn && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">ISBN</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.isbn}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.edition && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Edition</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.edition}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.bedrooms != null && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Bedrooms</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.bedrooms}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.furnished != null && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Furnished</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.furnished ? 'Yes' : 'No'}</p>
                    </div>
                  )}
                  {listing.category_specific_fields.distanceToCampus && (
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Distance to Campus</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{listing.category_specific_fields.distanceToCampus}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Seller Information */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 ring-1 ring-slate-200/60 dark:ring-slate-700/60">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">Seller</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => onNavigate('SellerProfile', { userId: listing.user_id || listing.seller_id })}
                    className="font-semibold text-sm text-indigo-600 dark:text-indigo-400 hover:underline truncate block text-left"
                  >
                    {listing.seller?.name || listing.profiles?.name || 'Anonymous Seller'}
                  </button>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
              <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
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
              <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-xl ring-1 ring-indigo-200 dark:ring-indigo-700/50 overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-md">YOU</span>
                  <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">This is your listing</span>
                </div>

                {/* Stats row */}
                {sellerStats && (
                  <div className="flex items-center gap-4 px-3 pb-2 text-xs text-indigo-600 dark:text-indigo-400">
                    <span className="flex items-center gap-1">
                      <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
                      {sellerStats.totalListings} published
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckBadgeIcon className="w-3.5 h-3.5" />
                      {sellerStats.soldCount} sold
                    </span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 px-3 pb-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigate('EditMarketplaceListing', { listing }); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" />
                    Edit Listing
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigate('MyListings'); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 text-xs font-semibold rounded-lg ring-1 ring-indigo-200 dark:ring-indigo-700 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    Manage All →
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 sm:space-y-2.5 pt-2">
              {!isOwner && (
                <button
                  onClick={handleContactSeller}
                  className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                >
                  <ChatBubbleLeftIcon className="w-4 h-4" />
                  Contact Seller
                  {listing.price && listing.price > 0 && (
                    <span className="ml-1 opacity-80">· ₦{listing.price?.toLocaleString()}</span>
                  )}
                </button>
              )}
              {!isOwner && listing.price && listing.price > 0 && (
                <button
                  onClick={() => setShowOfferModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition-colors duration-150 shadow-sm text-xs sm:text-sm"
                >
                  <CurrencyDollarIcon className="w-4 h-4" />
                  Make an Offer
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-5 sm:mt-8 bg-white dark:bg-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-slate-200/60 dark:ring-slate-700/60">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200">Reviews</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => setShowReviewForm(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold flex items-center gap-1.5 transition-colors duration-150 text-sm shadow-sm"
            >
              <StarIcon className="w-4 h-4" />
              Write Review
            </button>
          </div>

          {reviews.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mb-3">
                <StarIcon className="w-7 h-7 text-slate-300 dark:text-slate-600" />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">No reviews yet. Be the first to leave one!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="border-b border-slate-100 dark:border-slate-700 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                        <UserIcon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                          {review.reviewer?.name || 'Anonymous'}
                        </p>
                        <div className="flex items-center gap-0.5">
                          {[...Array(5)].map((_, i) => (
                            <StarSolidIcon
                              key={i}
                              className={`w-3 h-3 ${
                                i < review.rating ? 'text-amber-400' : 'text-slate-200 dark:text-slate-600'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 ml-[42px]">
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
          <div className="mt-5 sm:mt-8 bg-white dark:bg-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 ring-1 ring-slate-200/60 dark:ring-slate-700/60">
            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200 mb-3 sm:mb-4">You Might Also Like</h2>
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
              {similarListings.map(item => (
                <button
                  key={item.id}
                  onClick={() => onNavigate('MarketplaceListingDetail', { listingId: item.id })}
                  className="bg-slate-50 dark:bg-slate-700/50 rounded-xl overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300/60 dark:hover:ring-indigo-600/40 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700">
                    {item.images && item.images.length > 0 ? (
                      <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{item.title}</p>
                    <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{item.price ? `₦${item.price.toLocaleString()}` : 'Free'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {showReviewForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Write a Review</h3>
              <button
                onClick={() => setShowReviewForm(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-200"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Rating
                </label>
                <div className="flex space-x-1">
                  {[1, 2, 3, 4, 5].map(num => (
                    <button
                      key={num}
                      onClick={() => setReviewForm(prev => ({ ...prev, rating: num }))}
                      className={`p-1 transition-colors duration-200 ${
                        num <= reviewForm.rating ? 'text-yellow-400' : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      <StarSolidIcon className="w-6 h-6" />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Comment
                </label>
                <textarea
                  value={reviewForm.comment}
                  onChange={(e) => setReviewForm(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Share your experience with this listing..."
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowReviewForm(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddReview}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors duration-200"
                >
                  Submit Review
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Report Listing</h3>
              <button
                onClick={() => setShowReportForm(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-200"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Reason for report
                </label>
                <select
                  value={reportForm.reason}
                  onChange={(e) => setReportForm(prev => ({ ...prev, reason: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Select a reason</option>
                  <option value="spam">Spam or misleading</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="scam">Potential scam</option>
                  <option value="other">Wrong category</option>
                  <option value="other">Prohibited item</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Additional details
                </label>
                <textarea
                  value={reportForm.details}
                  onChange={(e) => setReportForm(prev => ({ ...prev, details: e.target.value }))}
                  placeholder="Provide more information about the issue..."
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowReportForm(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReport}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors duration-200"
                >
                  Submit Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Seller Modal */}
      {showContactForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Contact Seller</h3>
              <button
                onClick={() => setShowContactForm(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-200"
              >
                <ArrowLeftIcon className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                  Inquiring about:
                </p>
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  {listing?.title}
                </p>
                <p className="text-indigo-600 dark:text-indigo-400 font-medium">
                  {listing?.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Your Message
                </label>
                <textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Hi, I'm interested in this item. Is it still available?"
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowContactForm(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendInquiry}
                  disabled={!contactMessage.trim() || contactLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors duration-200 flex items-center"
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
        </div>
      )}
      {/* Make Offer Modal */}
      {listing && (
        <MakeOfferModal
          isOpen={showOfferModal}
          onClose={() => setShowOfferModal(false)}
          listing={listing}
          onSuccess={() => alert('Offer submitted! The seller will be notified.')}
        />
      )}
    </div>
  );
};

export default MarketplaceListingDetailScreen;