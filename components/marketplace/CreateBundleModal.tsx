import React, { useEffect, useMemo, useState } from 'react';
import { createMarketplaceBundle, fetchMarketplaceCampuses } from '../../services/supabase';
import { isOtherCityCampus, type MarketplaceCampus } from '@lantern/shared';
import type { MarketplaceListing } from '../../types';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import Modal from '../ui/Modal';
import { CampusSearchSelect } from './CampusSearchSelect';

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
  const [campusId, setCampusId] = useState('');
  const [location, setLocation] = useState('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedCampus = campuses.find((campus) => campus.id === campusId);
  const usesOtherCity = isOtherCityCampus(selectedCampus);

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then(setCampuses)
      .catch(() => setCampuses([]));
  }, []);

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
    if (!campusId) {
      setError('Select a campus or Other city for the bundle.');
      return;
    }
    if (usesOtherCity && !location.trim()) {
      setError('Enter the Nigerian city for the bundle.');
      return;
    }
    setSaving(true);
    try {
      await createMarketplaceBundle({
        title: title.trim(),
        description: description.trim() || undefined,
        price: bundlePrice,
        listingIds: Array.from(selected),
        campus_id: campusId,
        country_code: 'NG',
        location: location.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create bundle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="create-bundle-title"
      maxWidthClass="max-w-xl"
      loading={saving}
      closeOnBackdrop={!saving}
      alignClass="items-end sm:items-center justify-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="!p-0 rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto border border-lantern-border"
    >
        <div className="flex items-center justify-between p-4 border-b border-lantern-border">
          <h2 id="create-bundle-title" className="text-lg font-semibold text-lantern-text">Create bundle</h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
        </div>
        <div className="p-4 space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bundle title" aria-label="Bundle title" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
            aria-label="Bundle description"
          />
          <div>
            <label htmlFor="bundle-campus" className="block text-xs font-semibold text-lantern-text-secondary mb-1">
              Campus or city
            </label>
            <CampusSearchSelect
              id="bundle-campus"
              campuses={campuses}
              value={campusId}
              otherCity={usesOtherCity ? location : ''}
              otherCityRequired
              emptyLabel="Select campus or Other city"
              onChange={(nextCampusId) => {
                const nextCampus = campuses.find((campus) => campus.id === nextCampusId);
                const locationModeChanged =
                  isOtherCityCampus(selectedCampus) !== isOtherCityCampus(nextCampus);
                setCampusId(nextCampusId || '');
                if (locationModeChanged) setLocation('');
              }}
              onOtherCityChange={setLocation}
            />
          </div>
          {!usesOtherCity && (
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Pickup or delivery details (optional)"
              aria-label="Pickup or delivery details"
            />
          )}
          <div className="flex gap-2 items-end">
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Bundle price"
              className="flex-1"
              aria-label="Bundle price"
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
          <p className="text-xs text-lantern-text-muted">Select active listings to include:</p>
          <div className="max-h-48 overflow-y-auto space-y-2 border border-lantern-border rounded-lg p-2">
            {activeListings.length === 0 && (
              <p className="text-sm text-lantern-text-muted p-2">No active listings available.</p>
            )}
            {activeListings.map((listing) => (
              <label
                key={listing.id}
                className="flex items-center gap-2 p-2 min-h-[44px] rounded-lg hover:bg-lantern-background-secondary cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(listing.id)}
                  onChange={() => toggle(listing.id)}
                />
                <span className="text-sm flex-1 truncate text-lantern-text">{listing.title}</span>
                <span className="text-xs text-lantern-text-muted">
                  {listing.price ? `₦${Number(listing.price).toLocaleString()}` : 'Free'}
                </span>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-lantern-error">{error}</p>}
          <Button onClick={() => void handleCreate()} loading={saving} className="w-full min-h-[44px]">
            Publish bundle
          </Button>
        </div>
    </Modal>
  );
};

export default CreateBundleModal;
