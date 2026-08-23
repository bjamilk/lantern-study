import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createMarketplaceBundle, fetchMarketplaceCampuses } from '../../../services/api';
import type { MarketplaceListing } from '@lantern/shared/types';
import { isOtherCityCampus, isDigitalListingKind, type MarketplaceCampus } from '@lantern/shared/marketplace';
import { Button } from '../../../components/ui';
import { CampusPicker } from '../CampusPicker';
import { formatPrice } from '../marketplaceHelpers';

interface Props {
  visible: boolean;
  listings: MarketplaceListing[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateBundleModal({ visible, listings, onClose, onCreated }: Props) {
  const activeListings = useMemo(
    () =>
      listings.filter(
        l =>
          l.status === 'active' &&
          l.listing_kind !== 'bundle' &&
          // Digital products can't be bundled into a physical meetup sale.
          !isDigitalListingKind(l.listing_kind) &&
          (l.category_specific_fields as { digital?: boolean } | undefined)?.digital !== true
      ),
    [listings]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedCampus = campuses.find(campus => campus.id === campusId);
  const usesOtherCity = isOtherCityCampus(selectedCampus);

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then(rows => setCampuses(rows))
      .catch(() => setCampuses([]));
  }, []);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const suggestedPrice = useMemo(() => {
    let sum = 0;
    for (const id of selected) {
      const listing = activeListings.find(l => l.id === id);
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
        campusId,
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-lantern-surface rounded-t-3xl max-h-[90%]">
          <View className="flex-row items-center justify-between p-4 border-b border-lantern-border">
            <Text className="text-lg font-bold">Create bundle</Text>
            <Pressable onPress={onClose}><Text className="text-lantern-primary font-semibold">Close</Text></Pressable>
          </View>
          <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 24 }}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Bundle title"
              className="border border-lantern-border rounded-xl px-3 py-2 mb-2 text-lantern-text"
              placeholderTextColor="#94a3b8"
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              multiline
              className="border border-lantern-border rounded-xl px-3 py-2 mb-2 min-h-[60px] text-lantern-text"
              placeholderTextColor="#94a3b8"
            />
            <Text className="text-xs font-semibold text-lantern-text mb-1">Campus or city *</Text>
            <CampusPicker
              campuses={campuses}
              value={campusId}
              onChange={nextCampusId => {
                const nextCampus = campuses.find(campus => campus.id === nextCampusId);
                // Switching in/out of "Other — city" clears the stale free-text city.
                if (isOtherCityCampus(selectedCampus) !== isOtherCityCampus(nextCampus)) {
                  setLocation('');
                }
                setCampusId(nextCampusId);
              }}
              emptyLabel="Select campus or Other city"
            />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder={
                usesOtherCity
                  ? 'City in Nigeria (required)'
                  : 'Pickup or delivery details (optional)'
              }
              className="border border-lantern-border rounded-xl px-3 py-2 mt-2 mb-3 text-lantern-text"
              placeholderTextColor="#94a3b8"
            />

            <Text className="text-xs text-lantern-text-secondary mb-2">Select listings (min 2)</Text>
            {activeListings.map(l => (
              <Pressable
                key={l.id}
                onPress={() => toggle(l.id)}
                className={`flex-row items-center justify-between p-3 mb-2 rounded-xl border ${
                  selected.has(l.id) ? 'border-lantern-primary bg-lantern-primary-background dark:bg-lantern-primary-background' : 'border-lantern-border'
                }`}
              >
                <Text className="flex-1 text-sm font-medium text-lantern-text" numberOfLines={1}>
                  {l.title}
                </Text>
                <Text className="text-sm text-lantern-primary">{formatPrice(l.price)}</Text>
              </Pressable>
            ))}
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder={suggestedPrice ? `Suggested ${formatPrice(suggestedPrice)}` : 'Bundle price'}
              keyboardType="numeric"
              className="border border-lantern-border rounded-xl px-3 py-2 mb-2 text-lantern-text"
              placeholderTextColor="#94a3b8"
            />
            {error ? <Text className="text-sm text-red-600 mb-2">{error}</Text> : null}
            <Button loading={saving} onPress={() => void handleCreate()}>Create bundle</Button>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
