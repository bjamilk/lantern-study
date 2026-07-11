import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMyListings,
  fetchSellerStats,
  fetchSellerAnalytics,
  updateListingStatus,
  deleteMarketplaceListing,
  fetchSellerPreferences,
  updateSellerPreferences,
  fetchSellerOnboarding,
} from '../services/supabase';
import { MarketplaceListing, SellerStats, SellerAnalytics, SellerOnboardingStatus } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import CreateBundleModal from './marketplace/CreateBundleModal';
import SellerCampaignPanel from './marketplace/SellerCampaignPanel';
import SellerCouponsPanel from './marketplace/SellerCouponsPanel';
import SellerOnboardingWizard from './marketplace/SellerOnboardingWizard';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  HeartIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShoppingBagIcon,
  ChartBarIcon,
  ArrowLeftIcon,
  EllipsisVerticalIcon
} from '@heroicons/react/24/outline';

interface MyListingsScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  onBack: () => void;
  refreshKey?: number;
}

const MyListingsScreen: React.FC<MyListingsScreenProps> = ({ onNavigate, onBack, refreshKey = 0 }) => {
  const { currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'active' | 'sold' | 'inactive'>('active');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleListings, setBundleListings] = useState<MarketplaceListing[]>([]);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showCoupons, setShowCoupons] = useState(false);
  const [hallDropoffEnabled, setHallDropoffEnabled] = useState(false);
  const [hallDropoffMin, setHallDropoffMin] = useState('');
  const [requirePaymentConfirmation, setRequirePaymentConfirmation] = useState(false);
  const [boostCredits, setBoostCredits] = useState<number | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<SellerOnboardingStatus | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const { refreshBudgetTransactions } = useBudgetHandlers();

  useEffect(() => {
    (async () => {
      const [prefs, onboarding] = await Promise.all([
        fetchSellerPreferences(),
        fetchSellerOnboarding(),
      ]);
      if (prefs) {
        setHallDropoffEnabled(!!prefs.hall_dropoff_enabled);
        setHallDropoffMin(
          prefs.hall_dropoff_min_amount != null ? String(prefs.hall_dropoff_min_amount) : ''
        );
        setRequirePaymentConfirmation(!!prefs.require_payment_confirmation);
        setBoostCredits(prefs.boost_credits ?? null);
      }
      if (onboarding) {
        setOnboardingStatus(onboarding);
        setBoostCredits(onboarding.boostCredits);
        if (onboarding.needsOnboarding) {
          setShowOnboarding(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    loadData();
  }, [activeTab, refreshKey]);

  const loadData = async () => {
    setLoading(true);
    
    // Set a timeout to stop loading after 5 seconds even if requests fail
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000);
    
    try {
      // Fetch listings and stats in parallel, but don't wait for both
      const listingsPromise = fetchMyListings(activeTab).catch(err => {
        console.error('Error fetching listings:', err);
        return [];
      });
      
      const statsPromise = fetchSellerStats().catch(err => {
        console.error('Error fetching stats:', err);
        return null;
      });

      const analyticsPromise = fetchSellerAnalytics().catch(err => {
        console.error('Error fetching analytics:', err);
        return null;
      });
      
      const [listingsData, statsData, analyticsData] = await Promise.all([
        listingsPromise,
        statsPromise,
        analyticsPromise,
      ]);
      setListings(listingsData || []);
      setStats(statsData);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Error loading data:', error);
      setListings([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleStatusChange = async (listingId: string, newStatus: 'active' | 'inactive' | 'sold') => {
    try {
      await updateListingStatus(listingId, newStatus);
      if (newStatus === 'sold' && currentUser) {
        await refreshBudgetTransactions(currentUser.id);
      }
      await loadData();
      setActionMenuOpen(null);
    } catch (error) {
      console.error('Error updating status:', error);
      useToastStore.getState().showToast('Failed to update listing status', 'error');
    }
  };

  const handleDelete = async (listingId: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;
    
    try {
      await deleteMarketplaceListing(listingId);
      await loadData();
      setActionMenuOpen(null);
    } catch (error) {
      console.error('Error deleting listing:', error);
      useToastStore.getState().showToast('Failed to delete listing', 'error');
    }
  };

  const handleEdit = (listing: MarketplaceListing) => {
    onNavigate('EditMarketplaceListing', { listing });
    setActionMenuOpen(null);
  };

  const getCategoryName = (category: string) => {
    const categoryNames: Record<string, string> = {
      textbook_exchange: 'Textbooks',
      pq_bank: 'Past Questions',
      lecture_notes: 'Lecture Notes',
      project_thesis: 'Projects & Thesis',
      data_collection: 'Data Collection',
      equipment_rental: 'Lab Equipment',
      accommodation: 'Accommodation',
      travel_transport: 'Transportation',
      personal_goods: 'Personal Goods',
      aso_ebi: 'Fashion',
      campus_services: 'Campus Services',
      events_social: 'Events & Social'
    };
    return categoryNames[category] || category;
  };

  const tabCounts = {
    active: stats?.activeListings ?? 0,
    sold: stats?.soldListings ?? 0,
    inactive: Math.max(
      0,
      (stats?.totalListings ?? 0) - (stats?.activeListings ?? 0) - (stats?.soldListings ?? 0)
    ),
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <button
              onClick={onBack}
              className="mr-2 sm:mr-4 p-1.5 sm:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
            >
              <ArrowLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-slate-200 flex items-center">
                <ShoppingBagIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2 sm:mr-3 text-indigo-600 flex-shrink-0" />
                My Listings
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-0.5 sm:mt-1 text-xs sm:text-base hidden sm:block">
                Manage your marketplace listings
                {boostCredits != null && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                    {boostCredits} boost credit{boostCredits === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onNavigate('MarketplaceOrders')}
              className="px-3 sm:px-4 py-1.5 sm:py-2 border border-slate-350 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-750 dark:text-slate-200 rounded-lg font-semibold flex items-center transition-colors text-xs sm:text-sm gap-1.5"
            >
              <ShoppingBagIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Orders</span>
            </button>
            <button
              onClick={() => onNavigate('SellerCustomers')}
              className="px-3 sm:px-4 py-1.5 sm:py-2 border border-slate-350 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-750 dark:text-slate-200 rounded-lg font-semibold flex items-center transition-colors text-xs sm:text-sm gap-1.5 hidden md:flex"
            >
              <ChartBarIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              Customers
            </button>
            <button
              onClick={() => setShowCampaign(true)}
              className="hidden lg:flex px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold"
            >
              Campaign
            </button>
            <button
              onClick={async () => {
                setBundleListings(await fetchMyListings('active'));
                setShowBundleModal(true);
              }}
              className="hidden lg:flex px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold"
            >
              Bundle
            </button>
            <button
              onClick={() => setShowCoupons(true)}
              className="hidden lg:flex px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold"
            >
              Coupons
            </button>
            <button
              onClick={() => onNavigate('MarketplaceInquiries')}
              className="px-3 sm:px-4 py-1.5 sm:py-2 border border-slate-350 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-750 dark:text-slate-200 rounded-lg font-semibold flex items-center transition-colors text-xs sm:text-sm gap-1.5"
            >
              <ChatBubbleLeftIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">Inquiries & Offers</span>
              <span className="sm:hidden">Offers</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center transition-colors text-xs sm:text-sm"
              >
                <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                <span className="hidden sm:inline">New Listing</span>
              </button>
              {showCategoryPicker && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
                  <div className="p-2">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Select Category</p>
                    <button
                      onClick={() => {
                        setShowCategoryPicker(false);
                        onNavigate('CreateMarketplaceListing', { category: 'academic' });
                      }}
                      className="w-full flex items-center px-3 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center mr-3">
                        <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}/>
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-slate-800 dark:text-slate-200">Academic Marketplace</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Textbooks, notes, past questions</p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setShowCategoryPicker(false);
                        onNavigate('CreateMarketplaceListing', { category: 'student-life' });
                      }}
                      className="w-full flex items-center px-3 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex items-center justify-center mr-3">
                        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-slate-800 dark:text-slate-200">Student Life & Gigs</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Services, accommodation, events</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4 p-3 sm:p-4 md:p-6">
          <StatCard icon={ShoppingBagIcon} label="Total Listings" value={stats.totalListings} color="indigo" />
          <StatCard icon={CheckCircleIcon} label="Active" value={stats.activeListings} color="green" />
          <StatCard icon={ShoppingBagIcon} label="Sold Listings" value={stats.soldListings} color="blue" />
          <StatCard icon={CheckCircleIcon} label="Completed Sales" value={stats.completedOrders ?? analytics?.completedSalesCount ?? 0} color="purple" />
          <StatCard icon={EyeIcon} label="Total Views" value={stats.totalViews} color="purple" />
          <StatCard icon={ChatBubbleLeftIcon} label="Inquiries" value={stats.totalInquiries} color="orange" />
        </div>
      )}

      {analytics && (
        <div className="px-3 sm:px-4 md:px-6 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-3">
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500">Revenue (30d)</p>
              <p className="text-lg font-bold text-indigo-600">₦{analytics.revenue30d.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500">View-to-sale rate</p>
              <p className="text-lg font-bold">{analytics.conversionRate}%</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500">Pending orders</p>
              <p className="text-lg font-bold">{analytics.pendingOrders}</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500">Offer accept rate</p>
              <p className="text-lg font-bold">{analytics.offerAcceptRate}%</p>
            </div>
          </div>
          {analytics.salesByWeek.length > 0 && (
            <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                <ChartBarIcon className="w-4 h-4" /> Weekly sales
              </p>
              <div className="flex items-end gap-1 h-16">
                {analytics.salesByWeek.map((week) => {
                  const max = Math.max(...analytics.salesByWeek.map((w) => w.revenue), 1);
                  const height = Math.max(4, (week.revenue / max) * 100);
                  return (
                    <div
                      key={week.weekStart}
                      className="flex-1 bg-indigo-500/80 rounded-t"
                      style={{ height: `${height}%` }}
                      title={`₦${week.revenue} · ${week.count} sales`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {(analytics.salesBySource?.length || analytics.inquiryToSaleRate != null) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
              {analytics.salesBySource && analytics.salesBySource.length > 0 && (
                <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-500 mb-2">Sales by channel</p>
                  <div className="space-y-1">
                    {analytics.salesBySource.map((row) => (
                      <div key={row.source} className="flex justify-between text-sm">
                        <span className="capitalize">{row.source.replace(/_/g, ' ')}</span>
                        <span>{row.count} · ₦{row.revenue.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analytics.inquiryToSaleRate != null && (
                <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">Inquiry → sale rate</p>
                  <p className="text-lg font-bold">{analytics.inquiryToSaleRate}%</p>
                </div>
              )}
            </div>
          )}

          {(analytics.staleListings?.length || analytics.highViewsLowEngagement?.length) ? (
            <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">Listing insights</p>
              {analytics.highViewsLowEngagement?.slice(0, 3).map((l) => (
                <p key={l.id} className="text-xs text-amber-900 dark:text-amber-200">
                  "{l.title}" — {l.views} views, no inquiries. Try a price drop or better photos.
                </p>
              ))}
              {analytics.staleListings?.slice(0, 3).map((l) => (
                <p key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mt-1">
                  "{l.title}" — listed {l.daysListed} days with low activity.
                </p>
              ))}
            </div>
          ) : null}

          {analytics.favoriteHighlights && analytics.favoriteHighlights.length > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-900/40">
              <p className="text-xs font-semibold text-pink-800 dark:text-pink-300 mb-2 flex items-center gap-1">
                <HeartIcon className="w-4 h-4" /> Favorite highlights
              </p>
              {analytics.favoriteHighlights.map((l) => (
                <p key={l.id} className="text-xs text-pink-900 dark:text-pink-200">
                  "{l.title}" — {l.favoritesCount} favorite{l.favoritesCount === 1 ? '' : 's'}. Consider reaching out with a coupon.
                </p>
              ))}
            </div>
          )}

          <div className="mt-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
            <p className="text-xs font-semibold text-slate-500 mb-1">Seller preferences</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requirePaymentConfirmation}
                onChange={(e) => setRequirePaymentConfirmation(e.target.checked)}
              />
              Require payment proof before marking orders paid
            </label>
            <p className="text-xs font-semibold text-slate-500 mb-2">Hall dropoff threshold</p>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={hallDropoffEnabled}
                onChange={(e) => setHallDropoffEnabled(e.target.checked)}
              />
              Offer hall dropoff on combined orders
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={hallDropoffMin}
                onChange={(e) => setHallDropoffMin(e.target.value)}
                placeholder="Min ₦ amount"
                className="lantern-field flex-1 text-sm"
              />
              <button
                type="button"
                disabled={savingPrefs}
                onClick={async () => {
                  setSavingPrefs(true);
                  try {
                    await updateSellerPreferences({
                      hallDropoffEnabled,
                      hallDropoffMinAmount: hallDropoffMin ? Number(hallDropoffMin) : null,
                      requirePaymentConfirmation,
                    });
                  } finally {
                    setSavingPrefs(false);
                  }
                }}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 sm:px-4 md:px-6">
        <div className="flex space-x-0.5 sm:space-x-1">
          {(['active', 'sold', 'inactive'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 sm:px-6 py-2.5 sm:py-3 font-semibold text-xs sm:text-sm border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab} ({tabCounts[tab]})
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingBagIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
              No {activeTab} listings
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              {activeTab === 'active' 
                ? "Create your first listing to start selling!"
                : `You don't have any ${activeTab} listings yet.`
              }
            </p>
            {activeTab === 'active' && (
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => onNavigate('CreateMarketplaceListing', { category: 'academic' })}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold inline-flex items-center justify-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}/>
                  </svg>
                  Academic Listing
                </button>
                <button
                  onClick={() => onNavigate('CreateMarketplaceListing', { category: 'student-life' })}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center justify-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" />
                  </svg>
                  Student Life & Gigs
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {listings.map(listing => (
              <div
                key={listing.id}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Image */}
                  <div className="w-full md:w-48 h-32 md:h-auto bg-slate-100 dark:bg-slate-700 flex-shrink-0">
                    {listing.images && listing.images.length > 0 ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-12 h-12 text-slate-400" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="inline-block px-2 py-1 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full mb-2">
                          {getCategoryName(listing.category)}
                        </span>
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                          {listing.title}
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 text-sm line-clamp-1 mt-1">
                          {listing.description}
                        </p>
                      </div>

                      {/* Actions Menu */}
                      <div className="relative">
                        <button
                          onClick={() => setActionMenuOpen(actionMenuOpen === listing.id ? null : listing.id)}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <EllipsisVerticalIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        </button>

                        {actionMenuOpen === listing.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-10">
                            <button
                              onClick={() => handleEdit(listing)}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center"
                            >
                              <PencilIcon className="w-4 h-4 mr-2" />
                              Edit Listing
                            </button>
                            {listing.status !== 'active' && (
                              <button
                                onClick={() => handleStatusChange(listing.id, 'active')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center text-green-600"
                              >
                                <CheckCircleIcon className="w-4 h-4 mr-2" />
                                Mark Active
                              </button>
                            )}
                            {listing.status !== 'sold' && (
                              <button
                                onClick={() => handleStatusChange(listing.id, 'sold')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center text-blue-600"
                              >
                                <ShoppingBagIcon className="w-4 h-4 mr-2" />
                                Mark as Sold
                              </button>
                            )}
                            {listing.status !== 'inactive' && (
                              <button
                                onClick={() => handleStatusChange(listing.id, 'inactive')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center text-orange-600"
                              >
                                <XCircleIcon className="w-4 h-4 mr-2" />
                                Deactivate
                              </button>
                            )}
                            <hr className="my-1 border-slate-200 dark:border-slate-700" />
                            <button
                              onClick={() => handleDelete(listing.id)}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center text-red-600"
                            >
                              <TrashIcon className="w-4 h-4 mr-2" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 md:gap-6 mt-3 sm:mt-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-base sm:text-lg text-indigo-600 dark:text-indigo-400">
                        {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                      </span>
                      {listing.quantity != null && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {listing.quantity > 0 ? `${listing.quantity} in stock` : 'Out of stock'}
                        </span>
                      )}
                      <span className="flex items-center">
                        <EyeIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                        {listing.views_count || 0}<span className="hidden sm:inline">&nbsp;views</span>
                      </span>
                      <span className="flex items-center">
                        <HeartIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                        {listing.favorites_count || 0}<span className="hidden sm:inline">&nbsp;favorites</span>
                      </span>
                      <span className="flex items-center">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                        {listing.inquiries_count || 0}<span className="hidden sm:inline">&nbsp;inquiries</span>
                      </span>
                      <span className="text-slate-500 hidden sm:inline">
                        {new Date(listing.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Click outside to close menu */}
      {actionMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-0 cursor-default bg-transparent"
          aria-label="Close listing actions menu"
          onClick={() => setActionMenuOpen(null)}
        />
      )}

      {showBundleModal && (
        <CreateBundleModal
          listings={bundleListings}
          onClose={() => setShowBundleModal(false)}
          onCreated={() => loadData()}
        />
      )}
      {showCampaign && <SellerCampaignPanel onClose={() => setShowCampaign(false)} />}
      {showCoupons && <SellerCouponsPanel onClose={() => setShowCoupons(false)} />}
      {showOnboarding && onboardingStatus?.needsOnboarding && (
        <SellerOnboardingWizard
          status={onboardingStatus}
          onComplete={async () => {
            setShowOnboarding(false);
            const onboarding = await fetchSellerOnboarding();
            if (onboarding) {
              setOnboardingStatus(onboarding);
              setBoostCredits(onboarding.boostCredits);
            }
            const prefs = await fetchSellerPreferences();
            if (prefs?.boost_credits != null) setBoostCredits(prefs.boost_credits);
          }}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}> = ({ icon: Icon, label, value, color }) => {
  const colorClasses: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-2.5 sm:p-4 border border-slate-200 dark:border-slate-700">
      <div className={`w-7 h-7 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center ${colorClasses[color]} mb-1.5 sm:mb-3`}>
        <Icon className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
      </div>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-slate-200">{value}</p>
      <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-400 leading-tight">{label}</p>
    </div>
  );
};

export default MyListingsScreen;
