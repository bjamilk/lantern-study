import React, { useState } from 'react';
import { createOffer } from '../services/supabase';
import { MarketplaceListing } from '../types';
import {
  CurrencyDollarIcon,
  ClockIcon,
  ArrowLeftIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';

interface MakeOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: MarketplaceListing;
  onSuccess: () => void;
}

const MakeOfferModal: React.FC<MakeOfferModalProps> = ({ isOpen, onClose, listing, onSuccess }) => {
  const suggestedPrice = listing.price ? Math.round(listing.price * 0.8) : 0;
  const [amount, setAmount] = useState<string>(suggestedPrice.toString());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const offerAmount = parseFloat(amount);
    if (!offerAmount || offerAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (listing.price && offerAmount > listing.price) {
      setError('Offer cannot exceed the asking price');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await createOffer(listing.id, offerAmount, message || undefined);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit offer');
    } finally {
      setLoading(false);
    }
  };

  const percentage = listing.price && parseFloat(amount) > 0
    ? Math.round((parseFloat(amount) / listing.price) * 100)
    : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <CurrencyDollarIcon className="w-5 h-5 text-emerald-500" />
            Make an Offer
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Listing Summary */}
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Making an offer on:</p>
            <p className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{listing.title}</p>
            <p className="text-indigo-600 dark:text-indigo-400 font-bold text-lg">
              {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
            </p>
          </div>

          {/* Offer Amount */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Your Offer (₦)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₦</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(''); }}
                placeholder="Enter your offer amount"
                min="1"
                max={listing.price || undefined}
                className="w-full pl-8 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-lg font-semibold"
              />
            </div>
            {listing.price && percentage > 0 && (
              <p className={`text-xs mt-1.5 ${
                percentage >= 80 ? 'text-emerald-600' : percentage >= 60 ? 'text-amber-600' : 'text-red-500'
              }`}>
                {percentage}% of asking price
              </p>
            )}
          </div>

          {/* Optional Message */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Message (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a message to the seller..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 resize-none text-sm"
            />
          </div>

          {/* Expiry Notice */}
          <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
            <ClockIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <span>This offer will expire in <strong>48 hours</strong> if the seller doesn't respond. You can withdraw it anytime before that.</span>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 font-medium">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !amount || parseFloat(amount) <= 0}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors text-sm flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Submitting...
                </>
              ) : (
                <>
                  <ChatBubbleLeftIcon className="w-4 h-4" />
                  Submit Offer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MakeOfferModal;
