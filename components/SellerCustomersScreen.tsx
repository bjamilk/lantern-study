import React, { useState, useEffect } from 'react';
import { fetchSellerBuyers } from '../services/supabase';
import { SellerBuyerContact, SellerCustomerSegment } from '../types';
import { ArrowLeftIcon, UserGroupIcon, MegaphoneIcon } from '@heroicons/react/24/outline';
import Button from './ui/Button';
import SellerCampaignPanel from './marketplace/SellerCampaignPanel';

const SEGMENT_LABELS: Record<SellerCustomerSegment, string> = {
  repeat_buyer: 'Repeat buyers',
  top_spender: 'Top spenders',
  open_order: 'Open orders',
  open_inquiry: 'Open inquiries',
  lead: 'Leads',
  customer: 'Customers',
};

interface SellerCustomersScreenProps {
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
}

const SellerCustomersScreen: React.FC<SellerCustomersScreenProps> = ({ onBack, onNavigate }) => {
  const [buyers, setBuyers] = useState<SellerBuyerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<string>('');
  const [showCampaign, setShowCampaign] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setBuyers(await fetchSellerBuyers(segment || undefined));
      } catch {
        setBuyers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [segment]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">Customers</h1>
        <Button size="sm" variant="secondary" onClick={() => setShowCampaign(true)}>
          <MegaphoneIcon className="w-4 h-4 mr-1" />
          Campaign
        </Button>
      </div>

      <div className="px-4 py-2 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button
          type="button"
          onClick={() => setSegment('')}
          className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${!segment ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700'}`}
        >
          All
        </button>
        {(Object.keys(SEGMENT_LABELS) as SellerCustomerSegment[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSegment(key)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${segment === key ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700'}`}
          >
            {SEGMENT_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {!loading && buyers.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <UserGroupIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
            <p>No customer history yet</p>
          </div>
        )}
        {buyers.map((buyer) => (
          <div
            key={buyer.buyerId}
            className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">{buyer.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Last active {new Date(buyer.lastInteractionAt).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>{buyer.completedPurchases} purchase{buyer.completedPurchases !== 1 ? 's' : ''}</p>
                <p className="text-purple-600 dark:text-purple-400">
                  ₦{Number(buyer.totalSpent).toLocaleString()} spent
                </p>
              </div>
            </div>
            {(buyer.openInquiry || buyer.openOrder) && (
              <p className="text-xs text-amber-600 mt-2">
                {buyer.openOrder ? 'Open order' : 'Open inquiry'}
              </p>
            )}
            {buyer.segments && buyer.segments.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {buyer.segments.map((s) => (
                  <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {SEGMENT_LABELS[s as SellerCustomerSegment] || s}
                  </span>
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => onNavigate('DirectMessages', { userId: buyer.buyerId })}
            >
              Message
            </Button>
          </div>
        ))}
      </div>
      {showCampaign && (
        <SellerCampaignPanel onClose={() => setShowCampaign(false)} />
      )}
    </div>
  );
};

export default SellerCustomersScreen;
