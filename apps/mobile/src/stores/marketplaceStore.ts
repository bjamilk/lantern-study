/**
 * Marketplace Store
 * Manages marketplace listings and favorites with local-first pattern
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../services/api';
import { syncService } from '../services/syncService';

// Demo mode flag
const DEMO_MODE = false;

// Storage keys
const LISTINGS_STORAGE_KEY = 'lantern_marketplace_listings';
const MY_LISTINGS_STORAGE_KEY = 'lantern_my_listings';
const FAVORITES_STORAGE_KEY = 'lantern_marketplace_favorites';

export interface MarketplaceListing {
  id: string;
  user_id: string;
  seller_id?: string;
  seller?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  category: string;
  title: string;
  description?: string;
  price?: number;
  location?: string;
  images?: string[];
  status: 'active' | 'sold' | 'inactive';
  views_count?: number;
  favorites_count?: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceReview {
  id: string;
  listing_id: string;
  reviewer_id: string;
  reviewer?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  rating: number;
  comment?: string;
  created_at: string;
}

export interface MarketplaceInquiry {
  id: string;
  listing_id: string;
  sender_id: string;
  sender?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  listing?: MarketplaceListing;
  message: string;
  created_at: string;
}

export type MarketplaceCategory = 
  | 'textbook_exchange' 
  | 'pq_bank' 
  | 'lecture_notes' 
  | 'project_thesis' 
  | 'data_collection' 
  | 'equipment_rental'
  | 'accommodation' 
  | 'travel_transport' 
  | 'personal_goods' 
  | 'aso_ebi' 
  | 'campus_services' 
  | 'events_social';

export type MarketplaceTab = 'academic' | 'student-life';

export const ACADEMIC_CATEGORIES: { id: MarketplaceCategory; name: string; icon: string }[] = [
  { id: 'textbook_exchange', name: 'Textbooks', icon: 'book' },
  { id: 'pq_bank', name: 'Past Questions', icon: 'sparkles' },
  { id: 'lecture_notes', name: 'Lecture Notes', icon: 'document-text' },
  { id: 'project_thesis', name: 'Projects & Thesis', icon: 'briefcase' },
  { id: 'data_collection', name: 'Data Collection', icon: 'chart-bar' },
  { id: 'equipment_rental', name: 'Lab Equipment', icon: 'beaker' },
];

export const STUDENT_LIFE_CATEGORIES: { id: MarketplaceCategory; name: string; icon: string }[] = [
  { id: 'accommodation', name: 'Accommodation', icon: 'home' },
  { id: 'travel_transport', name: 'Transportation', icon: 'car' },
  { id: 'personal_goods', name: 'Personal Goods', icon: 'gift' },
  { id: 'aso_ebi', name: 'Fashion', icon: 'shirt-outline' },
  { id: 'campus_services', name: 'Campus Services', icon: 'people' },
  { id: 'events_social', name: 'Events & Social', icon: 'ticket' },
];

// Mock data for demo mode
const DEMO_LISTINGS: MarketplaceListing[] = [
  {
    id: 'listing-1',
    user_id: 'seller-1',
    seller_id: 'seller-1',
    seller: { id: 'seller-1', name: 'John Doe', avatarUrl: undefined },
    category: 'textbook_exchange',
    title: 'Organic Chemistry Textbook (7th Edition)',
    description: 'Barely used, excellent condition. Great for CHM 201/202. Includes solutions manual.',
    price: 15000,
    location: 'University of Lagos',
    images: ['https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400'],
    status: 'active',
    views_count: 45,
    favorites_count: 12,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-2',
    user_id: 'seller-2',
    seller_id: 'seller-2',
    seller: { id: 'seller-2', name: 'Jane Smith', avatarUrl: undefined },
    category: 'pq_bank',
    title: '300 Level Engineering Past Questions (2018-2023)',
    description: 'Complete past questions and answers for all 300 level engineering courses. PDF format.',
    price: 5000,
    location: 'Federal University of Technology',
    images: ['https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400'],
    status: 'active',
    views_count: 128,
    favorites_count: 34,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-3',
    user_id: 'seller-3',
    seller_id: 'seller-3',
    seller: { id: 'seller-3', name: 'Mike Johnson', avatarUrl: undefined },
    category: 'accommodation',
    title: 'Self-Contain Apartment Near Campus',
    description: 'Spacious self-contain with 24/7 power supply, water, and good security. 5 mins walk to campus.',
    price: 250000,
    location: 'Akoka, Lagos',
    images: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400'],
    status: 'active',
    views_count: 89,
    favorites_count: 23,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-4',
    user_id: 'seller-4',
    seller_id: 'seller-4',
    seller: { id: 'seller-4', name: 'Sarah Williams', avatarUrl: undefined },
    category: 'lecture_notes',
    title: 'Complete Medical School Notes (200-500 Level)',
    description: 'Well-organized notes covering all major topics. Includes diagrams and mnemonics.',
    price: 8000,
    location: 'College of Medicine, LUTH',
    images: ['https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400'],
    status: 'active',
    views_count: 156,
    favorites_count: 67,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-5',
    user_id: 'seller-5',
    seller_id: 'seller-5',
    seller: { id: 'seller-5', name: 'David Brown', avatarUrl: undefined },
    category: 'personal_goods',
    title: 'HP Laptop - Core i5, 8GB RAM, 256GB SSD',
    description: 'Student laptop in great condition. Perfect for programming and office work. Battery lasts 5+ hours.',
    price: 180000,
    location: 'Ibadan',
    images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400'],
    status: 'active',
    views_count: 234,
    favorites_count: 45,
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'listing-6',
    user_id: 'seller-6',
    seller_id: 'seller-6',
    seller: { id: 'seller-6', name: 'Emily Davis', avatarUrl: undefined },
    category: 'events_social',
    title: 'Dinner Party Tickets - Faculty Week',
    description: 'VIP tickets for the annual Faculty Dinner & Awards Night. Includes free meal and drinks.',
    price: 7500,
    location: 'Main Auditorium',
    images: ['https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400'],
    status: 'active',
    views_count: 67,
    favorites_count: 18,
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEMO_MY_LISTINGS: MarketplaceListing[] = [
  {
    id: 'my-listing-1',
    user_id: 'demo-user',
    seller_id: 'demo-user',
    seller: { id: 'demo-user', name: 'Demo User', avatarUrl: undefined },
    category: 'textbook_exchange',
    title: 'Calculus Early Transcendentals (8th Ed)',
    description: 'Selling my calculus textbook. Some highlighting but in good condition overall.',
    price: 12000,
    location: 'Campus Library',
    images: [],
    status: 'active',
    views_count: 23,
    favorites_count: 5,
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DEMO_INQUIRIES: MarketplaceInquiry[] = [
  {
    id: 'inquiry-1',
    listing_id: 'my-listing-1',
    sender_id: 'buyer-1',
    sender: { id: 'buyer-1', name: 'Alice Cooper', avatarUrl: undefined },
    listing: DEMO_MY_LISTINGS[0],
    message: 'Hi, is this textbook still available? Can you do ₦10,000?',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'inquiry-2',
    listing_id: 'my-listing-1',
    sender_id: 'buyer-2',
    sender: { id: 'buyer-2', name: 'Bob Wilson', avatarUrl: undefined },
    listing: DEMO_MY_LISTINGS[0],
    message: 'Can I pick it up tomorrow at the library?',
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
];

interface MarketplaceState {
  listings: MarketplaceListing[];
  myListings: MarketplaceListing[];
  currentListing: MarketplaceListing | null;
  favorites: Set<string>;
  inquiries: MarketplaceInquiry[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  selectedCategory: MarketplaceCategory | null;
  activeTab: MarketplaceTab;
  
  // Actions
  fetchListings: (filters?: { category?: string; search?: string }) => Promise<void>;
  fetchMyListings: (userId: string) => Promise<void>;
  fetchListing: (listingId: string) => Promise<void>;
  fetchInquiries: (userId: string) => Promise<void>;
  createListing: (listing: Omit<MarketplaceListing, 'id' | 'created_at' | 'updated_at' | 'views_count' | 'favorites_count'>, userId: string) => Promise<MarketplaceListing>;
  updateListing: (listingId: string, updates: Partial<MarketplaceListing>, userId: string) => Promise<void>;
  deleteListing: (listingId: string, userId: string) => Promise<void>;
  toggleFavorite: (listingId: string, userId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: MarketplaceCategory | null) => void;
  setActiveTab: (tab: MarketplaceTab) => void;
  sendInquiry: (listingId: string, message: string) => Promise<void>;
  clearError: () => void;
  // Local storage helpers
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  listings: [],
  myListings: [],
  currentListing: null,
  favorites: new Set(),
  inquiries: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  selectedCategory: null,
  activeTab: 'academic',
  
  // Load cached data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [listingsJson, myListingsJson, favoritesJson] = await Promise.all([
        AsyncStorage.getItem(LISTINGS_STORAGE_KEY),
        AsyncStorage.getItem(MY_LISTINGS_STORAGE_KEY),
        AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
      ]);
      
      if (listingsJson) {
        set({ listings: JSON.parse(listingsJson) });
      }
      if (myListingsJson) {
        set({ myListings: JSON.parse(myListingsJson) });
      }
      if (favoritesJson) {
        set({ favorites: new Set(JSON.parse(favoritesJson)) });
      }
    } catch (error) {
      console.error('Failed to load marketplace from storage:', error);
    }
  },
  
  // Save current state to AsyncStorage
  saveToStorage: async () => {
    try {
      const { listings, myListings, favorites } = get();
      await Promise.all([
        AsyncStorage.setItem(LISTINGS_STORAGE_KEY, JSON.stringify(listings)),
        AsyncStorage.setItem(MY_LISTINGS_STORAGE_KEY, JSON.stringify(myListings)),
        AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites])),
      ]);
    } catch (error) {
      console.error('Failed to save marketplace to storage:', error);
    }
  },
  
  fetchListings: async (filters) => {
    try {
      set({ isLoading: true, error: null });
      
      // Load from local storage first for instant UI
      await get().loadFromStorage();
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        let filtered = [...DEMO_LISTINGS];
        const { activeTab, selectedCategory, searchQuery } = get();
        
        // Filter by tab
        const academicCategories = ACADEMIC_CATEGORIES.map(c => c.id);
        const studentLifeCategories = STUDENT_LIFE_CATEGORIES.map(c => c.id);
        
        filtered = filtered.filter(listing => {
          if (activeTab === 'academic') {
            return academicCategories.includes(listing.category as MarketplaceCategory);
          }
          return studentLifeCategories.includes(listing.category as MarketplaceCategory);
        });
        
        // Filter by category
        if (selectedCategory || filters?.category) {
          const cat = selectedCategory || filters?.category;
          filtered = filtered.filter(l => l.category === cat);
        }
        
        // Filter by search
        const query = searchQuery || filters?.search || '';
        if (query) {
          const lowerQuery = query.toLowerCase();
          filtered = filtered.filter(l => 
            l.title.toLowerCase().includes(lowerQuery) ||
            l.description?.toLowerCase().includes(lowerQuery)
          );
        }
        
        set({ listings: filtered, isLoading: false });
        return;
      }
      
      // Real API call
      const { activeTab, selectedCategory, searchQuery } = get();
      const apiListings = await api.fetchMarketplaceListings({
        category: selectedCategory || filters?.category,
        search: searchQuery || filters?.search,
      });
      
      // Map API response
      const listings: MarketplaceListing[] = apiListings.map((l) => ({
        id: l.id,
        user_id: l.user_id,
        seller_id: l.user_id,
        seller: l.seller ? {
          id: l.seller.id,
          name: l.seller.name,
          avatarUrl: l.seller.avatar_url,
        } : undefined,
        category: l.category,
        title: l.title,
        description: l.description,
        price: l.price,
        location: l.location,
        images: l.images || [],
        status: l.status,
        views_count: l.views_count || 0,
        favorites_count: l.favorites_count || 0,
        created_at: l.created_at,
        updated_at: l.updated_at,
      }));
      
      // Filter by tab (client-side if API doesn't support it)
      const academicCategories = ACADEMIC_CATEGORIES.map(c => c.id);
      const studentLifeCategories = STUDENT_LIFE_CATEGORIES.map(c => c.id);
      const filtered = listings.filter(listing => {
        if (activeTab === 'academic') {
          return academicCategories.includes(listing.category as MarketplaceCategory);
        }
        return studentLifeCategories.includes(listing.category as MarketplaceCategory);
      });
      
      set({ listings: filtered, isLoading: false });
      await get().saveToStorage();
    } catch (error: any) {
      console.error('Failed to fetch listings:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchMyListings: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ myListings: DEMO_MY_LISTINGS, isLoading: false });
        return;
      }
      
      // Try API call
      try {
        const apiListings = await api.fetchMyListings();
        const myListings: MarketplaceListing[] = apiListings.map((l) => ({
          id: l.id,
          user_id: l.user_id,
          seller_id: l.user_id,
          seller: l.seller ? {
            id: l.seller.id,
            name: l.seller.name,
            avatarUrl: l.seller.avatar_url,
          } : undefined,
          category: l.category,
          title: l.title,
          description: l.description,
          price: l.price,
          location: l.location,
          images: l.images || [],
          status: l.status,
          views_count: l.views_count || 0,
          favorites_count: l.favorites_count || 0,
          created_at: l.created_at,
          updated_at: l.updated_at,
        }));
        set({ myListings, isLoading: false });
        await get().saveToStorage();
      } catch (apiError) {
        console.warn('Failed to fetch my listings from API, using cached:', apiError);
        set({ isLoading: false });
      }
    } catch (error: any) {
      console.error('Failed to fetch my listings:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchListing: async (listingId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const allListings = [...DEMO_LISTINGS, ...DEMO_MY_LISTINGS];
        const listing = allListings.find(l => l.id === listingId) || null;
        set({ currentListing: listing, isLoading: false });
        return;
      }
      
      const l = await api.fetchMarketplaceListing(listingId);
      const currentListing: MarketplaceListing = {
        id: l.id,
        user_id: l.user_id,
        seller_id: l.user_id,
        seller: l.seller ? {
          id: l.seller.id,
          name: l.seller.name,
          avatarUrl: l.seller.avatar_url,
        } : undefined,
        category: l.category,
        title: l.title,
        description: l.description,
        price: l.price,
        location: l.location,
        images: l.images || [],
        status: l.status,
        views_count: l.views_count || 0,
        favorites_count: l.favorites_count || 0,
        created_at: l.created_at,
        updated_at: l.updated_at,
      };
      set({ currentListing, isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch listing:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  fetchInquiries: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        set({ inquiries: DEMO_INQUIRIES, isLoading: false });
        return;
      }
      
      // Note: fetchMarketplaceInquiries not available in current API
      // Using empty array as placeholder until API is extended
      set({ inquiries: [], isLoading: false });
    } catch (error: any) {
      console.error('Failed to fetch inquiries:', error);
      set({ error: error.message, isLoading: false });
    }
  },
  
  createListing: async (listingData, userId) => {
    // Create temp ID for optimistic update
    const tempId = `temp_listing_${Date.now()}`;
    const tempListing: MarketplaceListing = {
      ...listingData,
      id: tempId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      views_count: 0,
      favorites_count: 0,
    };
    
    // Optimistic update
    set(state => ({
      myListings: [tempListing, ...state.myListings],
      listings: [tempListing, ...state.listings],
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) {
      return tempListing;
    }
    
    try {
      const created = await api.createMarketplaceListing({
        category: listingData.category,
        title: listingData.title,
        description: listingData.description,
        price: listingData.price,
        location: listingData.location,
        images: listingData.images,
      });
      
      const newListing: MarketplaceListing = {
        id: created.id,
        user_id: created.user_id,
        seller_id: created.user_id,
        category: created.category,
        title: created.title,
        description: created.description,
        price: created.price,
        location: created.location,
        images: created.images || [],
        status: created.status,
        views_count: 0,
        favorites_count: 0,
        created_at: created.created_at,
        updated_at: created.updated_at,
      };
      
      // Replace temp with real listing
      set(state => ({
        myListings: state.myListings.map(l => l.id === tempId ? newListing : l),
        listings: state.listings.map(l => l.id === tempId ? newListing : l),
      }));
      await get().saveToStorage();
      
      return newListing;
    } catch (error: any) {
      console.error('Failed to create listing on server:', error);
      // Queue for later sync
      await syncService.queueOperation('notification', tempId, 'create', listingData, userId);
      return tempListing;
    }
  },
  
  updateListing: async (listingId: string, updates: Partial<MarketplaceListing>, userId: string) => {
    // Optimistic update
    set(state => ({
      myListings: state.myListings.map(l => 
        l.id === listingId ? { ...l, ...updates, updated_at: new Date().toISOString() } : l
      ),
      listings: state.listings.map(l =>
        l.id === listingId ? { ...l, ...updates, updated_at: new Date().toISOString() } : l
      ),
      currentListing: state.currentListing?.id === listingId 
        ? { ...state.currentListing, ...updates, updated_at: new Date().toISOString() }
        : state.currentListing,
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) return;
    
    try {
      await api.updateMarketplaceListing(listingId, updates);
    } catch (error: any) {
      console.error('Failed to update listing on server:', error);
      // Queue for later sync (keep local changes)
      await syncService.queueOperation('notification', listingId, 'update', updates, userId);
    }
  },
  
  deleteListing: async (listingId: string, userId: string) => {
    // Optimistic delete
    set(state => ({
      myListings: state.myListings.filter(l => l.id !== listingId),
      listings: state.listings.filter(l => l.id !== listingId),
      currentListing: state.currentListing?.id === listingId ? null : state.currentListing,
    }));
    await get().saveToStorage();
    
    if (DEMO_MODE) return;
    
    try {
      await api.deleteMarketplaceListing(listingId);
    } catch (error: any) {
      console.error('Failed to delete listing on server:', error);
      // Queue for later sync
      await syncService.queueOperation('notification', listingId, 'delete', {}, userId);
    }
  },
  
  toggleFavorite: async (listingId: string, userId: string) => {
    const { favorites } = get();
    const newFavorites = new Set(favorites);
    const isFavorited = newFavorites.has(listingId);
    
    if (isFavorited) {
      newFavorites.delete(listingId);
    } else {
      newFavorites.add(listingId);
    }
    
    // Optimistic update
    set({ favorites: newFavorites });
    await get().saveToStorage();
    
    // Sync with API
    if (!DEMO_MODE) {
      try {
        if (isFavorited) {
          await api.removeFromFavorites(listingId);
        } else {
          await api.addToFavorites(listingId);
        }
      } catch (error) {
        // Revert on error
        console.error('Failed to toggle favorite:', error);
        if (isFavorited) {
          newFavorites.add(listingId);
        } else {
          newFavorites.delete(listingId);
        }
        set({ favorites: newFavorites });
        await get().saveToStorage();
      }
    }
  },
  
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
  
  setSelectedCategory: (category: MarketplaceCategory | null) => {
    set({ selectedCategory: category });
  },
  
  setActiveTab: (tab: MarketplaceTab) => {
    set({ activeTab: tab, selectedCategory: null });
  },
  
  sendInquiry: async (listingId: string, message: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
        // Would create inquiry in real app
        set({ isLoading: false });
        return;
      }
      
      // Note: sendMarketplaceInquiry not available in current API
      // Would need to implement this endpoint
      console.warn('sendInquiry: API endpoint not yet available');
      set({ isLoading: false });
    } catch (error: any) {
      console.error('Failed to send inquiry:', error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },
  
  clearError: () => set({ error: null }),
}));

// Helper to get category info
export const getCategoryInfo = (categoryId: string) => {
  const allCategories = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
  return allCategories.find(c => c.id === categoryId) || { id: categoryId, name: categoryId, icon: 'help-circle' };
};
