import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore } from '../../stores';
import { Button, Card } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';

type NavigationProp = {
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { listingId?: string } };
}

export function MakeOfferScreen({ navigation, route }: Props) {
  const listingId = route.params?.listingId ?? '';
  const { currentListing, fetchListing, createMarketplaceOffer, isLoading } = useMarketplaceStore();

  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (listingId) void fetchListing(listingId);
  }, [listingId, fetchListing]);

  useEffect(() => {
    if (currentListing?.price) {
      setAmount(String(Math.round(currentListing.price * 0.8)));
    }
  }, [currentListing?.price]);

  const listing = currentListing;
  const parsedAmount = parseFloat(amount.replace(/,/g, ''));
  const percentage =
    listing?.price && parsedAmount > 0
      ? Math.round((parsedAmount / listing.price) * 100)
      : 0;

  const handleSubmit = async () => {
    if (!listing) return;
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid offer amount.');
      return;
    }
    if (listing.price && parsedAmount > listing.price) {
      Alert.alert('Too high', 'Your offer cannot exceed the asking price.');
      return;
    }

    try {
      await createMarketplaceOffer(listing.id, parsedAmount, message.trim() || undefined);
      void import('../../services/productAnalytics').then(({ trackOfferMade }) => {
        trackOfferMade(listing.id);
      });
      Alert.alert('Offer sent', 'The seller will review your offer.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to submit offer. Please try again.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="px-4 pt-2 pb-3 flex-row items-center">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <Text className="text-xl font-bold text-lantern-text">Make an Offer</Text>
        </View>

        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
          {listing ? (
            <Card className="mb-4">
              <Text className="text-xs text-lantern-text-secondary mb-1">Making an offer on</Text>
              <Text className="text-base font-semibold text-lantern-text" numberOfLines={2}>
                {listing.title}
              </Text>
              <Text className="text-lg font-bold text-lantern-primary mt-1">
                {formatPrice(listing.price)}
              </Text>
            </Card>
          ) : null}

          <Text className="text-sm font-semibold text-lantern-text mb-2">Your offer (₦) *</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Enter amount"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text text-lg font-semibold mb-1"
          />
          {listing?.price && percentage > 0 ? (
            <Text className="text-xs text-lantern-text-secondary mb-4">
              {percentage}% of asking price
            </Text>
          ) : (
            <View className="mb-4" />
          )}

          <Text className="text-sm font-semibold text-lantern-text mb-2">Message (optional)</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Add a note for the seller…"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="min-h-[100px] p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-6"
          />

          <Button fullWidth loading={isLoading} onPress={handleSubmit}>
            Submit Offer
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
