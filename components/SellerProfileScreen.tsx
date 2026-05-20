import React, { useState, useEffect } from 'react';
import { fetchSellerProfile } from '../services/supabase';
import { SellerProfile, MarketplaceListing, MarketplaceReview } from '../types';
import {
  ArrowLeftIcon,
  StarIcon,
  ShoppingBagIcon,
  EyeIcon,
  ChatBubbleLeftEllipsisIcon,
  HeartIcon,
  CheckBadgeIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';

interface SellerProfileScreenProps {
  userId: string;
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
}

const SellerProfileScreen: React.FC<SellerProfileScreenProps> = ({ userId, onBack, onNavigate }) => {
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSellerProfile(userId);
      setProfile(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load seller profile');
    } finally {
      setLoading(false);
    }
  };

  const memberSince = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) =>
      i < Math.round(rating) ? (
        <StarSolidIcon key={i} className="w-4 h-4 text-amber-400" />
      ) : (
        <StarIcon key={i} className="w-4 h-4 text-slate-300 dark:text-slate-600" />
      )
    );
  };

  const handleListingClick = (listing: MarketplaceListing) => {
    onNavigate('MarketplaceListingDetail', { listingId: listing.id });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <p className="text-red-500 text-center mb-4">{error || 'Profile not found'}</p>
        <button onClick={onBack} className="text-indigo-600 font-medium hover:underline">Go Back</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700 px-4 py-5">
        <button onClick={onBack} className="flex items-center gap-1.5 text-indigo-100 hover:text-white mb-4 transition-colors">
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </button>

        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white text-2xl font-bold ring-2 ring-white/30 overflow-hidden flex-shrink-0">
            {profile.user.avatar_url ? (
              <img src={profile.user.avatar_url} alt={profile.user.name} className="w-full h-full object-cover" />
            ) : (
              profile.user.name?.charAt(0)?.toUpperCase() || '?'
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{profile.user.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-0.5">{renderStars(profile.stats.avgRating)}</div>
              <span className="text-sm text-indigo-100">
                {profile.stats.avgRating > 0 ? profile.stats.avgRating.toFixed(1) : 'No ratings'}
                {profile.stats.totalReviews > 0 && ` (${profile.stats.totalReviews})`}
              </span>
            </div>
            <p className="text-xs text-indigo-200 mt-0.5 flex items-center gap-1">
              <ClockIcon className="w-3 h-3" />
              Member since {memberSince(profile.user.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Listings', value: profile.stats.totalListings, icon: ShoppingBagIcon, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400' },
            { label: 'Total Views', value: profile.stats.totalViews, icon: EyeIcon, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400' },
            { label: 'Inquiries', value: profile.stats.totalInquiries, icon: ChatBubbleLeftEllipsisIcon, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' },
          ].map(stat => (
            <div key={stat.label} className="bg-white dark:bg-slate-800 rounded-xl p-3 ring-1 ring-slate-200/60 dark:ring-slate-700/60 text-center">
              <div className={`mx-auto w-8 h-8 rounded-lg flex items-center justify-center mb-1.5 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{stat.value.toLocaleString()}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Active', value: profile.stats.activeListings },
            { label: 'Sold', value: profile.stats.soldListings },
            { label: 'Favourites', value: profile.stats.totalFavorites },
          ].map(stat => (
            <div key={stat.label} className="bg-white dark:bg-slate-800 rounded-xl p-3 ring-1 ring-slate-200/60 dark:ring-slate-700/60 text-center">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{stat.value.toLocaleString()}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Badges */}
        {profile.badges.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
              <CheckBadgeIcon className="w-4 h-4 text-indigo-500" />
              Marketplace Badges
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.badges.map(badge => (
                <div
                  key={badge.id}
                  className="inline-flex items-center gap-1.5 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 px-3 py-1.5 rounded-full ring-1 ring-indigo-200/60 dark:ring-indigo-700/40"
                >
                  <span className="text-sm">{badge.icon}</span>
                  <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{badge.name}</span>
                  <span className="text-[10px] text-indigo-500 dark:text-indigo-400">Lv.{badge.level}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Listings */}
        {profile.recentListings.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
              <ShoppingBagIcon className="w-4 h-4 text-emerald-500" />
              Active Listings ({profile.stats.activeListings})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {profile.recentListings.map(listing => (
                <button
                  key={listing.id}
                  onClick={() => handleListingClick(listing)}
                  className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden ring-1 ring-slate-200/60 dark:ring-slate-700/60 hover:ring-indigo-300 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-700 relative">
                    {listing.images && listing.images.length > 0 ? (
                      <img src={listing.images[0]} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-1 group-hover:text-indigo-600 transition-colors">{listing.title}</p>
                    <p className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                      {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
            <StarIcon className="w-4 h-4 text-amber-500" />
            Reviews ({profile.stats.totalReviews})
          </h2>
          {profile.recentReviews.length > 0 ? (
            <div className="space-y-3">
              {profile.recentReviews.map(review => (
                <div key={review.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 ring-1 ring-slate-200/60 dark:ring-slate-700/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="flex">{renderStars(review.rating)}</div>
                        <span className="text-xs text-slate-500 font-medium">{review.rating}/5</span>
                      </div>
                      {(review as any).listing_title && (
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 font-medium truncate">
                          Re: {(review as any).listing_title}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 flex-shrink-0">{new Date(review.created_at).toLocaleDateString()}</p>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">{review.comment}</p>
                  )}
                  {review.reviewer && (
                    <p className="text-xs text-slate-400 mt-2">— {review.reviewer.name}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 text-center ring-1 ring-slate-200/60 dark:ring-slate-700/60">
              <StarIcon className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-500">No reviews yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerProfileScreen;
