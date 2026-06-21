import React, { useMemo, useState } from 'react';
import { createMarketplaceBundle } from '../../services/supabase';
import type { MarketplaceListing } from '../../types';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

interface CreateBundleModalProps {
  listings: MarketplaceListing[];
  onClose: () => void;
  onCreated: () => void;
}

const CreateBundleModal: React.FC<CreateBundleModalProps> = ({
  listings,
  onClose,
  onCreated,
}) => {
  const activeListings = useMemo(
    () => listings.filter((l) => l.status === 'active' && l.listing_kind !== 'bundle'),
    [listings]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const suggestedPrice = useMemo(() => {
    let sum = 0;
    for (const id of selected) {
      const listing = activeListings.find((l) => l.id === id);
      if (listing?.price) sum += Number(listing.price);
    }
    return sum > 0 ? Math.round(sum * 0.9) : 0;
  }, [selected, activeListings]);

  const handleCreate = async () => {
    setError('');
    const bundlePrice = Number(price);
    if (!title.trim() || selected.size < 2 || !bundlePrice || bundlePrice <= 0) {
      setError('Enter a title, pick at least 2 listings, and set a bundle price.');
      return;
    }
    setSaving(true);
    try {
      await createMarketplaceBundle({
        title: title.trim(),
        description: description.trim() || undefined,
        price: bundlePrice,
        listingIds: Array.from(selected),
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to create bundle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Create bundle</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4 space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bundle title" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
          />
          <div className="flex gap-2 items-end">
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Bundle price"
              className="flex-1"
            />
            {suggestedPrice > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPrice(String(suggestedPrice))}
              >
                Suggest ₦{suggestedPrice.toLocaleString()}
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">Select active listings to include:</p>
          <div className="max-h-48 overflow-y-auto space-y-2 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
            {activeListings.length === 0 && (
              <p className="text-sm text-slate-500 p-2">No active listings available.</p>
            )}
            {activeListings.map((listing) => (
              <label
                key={listing.id}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(listing.id)}
                  onChange={() => toggle(listing.id)}
                />
                <span className="text-sm flex-1 truncate">{listing.title}</span>
                <span className="text-xs text-slate-500">
                  {listing.price ? `₦${Number(listing.price).toLocaleString()}` : 'Free'}
                </span>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={handleCreate} loading={saving} className="w-full">
            Publish bundle
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateBundleModal;
