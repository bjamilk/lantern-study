import React, { useState } from 'react';
import { createOffer } from '../services/supabase';
import { MarketplaceListing } from '../types';
import Modal from './ui/Modal';
import { AppIcon } from './ui/AppIcon';

interface MakeOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: MarketplaceListing;
  onSuccess: (amount?: number) => void;
}

const MakeOfferModal: React.FC<MakeOfferModalProps> = ({ isOpen, onClose, listing, onSuccess }) => {
  const suggestedPrice = listing.price ? Math.round(listing.price * 0.8) : 0;
  const [amount, setAmount] = useState<string>(suggestedPrice.toString());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      void import('../services/productAnalytics').then(({ trackOfferMade }) => {
        trackOfferMade(listing.id);
      });
      onSuccess(offerAmount);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer');
    } finally {
      setLoading(false);
    }
  };

  const percentage = listing.price && parseFloat(amount) > 0
    ? Math.round((parseFloat(amount) / listing.price) * 100)
    : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="make-offer-title"
      maxWidthClass="max-w-md"
      loading={loading}
      closeOnBackdrop={!loading}
      panelClassName="!p-0 overflow-hidden"
    >
        <div className="flex items-center justify-between p-6 border-b border-lantern-border">
          <h3 id="make-offer-title" className="text-lg font-bold text-lantern-text flex items-center gap-2">
            <AppIcon name="currency" size={20} className="text-lantern-accent" aria-hidden />
            Make an Offer
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-lantern-background-secondary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close make offer dialog"
          >
            <AppIcon name="close" size={20} aria-hidden />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-lantern-background-secondary rounded-lg p-4">
            <p className="text-sm text-lantern-text-muted mb-1">Making an offer on:</p>
            <p className="font-semibold text-lantern-text line-clamp-1">{listing.title}</p>
            <p className="text-lantern-primary font-bold text-lg">
              {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
            </p>
          </div>

          <div>
            <label htmlFor="offer-amount" className="block text-sm font-semibold text-lantern-text mb-2">
              Your Offer (₦)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lantern-text-muted font-medium">₦</span>
              <input
                id="offer-amount"
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(''); }}
                placeholder="Enter your offer amount"
                min="1"
                max={listing.price || undefined}
                className="w-full min-h-[44px] pl-8 pr-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-transparent bg-lantern-surface text-lantern-text text-lg font-semibold"
              />
            </div>
            {listing.price && percentage > 0 && (
              <p className={`text-xs mt-1.5 ${
                percentage >= 80 ? 'text-lantern-accent' : percentage >= 60 ? 'text-amber-600' : 'text-lantern-error'
              }`}>
                {percentage}% of asking price
              </p>
            )}
          </div>

          <div>
            <label htmlFor="offer-message" className="block text-sm font-semibold text-lantern-text mb-2">
              Message (optional)
            </label>
            <textarea
              id="offer-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a message to the seller..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-transparent bg-lantern-surface text-lantern-text placeholder-lantern-text-muted resize-none text-sm"
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-lantern-text-muted bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
            <AppIcon name="time" size={16} className="text-amber-500 flex-shrink-0 mt-0.5" aria-hidden />
            <span>This offer will expire in <strong>48 hours</strong> if the seller doesn&apos;t respond. You can withdraw it anytime before that.</span>
          </div>

          {error && (
            <p className="text-sm text-lantern-error font-medium">{error}</p>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="min-h-[44px] px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background-secondary font-semibold text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading || !amount || parseFloat(amount) <= 0}
              className="min-h-[44px] px-5 py-2 bg-lantern-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden />
                  Submitting...
                </>
              ) : (
                <>
                  <AppIcon name="chatbubble" size={16} aria-hidden />
                  Submit Offer
                </>
              )}
            </button>
          </div>
        </div>
    </Modal>
  );
};

export default MakeOfferModal;
