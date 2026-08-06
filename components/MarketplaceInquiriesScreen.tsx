import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { fetchMyInquiries, updateInquiryStatus, fetchOffers, respondToOffer } from '../services/supabase';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { MarketplaceInquiry, MarketplaceOffer } from '../types';
import { canRespondToOffer, canWithdrawOffer, getOfferProposedBy } from '@lantern/shared/utils';
import { useBudgetHandlers } from '../hooks/useBudgetHandlers';
import {
  ChatBubbleLeftIcon,
  ArrowLeftIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShoppingBagIcon,
  UserCircleIcon,
  ChevronRightIcon,
  CurrencyDollarIcon
} from '@heroicons/react/24/outline';
import { Tabs, TabList, Tab, TabPanel } from './ui';

interface MarketplaceInquiriesScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  onBack: () => void;
  userId: string;
}

const MarketplaceInquiriesScreen: React.FC<MarketplaceInquiriesScreenProps> = ({ 
  onNavigate, 
  onBack,
  userId 
}) => {
  const [activeTab, setActiveTab] = useState<'seller' | 'buyer' | 'offers'>('seller');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [counterAmounts, setCounterAmounts] = useState<Record<string, string>>({});
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const { refreshBudgetTransactions } = useBudgetHandlers();

  useEffect(() => {
    if (activeTab === 'offers') {
      loadOffers();
    } else {
      loadInquiries();
    }
  }, [activeTab, statusFilter]);

  const loadOffers = async () => {
    setLoading(true);
    try {
      const [sellerOffers, buyerOffers] = await Promise.all([
        fetchOffers('seller'),
        fetchOffers('buyer'),
      ]);
      setOffers([...sellerOffers, ...buyerOffers].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (error) {
      console.error('Error loading offers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOfferAction = async (offerId: string, action: 'accept' | 'decline' | 'counter' | 'withdraw') => {
    setRespondingTo(offerId);
    try {
      const counterAmount = action === 'counter' ? parseFloat(counterAmounts[offerId] || '0') : undefined;
      if (action === 'counter' && (!counterAmount || counterAmount <= 0)) {
        useToastStore.getState().showToast('Please enter a valid counter amount', 'error');
        setRespondingTo(null);
        return;
      }
      const result = await respondToOffer(offerId, action, counterAmount);
      if (action === 'accept') {
        await refreshBudgetTransactions(userId);
        const payUrl =
          (result as { authorizationUrl?: string })?.authorizationUrl ||
          (result as { checkout?: { authorizationUrl?: string } })?.checkout?.authorizationUrl;
        const offer = offers.find((o) => o.id === offerId);
        const isBuyer = offer?.buyer_id === userId;
        if (payUrl && isBuyer) {
          window.location.assign(payUrl);
          return;
        }
        if (payUrl && !isBuyer) {
          useToastStore.getState().showToast(
            'Offer accepted. The buyer will complete Paystack checkout.',
            'info'
          );
        }
      }
      await loadOffers();
    } catch (error: any) {
      useToastStore.getState().showToast(error.message || 'Failed to respond to offer', 'error');
    } finally {
      setRespondingTo(null);
    }
  };

  const loadInquiries = async () => {
    setLoading(true);
    try {
      const data = await fetchMyInquiries(activeTab, statusFilter || undefined);
      setInquiries(data);
    } catch (error) {
      console.error('Error loading inquiries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (inquiryId: string, newStatus: 'open' | 'negotiating' | 'closed' | 'purchased') => {
    try {
      await updateInquiryStatus(inquiryId, newStatus);
      await loadInquiries();
    } catch (error) {
      console.error('Error updating status:', error);
      useToastStore.getState().showToast('Failed to update status', 'error');
    }
  };

  const handleOpenConversation = (inquiry: MarketplaceInquiry) => {
    const otherUserId = activeTab === 'seller' ? inquiry.buyer_id : inquiry.seller_id;
    onNavigate('DirectMessages', { userId: otherUserId, inquiryContext: inquiry });
  };

  const handleViewListing = (listingId: string) => {
    onNavigate('MarketplaceListingDetail', { listingId });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
      case 'negotiating':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
      case 'closed':
        return 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary';
      case 'purchased':
        return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
      default:
        return 'bg-lantern-background-secondary text-lantern-text';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <ClockIcon className="w-4 h-4" />;
      case 'negotiating':
        return <ChatBubbleLeftIcon className="w-4 h-4" />;
      case 'closed':
        return <XCircleIcon className="w-4 h-4" />;
      case 'purchased':
        return <CheckCircleIcon className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const inquiryStatusFilters = (
    <div className="bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-2 sm:py-3">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-xs sm:text-sm text-lantern-text-secondary flex-shrink-0">Status:</span>
        <div className="flex gap-1.5 sm:gap-2">
          {['', 'open', 'negotiating', 'closed', 'purchased'].map((status) => (
            <button
              key={status || 'all'}
              onClick={() => setStatusFilter(status)}
              className={`flex-shrink-0 px-2.5 sm:px-3 py-1 text-xs sm:text-sm rounded-full transition-colors ${
                statusFilter === status
                  ? 'bg-lantern-primary text-white'
                  : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-background-secondary'
              }`}
            >
              {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const inquiriesPanelBody = loading ? (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lantern-primary"></div>
    </div>
  ) : inquiries.length === 0 ? (
    <div className="text-center py-12">
      <ChatBubbleLeftIcon className="w-16 h-16 mx-auto text-lantern-text-tertiary mb-4" />
      <h3 className="text-xl font-semibold text-lantern-text mb-2">
        No inquiries {statusFilter ? `with status "${statusFilter}"` : ''}
      </h3>
      <p className="text-lantern-text-secondary">
        {activeTab === 'seller'
          ? "You haven't received any inquiries yet."
          : "You haven't made any inquiries yet."}
      </p>
    </div>
  ) : (
    <div className="space-y-4">
      {inquiries.map(inquiry => (
        <div
          key={inquiry.id}
          className="bg-lantern-surface rounded-xl shadow-sm border border-lantern-border overflow-hidden"
        >
          <div className="flex flex-col md:flex-row">
            <div
              onClick={() => inquiry.listing && handleViewListing(inquiry.listing.id)}
              className="w-full md:w-48 h-28 sm:h-32 md:h-auto bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
            >
              {inquiry.listing?.images && inquiry.listing.images.length > 0 ? (
                <img
                  src={normalizeStorageUrl(inquiry.listing.images[0])}
                  alt={inquiry.listing?.title}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ShoppingBagIcon className="w-12 h-12 text-lantern-text-tertiary" />
                </div>
              )}
            </div>
            <div className="flex-1 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                <div className="flex-1 min-w-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full mb-2 ${getStatusColor(inquiry.status)}`}>
                    {getStatusIcon(inquiry.status)}
                    {inquiry.status}
                  </span>
                  <h3
                    onClick={() => inquiry.listing && handleViewListing(inquiry.listing.id)}
                    className="text-lg font-semibold text-lantern-text hover:text-lantern-primary cursor-pointer"
                  >
                    {inquiry.listing?.title || 'Listing unavailable'}
                  </h3>
                  {inquiry.listing?.price && (
                    <p className="text-lantern-primary font-semibold">
                      ₦{inquiry.listing.price.toLocaleString()}
                    </p>
                  )}
                  <div className="flex items-center mt-3 text-sm text-lantern-text-secondary">
                    <UserCircleIcon className="w-5 h-5 mr-2" />
                    <span>
                      {activeTab === 'seller'
                        ? `From: ${inquiry.buyer?.name || 'Unknown'}`
                        : `Seller: ${inquiry.seller?.name || 'Unknown'}`}
                    </span>
                  </div>
                  {inquiry.initial_message && (
                    <p className="text-sm text-lantern-text-secondary mt-2 line-clamp-2 italic">
                      "{inquiry.initial_message}"
                    </p>
                  )}
                  <p className="text-xs text-lantern-text-secondary mt-2">
                    {new Date(inquiry.created_at).toLocaleDateString()} at {new Date(inquiry.created_at).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex flex-row sm:flex-col gap-2 mt-3 sm:mt-0 sm:ml-4">
                  <button
                    onClick={() => handleOpenConversation(inquiry)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg text-xs sm:text-sm font-medium flex items-center transition-colors"
                  >
                    <ChatBubbleLeftIcon className="w-4 h-4 mr-1 sm:mr-2" />
                    Chat
                    <ChevronRightIcon className="w-4 h-4 ml-1 hidden sm:block" />
                  </button>
                  {activeTab === 'seller' && inquiry.status === 'open' && (
                    <button
                      onClick={() => handleStatusUpdate(inquiry.id, 'negotiating')}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 border border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg text-xs sm:text-sm font-medium transition-colors"
                    >
                      <span className="hidden sm:inline">Mark </span>Negotiating
                    </button>
                  )}
                  {inquiry.status !== 'purchased' && inquiry.status !== 'closed' && (
                    <button
                      onClick={() => handleStatusUpdate(inquiry.id, 'closed')}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary rounded-lg text-xs sm:text-sm font-medium transition-colors"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-lantern-background">
      {/* Header */}
      <div className="bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        <div className="flex items-center">
          <button
            onClick={onBack}
            className="mr-2 sm:mr-4 p-1.5 sm:p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors flex-shrink-0"
          >
            <ArrowLeftIcon className="w-5 h-5 text-lantern-text-secondary" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-lantern-text flex items-center">
              <ChatBubbleLeftIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2 sm:mr-3 text-lantern-primary flex-shrink-0" />
              Inquiries
            </h1>
            <p className="text-lantern-text-secondary mt-0.5 sm:mt-1 text-xs sm:text-base hidden sm:block">
              {activeTab === 'seller' 
                ? 'Manage inquiries from potential buyers'
                : activeTab === 'buyer'
                ? 'Track your inquiries to sellers'
                : 'Manage price offers on your listings'
              }
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'seller' | 'buyer' | 'offers')} aria-label="Inquiry views" className="flex-1 flex flex-col min-h-0">
      <div className="bg-lantern-surface border-b border-lantern-border px-3 sm:px-4 md:px-6">
          <TabList className="space-x-0.5 sm:space-x-1 !border-0">
            <Tab value="seller" index={0} className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-6 !py-2.5 sm:!py-3 !text-xs sm:!text-sm !font-semibold">
              <span className="sm:hidden">Received</span>
              <span className="hidden sm:inline">Received (As Seller)</span>
            </Tab>
            <Tab value="buyer" index={1} className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-6 !py-2.5 sm:!py-3 !text-xs sm:!text-sm !font-semibold">
              <span className="sm:hidden">Sent</span>
              <span className="hidden sm:inline">Sent (As Buyer)</span>
            </Tab>
            <Tab
              value="offers"
              index={2}
              icon={<CurrencyDollarIcon className="w-4 h-4" />}
              className="flex-1 sm:flex-initial !rounded-none !px-2 sm:!px-6 !py-2.5 sm:!py-3 !text-xs sm:!text-sm !font-semibold"
            >
              Offers
            </Tab>
          </TabList>
      </div>

      <TabPanel value="seller" className="flex-1 flex flex-col min-h-0">
        {inquiryStatusFilters}
        <div className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto">{inquiriesPanelBody}</div>
      </TabPanel>

      <TabPanel value="buyer" className="flex-1 flex flex-col min-h-0">
        {inquiryStatusFilters}
        <div className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto">{inquiriesPanelBody}</div>
      </TabPanel>

      <TabPanel value="offers" className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lantern-primary"></div>
            </div>
          ) : offers.length === 0 ? (
            <div className="text-center py-12">
              <CurrencyDollarIcon className="w-16 h-16 mx-auto text-lantern-text-tertiary mb-4" />
              <h3 className="text-xl font-semibold text-lantern-text mb-2">No offers yet</h3>
              <p className="text-lantern-text-secondary">
                Price offers you've sent or received will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {offers.map(offer => {
                const isBuyer = offer.buyer_id === userId;
                const otherParty = isBuyer ? offer.seller : offer.buyer;
                const isExpired = offer.status === 'pending' && new Date(offer.expires_at) < new Date();

                return (
                  <div
                    key={offer.id}
                    className="bg-lantern-surface rounded-xl shadow-sm border border-lantern-border overflow-hidden"
                  >
                    <div className="flex flex-col md:flex-row">
                      {/* Listing Preview */}
                      <div
                        onClick={() => offer.listing && handleViewListing(offer.listing.id)}
                        className="w-full md:w-48 h-28 sm:h-32 md:h-auto bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                      >
                        {offer.listing?.images && (offer.listing.images as any[]).length > 0 ? (
                          <img
                            src={normalizeStorageUrl((offer.listing.images as any[])[0])}
                            alt={offer.listing?.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ShoppingBagIcon className="w-12 h-12 text-lantern-text-tertiary" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 p-3 sm:p-4">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                          <div className="flex-1 min-w-0">
                            {/* Status Badge */}
                            <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full mb-2 ${
                              offer.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                              offer.status === 'accepted' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                              offer.status === 'declined' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                              offer.status === 'countered' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                              offer.status === 'expired' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                              offer.status === 'withdrawn' ? 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary' :
                              'bg-lantern-background-secondary text-lantern-text'
                            }`}>
                              {isExpired ? 'Expired' : offer.status}
                            </span>
                            <span className="ml-2 text-xs text-lantern-text-tertiary">{isBuyer ? 'You offered' : 'Received from'} {otherParty?.name || 'Unknown'}</span>

                            {/* Listing Title */}
                            <h3
                              onClick={() => offer.listing && handleViewListing(offer.listing.id)}
                              className="text-lg font-semibold text-lantern-text hover:text-lantern-primary cursor-pointer"
                            >
                              {offer.listing?.title || 'Listing unavailable'}
                            </h3>

                            {/* Offer Amount */}
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                                ₦{Number(offer.amount).toLocaleString()}
                              </span>
                              {offer.listing?.price && (
                                <span className="text-sm text-lantern-text-tertiary line-through">
                                  ₦{Number(offer.listing.price).toLocaleString()}
                                </span>
                              )}
                            </div>

                            {/* Message */}
                            {offer.message && (
                              <p className="text-sm text-lantern-text-secondary mt-2 italic">"{offer.message}"</p>
                            )}

                            {offer.parent_offer_id && (
                              <p className="text-xs text-lantern-primary mt-1">
                                Counter-offer thread: {offer.parent_offer_id.slice(0, 8)}...
                              </p>
                            )}

                            {/* Expires */}
                            {offer.status === 'pending' && !isExpired && (
                              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                                <ClockIcon className="w-3.5 h-3.5" />
                                Expires {new Date(offer.expires_at).toLocaleDateString()} at {new Date(offer.expires_at).toLocaleTimeString()}
                              </p>
                            )}

                            <p className="text-xs text-lantern-text-secondary mt-2">
                              {new Date(offer.created_at).toLocaleDateString()} at {new Date(offer.created_at).toLocaleTimeString()}
                            </p>
                          </div>

                          {/* Actions — turn-based on proposed_by */}
                          {offer.status === 'pending' && !isExpired && (
                            <div className="flex flex-row sm:flex-col gap-2 mt-3 sm:mt-0 sm:ml-4">
                              {canRespondToOffer(offer, userId) ? (
                                <>
                                  <button
                                    onClick={() => handleOfferAction(offer.id, 'accept')}
                                    disabled={respondingTo === offer.id}
                                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs sm:text-sm font-medium flex items-center transition-colors disabled:opacity-50"
                                  >
                                    <CheckCircleIcon className="w-4 h-4 mr-1" />
                                    {getOfferProposedBy(offer) === 'seller' ? 'Accept Counter' : 'Accept'}
                                  </button>
                                  <button
                                    onClick={() => handleOfferAction(offer.id, 'decline')}
                                    disabled={respondingTo === offer.id}
                                    className="px-3 sm:px-4 py-1.5 sm:py-2 border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
                                  >
                                    <XCircleIcon className="w-4 h-4 mr-1 inline" />
                                    {getOfferProposedBy(offer) === 'seller' ? 'Decline Counter' : 'Decline'}
                                  </button>
                                  <div className="flex gap-1">
                                    <input
                                      type="number"
                                      placeholder="Counter ₦"
                                      value={counterAmounts[offer.id] || ''}
                                      onChange={(e) => setCounterAmounts(prev => ({ ...prev, [offer.id]: e.target.value }))}
                                      className="w-20 sm:w-24 px-2 py-1.5 sm:py-2 border border-lantern-border rounded-lg text-xs bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text"
                                    />
                                    <button
                                      onClick={() => handleOfferAction(offer.id, 'counter')}
                                      disabled={respondingTo === offer.id}
                                      className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                      Counter
                                    </button>
                                  </div>
                                </>
                              ) : canWithdrawOffer(offer, userId) ? (
                                <button
                                  onClick={() => handleOfferAction(offer.id, 'withdraw')}
                                  disabled={respondingTo === offer.id}
                                  className="px-3 sm:px-4 py-1.5 sm:py-2 border border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary rounded-lg text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                  Withdraw
                                </button>
                              ) : (
                                <p className="text-xs text-lantern-text-secondary font-medium sm:text-right">
                                  {isBuyer ? 'Waiting for seller…' : 'Waiting for buyer…'}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </TabPanel>
      </Tabs>
    </div>
  );
};

export default MarketplaceInquiriesScreen;
