// ===========================================
// Lantern Study Mobile - Marketplace Screen
// ===========================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { 
  useMarketplaceStore, 
  ACADEMIC_CATEGORIES, 
  STUDENT_LIFE_CATEGORIES,
  getCategoryInfo,
  type MarketplaceListing,
  type MarketplaceCategory,
} from '../../stores/marketplaceStore';
import { useTheme } from '../../theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function MarketplaceScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { colors } = useTheme();
  
  const {
    listings,
    favorites,
    isLoading,
    searchQuery,
    selectedCategory,
    activeTab,
    fetchListings,
    toggleFavorite,
    setSearchQuery,
    setSelectedCategory,
    setActiveTab,
  } = useMarketplaceStore();

  useEffect(() => {
    fetchListings();
  }, [activeTab, selectedCategory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }, [fetchListings]);

  const handleSearch = useCallback(() => {
    fetchListings({ search: searchQuery });
  }, [searchQuery, fetchListings]);

  const handleListingPress = useCallback((listing: MarketplaceListing) => {
    navigation.navigate('ListingDetail', { listingId: listing.id });
  }, [navigation]);

  const handleCreateListing = useCallback(() => {
    navigation.navigate('CreateListing');
  }, [navigation]);

  const currentCategories = activeTab === 'academic' ? ACADEMIC_CATEGORIES : STUDENT_LIFE_CATEGORIES;

  const formatPrice = (price?: number) => {
    if (!price) return 'Free';
    return `₦${price.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
  };

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

  const renderListingCard = useCallback(({ item }: { item: MarketplaceListing }) => {
    const isFavorite = favorites.has(item.id);
    const categoryInfo = getCategoryInfo(item.category);
    
    return (
      <TouchableOpacity
        style={[styles.listingCard, { backgroundColor: colors.card }]}
        onPress={() => handleListingPress(item)}
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
          
          {/* Favorite Button */}
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => toggleFavorite(item.id)}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={20}
              color={isFavorite ? '#ef4444' : '#9ca3af'}
            />
          </TouchableOpacity>
          
          {/* Category Badge */}
          <View style={styles.categoryBadge}>
            <Ionicons name={getCategoryIcon(item.category)} size={10} color="#ffffff" />
            <Text style={styles.categoryBadgeText}>{categoryInfo.name}</Text>
          </View>
        </View>
        
        {/* Content */}
        <View style={styles.cardContent}>
          <Text style={[styles.listingTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
          
          <Text style={styles.listingPrice}>{formatPrice(item.price)}</Text>
          
          <View style={styles.listingMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>{item.location || 'N/A'}</Text>
            </View>
            <Text style={[styles.metaDate, { color: colors.textSecondary }]}>{formatDate(item.created_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [favorites, handleListingPress, toggleFavorite, colors]);

  const ListHeaderComponent = useMemo(() => (
    <View style={styles.listHeader}>
      {/* Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'academic' && [styles.tabActive, { backgroundColor: colors.background }]]}
          onPress={() => setActiveTab('academic')}
        >
          <Ionicons 
            name="school" 
            size={18} 
            color={activeTab === 'academic' ? '#6366f1' : colors.textSecondary} 
          />
          <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'academic' && styles.tabTextActive]}>
            Academic
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, activeTab === 'student-life' && [styles.tabActive, { backgroundColor: colors.background }]]}
          onPress={() => setActiveTab('student-life')}
        >
          <Ionicons 
            name="briefcase" 
            size={18} 
            color={activeTab === 'student-life' ? '#6366f1' : colors.textSecondary} 
          />
          <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'student-life' && styles.tabTextActive]}>
            Student Life
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card }]}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={`Search ${activeTab === 'academic' ? 'academic resources' : 'student essentials'}...`}
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Ionicons name="options" size={20} color="#6366f1" />
        </TouchableOpacity>
      </View>

      {/* Category Filters */}
      {showFilters && (
        <View style={styles.filtersContainer}>
          <Text style={[styles.filtersTitle, { color: colors.textSecondary }]}>Categories</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: colors.card }, !selectedCategory && styles.filterChipActive]}
              onPress={() => setSelectedCategory(null)}
            >
              <Text style={[styles.filterChipText, { color: colors.textSecondary }, !selectedCategory && styles.filterChipTextActive]}>
                All
              </Text>
            </TouchableOpacity>
            
            {currentCategories.map(category => (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.card },
                  selectedCategory === category.id && styles.filterChipActive
                ]}
                onPress={() => setSelectedCategory(category.id)}
              >
                <Ionicons 
                  name={getCategoryIcon(category.id)} 
                  size={14} 
                  color={selectedCategory === category.id ? '#ffffff' : colors.textSecondary} 
                />
                <Text style={[
                  styles.filterChipText,
                  { color: colors.textSecondary },
                  selectedCategory === category.id && styles.filterChipTextActive
                ]}>
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Results Count */}
      <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
        {listings.length} listing{listings.length !== 1 ? 's' : ''}
      </Text>
    </View>
  ), [activeTab, searchQuery, selectedCategory, showFilters, listings.length, currentCategories, handleSearch, colors]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
        <Ionicons name="storefront-outline" size={64} color="#6366f1" />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No listings found</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {searchQuery || selectedCategory
          ? "Try adjusting your search or filters"
          : "Be the first to create a listing!"
        }
      </Text>
      <TouchableOpacity style={styles.createButton} onPress={handleCreateListing}>
        <Ionicons name="add" size={20} color="#ffffff" />
        <Text style={styles.createButtonText}>Create Listing</Text>
      </TouchableOpacity>
    </View>
  ), [searchQuery, selectedCategory, handleCreateListing, colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Marketplace</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Discover resources & essentials</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={[styles.headerButton, { backgroundColor: colors.card }]}
            onPress={() => navigation.navigate('MyListings')}
          >
            <Ionicons name="list" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.headerButton, { backgroundColor: colors.card }]}
            onPress={() => navigation.navigate('Inquiries')}
          >
            <Ionicons name="chatbubbles" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={handleCreateListing}>
            <Ionicons name="add" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Listings Grid */}
      <FlatList
        data={listings}
        keyExtractor={(item) => item.id}
        renderItem={renderListingCard}
        numColumns={2}
        columnWrapperStyle={styles.row}
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listHeader: {
    marginBottom: 16,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#0f172a',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#6366f1',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: '#ffffff',
  },
  filterButton: {
    padding: 8,
    backgroundColor: '#6366f120',
    borderRadius: 8,
  },
  filtersContainer: {
    marginBottom: 12,
  },
  filtersTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    gap: 6,
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
  resultsCount: {
    fontSize: 14,
    color: '#6b7280',
  },
  row: {
    justifyContent: 'space-between',
  },
  listingCard: {
    width: CARD_WIDTH,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  imageContainer: {
    height: 140,
    backgroundColor: '#334155',
    position: 'relative',
  },
  listingImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
  cardContent: {
    padding: 12,
  },
  listingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 6,
    lineHeight: 18,
  },
  listingPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#6366f1',
    marginBottom: 8,
  },
  listingMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    color: '#6b7280',
    flex: 1,
  },
  metaDate: {
    fontSize: 11,
    color: '#6b7280',
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
});
