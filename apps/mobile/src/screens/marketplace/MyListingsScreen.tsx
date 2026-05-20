// ===========================================
// Lantern Study Mobile - My Listings Screen
// ===========================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore, getCategoryInfo, type MarketplaceListing } from '../../stores/marketplaceStore';
import { useTheme } from '../../theme';

export default function MyListingsScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'sold' | 'inactive'>('all');
  const { colors } = useTheme();

  const { myListings, isLoading, fetchMyListings, deleteListing, updateListing } = useMarketplaceStore();

  useEffect(() => {
    fetchMyListings('demo-user');
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMyListings('demo-user');
    setRefreshing(false);
  }, [fetchMyListings]);

  const filteredListings = myListings.filter(listing => {
    if (activeFilter === 'all') return true;
    return listing.status === activeFilter;
  });

  const getCategoryIcon = (category: string): keyof typeof Ionicons.glyphMap => {
    const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
      textbook_exchange: 'book',
      pq_bank: 'sparkles',
      lecture_notes: 'document-text',
      project_thesis: 'briefcase',
      data_collection: 'bar-chart',
      equipment_rental: 'flask',
      accommodation: 'home',
      travel_transport: 'car',
      personal_goods: 'gift',
      aso_ebi: 'shirt',
      campus_services: 'people',
      events_social: 'ticket',
    };
    return iconMap[category] || 'help-circle';
  };

  const formatPrice = (price?: number) => {
    if (!price) return 'Free';
    return `₦${price.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleEditListing = useCallback((listing: MarketplaceListing) => {
    // Would navigate to edit screen
    Alert.alert('Edit', 'Editing functionality coming soon!');
  }, []);

  const handleDeleteListing = useCallback((listing: MarketplaceListing) => {
    Alert.alert(
      'Delete Listing',
      `Are you sure you want to delete "${listing.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteListing(listing.id);
              Alert.alert('Success', 'Listing deleted successfully.');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete listing.');
            }
          }
        },
      ]
    );
  }, [deleteListing]);

  const handleToggleStatus = useCallback(async (listing: MarketplaceListing) => {
    const newStatus = listing.status === 'active' ? 'inactive' : 'active';
    try {
      await updateListing(listing.id, { status: newStatus });
    } catch (error) {
      Alert.alert('Error', 'Failed to update listing status.');
    }
  }, [updateListing]);

  const handleMarkAsSold = useCallback((listing: MarketplaceListing) => {
    Alert.alert(
      'Mark as Sold',
      'This will mark your listing as sold and remove it from search results.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Mark Sold', 
          onPress: async () => {
            try {
              await updateListing(listing.id, { status: 'sold' });
            } catch (error) {
              Alert.alert('Error', 'Failed to update listing.');
            }
          }
        },
      ]
    );
  }, [updateListing]);

  const renderListingItem = useCallback(({ item }: { item: MarketplaceListing }) => {
    const categoryInfo = getCategoryInfo(item.category);
    
    return (
      <TouchableOpacity
        style={[styles.listingCard, { backgroundColor: colors.card }]}
        onPress={() => navigation.navigate('Marketplace', {
          screen: 'ListingDetail',
          params: { listingId: item.id },
        })}
        activeOpacity={0.7}
      >
        {/* Image */}
        <View style={[styles.imageContainer, { backgroundColor: colors.border }]}>
          {item.images && item.images.length > 0 ? (
            <Image source={{ uri: item.images[0] }} style={styles.listingImage} />
          ) : (
            <View style={styles.placeholderImage}>
              <Ionicons name={getCategoryIcon(item.category)} size={32} color={colors.textSecondary} />
            </View>
          )}
          
          {/* Status Badge */}
          <View style={[styles.statusBadge, 
            item.status === 'sold' && styles.statusBadgeSold,
            item.status === 'inactive' && styles.statusBadgeInactive
          ]}>
            <Text style={styles.statusBadgeText}>
              {item.status === 'active' ? 'Active' : item.status === 'sold' ? 'Sold' : 'Inactive'}
            </Text>
          </View>
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={[styles.listingTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.listingPrice}>{formatPrice(item.price)}</Text>
          </View>
          
          <View style={styles.categoryRow}>
            <Ionicons name={getCategoryIcon(item.category)} size={12} color="#6366f1" />
            <Text style={[styles.categoryText, { color: colors.textSecondary }]}>{categoryInfo.name}</Text>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="eye-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{item.views_count || 0}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="heart-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.statText, { color: colors.textSecondary }]}>{item.favorites_count || 0}</Text>
            </View>
            <Text style={[styles.dateText, { color: colors.textSecondary }]}>{formatDate(item.created_at)}</Text>
          </View>

          {/* Actions */}
          <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleEditListing(item)}
            >
              <Ionicons name="pencil" size={16} color="#6366f1" />
              <Text style={styles.actionButtonText}>Edit</Text>
            </TouchableOpacity>

            {item.status === 'active' && (
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => handleMarkAsSold(item)}
              >
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <Text style={[styles.actionButtonText, { color: '#22c55e' }]}>Sold</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleToggleStatus(item)}
            >
              <Ionicons 
                name={item.status === 'active' ? 'eye-off' : 'eye'} 
                size={16} 
                color="#f59e0b" 
              />
              <Text style={[styles.actionButtonText, { color: '#f59e0b' }]}>
                {item.status === 'active' ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleDeleteListing(item)}
            >
              <Ionicons name="trash" size={16} color="#ef4444" />
              <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [navigation, handleEditListing, handleMarkAsSold, handleToggleStatus, handleDeleteListing, colors]);

  const ListHeaderComponent = () => (
    <View style={styles.filters}>
      {(['all', 'active', 'sold', 'inactive'] as const).map(filter => (
        <TouchableOpacity
          key={filter}
          style={[styles.filterChip, { backgroundColor: colors.card }, activeFilter === filter && styles.filterChipActive]}
          onPress={() => setActiveFilter(filter)}
        >
          <Text style={[styles.filterChipText, { color: colors.textSecondary }, activeFilter === filter && styles.filterChipTextActive]}>
            {filter.charAt(0).toUpperCase() + filter.slice(1)}
            {filter !== 'all' && ` (${myListings.filter(l => l.status === filter).length})`}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
        <Ionicons name="storefront-outline" size={64} color="#6366f1" />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {activeFilter === 'all' ? 'No listings yet' : `No ${activeFilter} listings`}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {activeFilter === 'all' 
          ? 'Create your first listing and start selling!'
          : 'Your listings with this status will appear here.'}
      </Text>
      {activeFilter === 'all' && (
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => navigation.navigate('CreateListing')}
        >
          <Ionicons name="add" size={20} color="#ffffff" />
          <Text style={styles.createButtonText}>Create Listing</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Listings</Text>
        <TouchableOpacity 
          style={styles.addButton}
          onPress={() => navigation.navigate('CreateListing')}
        >
          <Ionicons name="add" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Listings */}
      <FlatList
        data={filteredListings}
        keyExtractor={(item) => item.id}
        renderItem={renderListingItem}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={!isLoading ? ListEmptyComponent : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
            colors={['#6366f1']}
          />
        }
      />

      {isLoading && filteredListings.length === 0 && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  filters: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1e293b',
  },
  filterChipActive: {
    backgroundColor: '#6366f1',
  },
  filterChipText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  filterChipTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  listingCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  imageContainer: {
    height: 120,
    backgroundColor: '#334155',
    position: 'relative',
  },
  listingImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholderImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#22c55e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeSold: {
    backgroundColor: '#6366f1',
  },
  statusBadgeInactive: {
    backgroundColor: '#6b7280',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
  },
  cardContent: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  listingTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginRight: 12,
  },
  listingPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  categoryText: {
    fontSize: 12,
    color: '#6366f1',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#6b7280',
  },
  dateText: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 'auto',
  },
  actionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
