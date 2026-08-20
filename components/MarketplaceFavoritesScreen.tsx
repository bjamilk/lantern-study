import React, { useState, useEffect, useCallback } from 'react';
import { useToastStore } from '../stores/toastStore';
import { fetchMyFavorites, removeFromFavorites } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { MarketplaceListing } from '../types';
import { ListingCard } from './marketplace/ListingCard';
import { MarketplaceWorkspaceBar } from './marketplace/MarketplaceWorkspaceBar';
import {
  ArrowLeftIcon,
  HeartIcon,
  ShoppingBagIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  HomeIcon,
  TruckIcon,
  TicketIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

interface MarketplaceFavoritesScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  onBack: () => void;
}

/** Shared category metadata so favorite cards match the browse grid's chips. */
const CATEGORY_META: Array<{ id: string; name: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'textbook_exchange', name: 'Textbooks', icon: AcademicCapIcon },
  { id: 'pq_bank', name: 'Past Questions', icon: SparklesIcon },
  { id: 'lecture_notes', name: 'Lecture Notes', icon: BriefcaseIcon },
  { id: 'project_thesis', name: 'Projects & Thesis', icon: BriefcaseIcon },
  { id: 'data_collection', name: 'Data Collection', icon: HomeIcon },
  { id: 'equipment_rental', name: 'Lab Equipment', icon: ShoppingBagIcon },
  { id: 'accommodation', name: 'Accommodation', icon: HomeIcon },
  { id: 'travel_transport', name: 'Transportation', icon: TruckIcon },
  { id: 'personal_goods', name: 'Personal Goods', icon: SparklesIcon },
  { id: 'aso_ebi', name: 'Fashion', icon: ShoppingBagIcon },
  { id: 'campus_services', name: 'Campus Services', icon: BriefcaseIcon },
  { id: 'events_social', name: 'Events & Social', icon: TicketIcon },
];

const getCategoryIcon = (categoryId: string) =>
  CATEGORY_META.find((c) => c.id === categoryId)?.icon ?? SparklesIcon;

const getCategoryName = (categoryId: string) => {
  if (categoryId?.startsWith('custom:')) return categoryId.replace('custom:', '');
  return CATEGORY_META.find((c) => c.id === categoryId)?.name ?? categoryId;
};

/** Buyer's saved listings — web parity for the mobile FavoritesScreen. */
const MarketplaceFavoritesScreen: React.FC<MarketplaceFavoritesScreenProps> = ({ onNavigate, onBack }) => {
  const { currentUser } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchMyFavorites();
      const saved: MarketplaceListing[] = [];
      for (const row of rows as Array<{ listing?: MarketplaceListing | null }>) {
        if (row.listing) saved.push(row.listing);
      }
      setListings(saved);
      setLoadError(null);
    } catch (error) {
      console.error('Error loading favorites:', error);
      // Distinguish a real load failure from an empty favorites list.
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : 'Something went wrong while loading your saved listings.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const handleUnfavorite = async (listingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const previous = listings;
    // Optimistically drop the card; restore it if the request fails.
    setListings((prev) => prev.filter((l) => l.id !== listingId));
    try {
      await removeFromFavorites(listingId);
    } catch (error) {
      console.error('Error removing favorite:', error);
      setListings(previous);
      showToast('Could not update favorites. Please try again.', 'error');
    }
  };

  const handleListingClick = (listing: MarketplaceListing) => {
    const isOwnListing =
      !!currentUser?.id &&
      (listing.user_id === currentUser.id || listing.seller_id === currentUser.id);
    if (isOwnListing) {
      onNavigate('MyListings');
    } else {
      onNavigate('MarketplaceListingDetail', { listingId: listing.id });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background">
      <div className="shrink-0 bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-3 space-y-3">
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mr-2 p-1.5 sm:p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Back to marketplace"
          >
            <ArrowLeftIcon className="w-5 h-5 text-lantern-text-secondary" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-lantern-text truncate">Saved</h1>
            <p className="text-xs text-lantern-text-secondary truncate">
              Listings you've hearted across the marketplace
            </p>
          </div>
        </div>

        <MarketplaceWorkspaceBar
          active="favorites"
          onNavigate={onNavigate}
          onSell={() => onNavigate('CreateMarketplaceListing')}
          primaryLabel="Sell"
          showFavorites
        />
      </div>

      <div
        role="region"
        aria-label="Saved listings"
        className="flex-1 min-h-0 min-w-0 max-w-full p-2 sm:p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto overflow-x-hidden overscroll-contain box-border"
      >
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 md:gap-5 w-full py-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-xl border border-lantern-border overflow-hidden">
                <div className="h-40 animate-pulse bg-lantern-background-secondary" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse bg-lantern-background-secondary rounded" />
                  <div className="h-3 w-1/3 animate-pulse bg-lantern-background-secondary rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-lantern-error/10 rounded-2xl flex items-center justify-center mb-5">
              <ExclamationTriangleIcon className="w-10 h-10 text-lantern-error" />
            </div>
            <h3 className="text-lg font-semibold text-lantern-text mb-2">Couldn't load saved listings</h3>
            <p className="text-sm text-lantern-text-secondary mb-6 max-w-sm">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadFavorites()}
              className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center transition-colors duration-150 text-sm shadow-sm"
            >
              <ArrowPathIcon className="w-4 h-4 mr-2" />
              Retry
            </button>
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-lantern-background-secondary rounded-2xl flex items-center justify-center mb-5">
              <HeartIcon className="w-10 h-10 text-lantern-text-tertiary" />
            </div>
            <h3 className="text-lg font-semibold text-lantern-text mb-2">No saved listings yet</h3>
            <p className="text-sm text-lantern-text-secondary mb-6 max-w-sm">
              Tap the heart on any listing to save it here for later.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('Marketplace')}
              className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-xl font-semibold flex items-center transition-colors duration-150 text-sm shadow-sm"
            >
              <ShoppingBagIcon className="w-4 h-4 mr-2" />
              Browse listings
            </button>
          </div>
        ) : (
          <div className="grid w-full max-w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 md:gap-5">
            {listings.map((listing) => {
              const IconComponent = getCategoryIcon(listing.category);
              return (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isFavorite
                  isOwner={
                    !!currentUser?.id &&
                    (listing.user_id === currentUser.id || listing.seller_id === currentUser.id)
                  }
                  categoryName={getCategoryName(listing.category)}
                  CategoryIcon={IconComponent}
                  onPress={() => handleListingClick(listing)}
                  onToggleFavorite={(e) => handleUnfavorite(listing.id, e)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketplaceFavoritesScreen;
