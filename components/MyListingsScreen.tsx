import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMyListings,
  fetchSellerStats,
  fetchSellerAnalytics,
  updateListingStatus,
  deleteMarketplaceListing,
  fetchSellerPreferences,
  fetchSellerOnboarding,
} from '../services/supabase';
import { MarketplaceListing, SellerStats, SellerAnalytics, SellerOnboardingStatus } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import CreateBundleModal from './marketplace/CreateBundleModal';
import SellerCampaignPanel from './marketplace/SellerCampaignPanel';
import SellerCouponsPanel from './marketplace/SellerCouponsPanel';
import SellerOnboardingWizard from './marketplace/SellerOnboardingWizard';
import { MarketplaceWorkspaceBar } from './marketplace/MarketplaceWorkspaceBar';
import SellerInsightsDrawer from './marketplace/SellerInsightsDrawer';
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
  EllipsisVerticalIcon,
  UserGroupIcon,
  TicketIcon,
  GiftIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/outline';
import { Tabs, TabList, Tab, TabPanel, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from './ui';

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
  const [showInsights, setShowInsights] = useState(false);
  const [hallDropoffEnabled, setHallDropoffEnabled] = useState(false);
  const [hallDropoffMin, setHallDropoffMin] = useState('');
  const [requirePaymentConfirmation, setRequirePaymentConfirmation] = useState(false);
  const [boostCredits, setBoostCredits] = useState<number | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<SellerOnboardingStatus | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
    loadListings();
  }, [activeTab, refreshKey]);

  useEffect(() => {
    // Load stats/analytics in background so inventory is not blocked.
    void Promise.all([
      fetchSellerStats().catch(() => null),
      fetchSellerAnalytics().catch(() => null),
    ]).then(([statsData, analyticsData]) => {
      setStats(statsData);
      setAnalytics(analyticsData);
    });
  }, [refreshKey]);

  const loadListings = async () => {
    setLoading(true);
    const timeoutId = setTimeout(() => setLoading(false), 5000);
    try {
      const listingsData = await fetchMyListings(activeTab).catch(() => []);
      setListings(listingsData || []);
    } catch {
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
      await loadListings();
      const [statsData, analyticsData] = await Promise.all([
        fetchSellerStats().catch(() => null),
        fetchSellerAnalytics().catch(() => null),
      ]);
      setStats(statsData);
      setAnalytics(analyticsData);
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
      await loadListings();
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
      events_social: 'Events & Social',
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

  const openNewListing = (category: 'academic' | 'student-life') => {
    setShowCategoryPicker(false);
    onNavigate('CreateMarketplaceListing', { category });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background">
      <div className="shrink-0 bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
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
              <h1 className="text-lg sm:text-xl font-bold text-lantern-text truncate">Selling</h1>
              <p className="text-xs text-lantern-text-secondary truncate">
                Manage your listings
                {boostCredits != null ? (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[10px] font-semibold">
                    {boostCredits} boost{boostCredits === 1 ? '' : 's'}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="relative flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowInsights(true)}
              className="h-8 px-2.5 rounded-lg border border-lantern-border bg-lantern-surface text-xs font-medium text-lantern-text-secondary hover:border-lantern-primary/30 inline-flex items-center gap-1"
              aria-label="Open performance insights"
            >
              <ChartBarIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Insights</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCategoryPicker(v => !v)}
              className="h-8 px-2.5 sm:px-3 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">New listing</span>
              <span className="sm:hidden">New</span>
            </button>
            {showCategoryPicker ? (
              <div className="absolute right-0 top-full mt-2 w-64 bg-lantern-surface rounded-lg shadow-xl border border-lantern-border z-50 overflow-hidden">
                <div className="p-2">
                  <p className="text-xs font-medium text-lantern-text-secondary px-3 py-2">Select Category</p>
                  <button
                    type="button"
                    onClick={() => openNewListing('academic')}
                    className="w-full flex items-center px-3 py-3 hover:bg-lantern-background-secondary rounded-lg transition-colors text-left"
                  >
                    <div className="w-9 h-9 bg-lantern-primary-background rounded-lg flex items-center justify-center mr-3">
                      <ShoppingBagIcon className="w-4 h-4 text-lantern-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-lantern-text text-sm">Academic</p>
                      <p className="text-xs text-lantern-text-secondary">Textbooks, notes, PQs</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => openNewListing('student-life')}
                    className="w-full flex items-center px-3 py-3 hover:bg-lantern-background-secondary rounded-lg transition-colors text-left"
                  >
                    <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex items-center justify-center mr-3">
                      <GiftIcon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-medium text-lantern-text text-sm">Student Life</p>
                      <p className="text-xs text-lantern-text-secondary">Services, housing, events</p>
                    </div>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <MarketplaceWorkspaceBar
          active="selling"
          onNavigate={onNavigate}
          onSell={() => setShowCategoryPicker(true)}
          primaryLabel="Sell"
          moreItems={[
            {
              id: 'customers',
              label: 'Customers',
              onSelect: () => onNavigate('SellerCustomers'),
              icon: <UserGroupIcon className="w-4 h-4" />,
            },
            {
              id: 'campaign',
              label: 'Campaign',
              onSelect: () => setShowCampaign(true),
              icon: <MegaphoneIcon className="w-4 h-4" />,
            },
            {
              id: 'bundle',
              label: 'Bundle',
              onSelect: async () => {
                setBundleListings(await fetchMyListings('active'));
                setShowBundleModal(true);
              },
              icon: <GiftIcon className="w-4 h-4" />,
            },
            {
              id: 'coupons',
              label: 'Coupons',
              onSelect: () => setShowCoupons(true),
              icon: <TicketIcon className="w-4 h-4" />,
            },
            {
              id: 'insights',
              label: 'Insights & preferences',
              onSelect: () => setShowInsights(true),
              icon: <ChartBarIcon className="w-4 h-4" />,
            },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label="Active" value={stats?.activeListings ?? 0} />
          <Kpi label="Views" value={stats?.totalViews ?? 0} />
          <Kpi label="Inquiries" value={stats?.totalInquiries ?? 0} />
          <Kpi
            label="Revenue 30d"
            value={
              analytics
                ? `₦${analytics.revenue30d.toLocaleString()}`
                : stats?.revenue30d != null
                  ? `₦${stats.revenue30d.toLocaleString()}`
                  : '—'
            }
            accent
          />
        </div>
      </div>

      <div className="bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 flex flex-col flex-1 min-h-0">
        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as 'active' | 'sold' | 'inactive')}
          aria-label="Listing status"
          className="flex flex-col flex-1 min-h-0"
        >
          <TabList className="space-x-0.5 sm:space-x-1 !border-0">
            {(['active', 'sold', 'inactive'] as const).map((tab, index) => (
              <Tab
                key={tab}
                value={tab}
                index={index}
                className="!rounded-none capitalize !px-3 sm:!px-6 !py-2.5 sm:!py-3 !text-xs sm:!text-sm !font-semibold"
              >
                {tab} ({tabCounts[tab]})
              </Tab>
            ))}
          </TabList>

          <div
            role="region"
            aria-label="Seller inventory"
            data-testid="seller-inventory"
            className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto"
          >
            {(['active', 'sold', 'inactive'] as const).map(tab => (
              <TabPanel key={tab} value={tab}>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lantern-primary" />
                  </div>
                ) : listings.length === 0 ? (
                  <div className="text-center py-12">
                    <ShoppingBagIcon className="w-14 h-14 mx-auto text-lantern-text-tertiary mb-4" />
                    <h3 className="text-lg font-semibold text-lantern-text mb-2">No {activeTab} listings</h3>
                    <p className="text-sm text-lantern-text-secondary mb-6">
                      {activeTab === 'active'
                        ? 'Create your first listing to start selling.'
                        : `You don't have any ${activeTab} listings yet.`}
                    </p>
                    {activeTab === 'active' ? (
                      <button
                        type="button"
                        onClick={() => setShowCategoryPicker(true)}
                        className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg font-semibold inline-flex items-center"
                      >
                        <PlusIcon className="w-4 h-4 mr-2" />
                        New listing
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {listings.map(listing => (
                      <article
                        key={listing.id}
                        className="bg-lantern-surface rounded-xl border border-lantern-border overflow-hidden hover:border-lantern-primary/30 transition-colors"
                      >
                        <div className="flex items-stretch gap-0">
                          <button
                            type="button"
                            onClick={() => onNavigate('MarketplaceListingDetail', { listingId: listing.id })}
                            className="w-20 sm:w-28 h-20 sm:h-24 bg-lantern-background-secondary flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                            aria-label={`View ${listing.title}`}
                          >
                            {listing.images && listing.images.length > 0 ? (
                              <img
                                src={listing.images[0]}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                                onError={e => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ShoppingBagIcon className="w-8 h-8 text-lantern-text-tertiary" />
                              </div>
                            )}
                          </button>

                          <div className="flex-1 min-w-0 p-2.5 sm:p-3 flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onNavigate('MarketplaceListingDetail', { listingId: listing.id })}
                              className="min-w-0 text-left flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary rounded"
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-lantern-primary-background text-lantern-primary rounded">
                                  {getCategoryName(listing.category)}
                                </span>
                                <span className="text-[10px] capitalize text-lantern-text-tertiary">{listing.status}</span>
                              </div>
                              <h3 className="text-sm sm:text-base font-semibold text-lantern-text truncate">
                                {listing.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] sm:text-xs text-lantern-text-secondary">
                                <span className="font-semibold text-sm text-lantern-primary">
                                  {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                                </span>
                                {listing.quantity != null ? (
                                  <span>{listing.quantity > 0 ? `${listing.quantity} in stock` : 'Out of stock'}</span>
                                ) : null}
                                <span className="inline-flex items-center gap-0.5">
                                  <EyeIcon className="w-3.5 h-3.5" />
                                  {listing.views_count || 0}
                                </span>
                                <span className="inline-flex items-center gap-0.5">
                                  <HeartIcon className="w-3.5 h-3.5" />
                                  {listing.favorites_count || 0}
                                </span>
                                <span className="inline-flex items-center gap-0.5">
                                  <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                                  {listing.inquiries_count || 0}
                                </span>
                              </div>
                            </button>

                            <Menu
                              open={actionMenuOpen === listing.id}
                              onOpenChange={open => setActionMenuOpen(open ? listing.id : null)}
                            >
                              <MenuTrigger
                                aria-label={`Actions for ${listing.title}`}
                                className="p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                              >
                                <EllipsisVerticalIcon className="w-5 h-5 text-lantern-text-secondary" />
                              </MenuTrigger>
                              <MenuContent align="end" className="w-48">
                                <MenuItem onSelect={() => handleEdit(listing)} icon={<PencilIcon className="w-4 h-4" />}>
                                  Edit Listing
                                </MenuItem>
                                {listing.status !== 'active' && (
                                  <MenuItem
                                    onSelect={() => handleStatusChange(listing.id, 'active')}
                                    icon={<CheckCircleIcon className="w-4 h-4" />}
                                    className="text-green-600"
                                  >
                                    Mark Active
                                  </MenuItem>
                                )}
                                {listing.status !== 'sold' && (
                                  <MenuItem
                                    onSelect={() => handleStatusChange(listing.id, 'sold')}
                                    icon={<ShoppingBagIcon className="w-4 h-4" />}
                                    className="text-lantern-primary"
                                  >
                                    Mark as Sold
                                  </MenuItem>
                                )}
                                {listing.status !== 'inactive' && (
                                  <MenuItem
                                    onSelect={() => handleStatusChange(listing.id, 'inactive')}
                                    icon={<XCircleIcon className="w-4 h-4" />}
                                    className="text-orange-600"
                                  >
                                    Deactivate
                                  </MenuItem>
                                )}
                                <MenuSeparator />
                                <MenuItem
                                  onSelect={() => handleDelete(listing.id)}
                                  icon={<TrashIcon className="w-4 h-4" />}
                                  className="text-red-600"
                                >
                                  Delete
                                </MenuItem>
                              </MenuContent>
                            </Menu>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </TabPanel>
            ))}
          </div>
        </Tabs>
      </div>

      <SellerInsightsDrawer
        isOpen={showInsights}
        onClose={() => setShowInsights(false)}
        analytics={analytics}
        requirePaymentConfirmation={requirePaymentConfirmation}
        hallDropoffEnabled={hallDropoffEnabled}
        hallDropoffMin={hallDropoffMin}
        onRequirePaymentConfirmationChange={setRequirePaymentConfirmation}
        onHallDropoffEnabledChange={setHallDropoffEnabled}
        onHallDropoffMinChange={setHallDropoffMin}
      />

      {showBundleModal && (
        <CreateBundleModal
          listings={bundleListings}
          onClose={() => setShowBundleModal(false)}
          onCreated={() => loadListings()}
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

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-lantern-border bg-lantern-background-secondary/60 px-2.5 py-2">
      <p className="text-[10px] sm:text-xs text-lantern-text-secondary truncate">{label}</p>
      <p className={`text-sm sm:text-base font-bold truncate ${accent ? 'text-lantern-primary' : 'text-lantern-text'}`}>
        {value}
      </p>
    </div>
  );
}

export default MyListingsScreen;
