// ===========================================
// Lantern Study Mobile - Create Listing Screen
// ===========================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { 
  useMarketplaceStore, 
  ACADEMIC_CATEGORIES, 
  STUDENT_LIFE_CATEGORIES,
  type MarketplaceCategory,
  type MarketplaceTab,
} from '../../stores/marketplaceStore';
import { useTheme } from '../../theme';

export default function CreateListingScreen() {
  const navigation = useNavigation<any>();
  const { createListing, isLoading } = useMarketplaceStore();
  const { colors } = useTheme();

  const [activeTab, setActiveTab] = useState<MarketplaceTab>('academic');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const currentCategories = activeTab === 'academic' ? ACADEMIC_CATEGORIES : STUDENT_LIFE_CATEGORIES;

  const getCategoryIcon = (cat: string): keyof typeof Ionicons.glyphMap => {
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
    return iconMap[cat] || 'help-circle';
  };

  const handlePickImages = useCallback(async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Please allow access to your photo library to add images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 5 - images.length,
      });

      if (!result.canceled && result.assets) {
        const newImages = result.assets.map(asset => asset.uri);
        setImages(prev => [...prev, ...newImages].slice(0, 5));
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    }
  }, [images.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const validateForm = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your listing.');
      return false;
    }
    if (!category) {
      Alert.alert('Missing Category', 'Please select a category for your listing.');
      return false;
    }
    return true;
  }, [title, category]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    try {
      await createListing({
        user_id: 'demo-user',
        seller_id: 'demo-user',
        seller: { id: 'demo-user', name: 'Demo User' },
        title: title.trim(),
        description: description.trim() || undefined,
        price: price ? parseInt(price.replace(/,/g, ''), 10) : undefined,
        location: location.trim() || undefined,
        category: category!,
        images,
        status: 'active',
      });

      Alert.alert(
        'Success!',
        'Your listing has been created.',
        [
          {
            text: 'View My Listings',
            onPress: () => navigation.navigate('MyListings'),
          },
          {
            text: 'Create Another',
            onPress: () => {
              setTitle('');
              setDescription('');
              setPrice('');
              setLocation('');
              setCategory(null);
              setImages([]);
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to create listing. Please try again.');
    }
  }, [validateForm, createListing, title, description, price, location, category, images, navigation]);

  const formatPriceInput = (value: string) => {
    // Remove non-numeric characters
    const numericValue = value.replace(/[^0-9]/g, '');
    // Add commas for thousands
    return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Create Listing</Text>
        <TouchableOpacity 
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>Post</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Images Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Photos</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>Add up to 5 photos (optional)</Text>
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
              {images.map((uri, index) => (
                <View key={index} style={styles.imageContainer}>
                  <Image source={{ uri }} style={styles.previewImage} />
                  <TouchableOpacity 
                    style={styles.removeImageButton}
                    onPress={() => handleRemoveImage(index)}
                  >
                    <Ionicons name="close" size={16} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ))}
              
              {images.length < 5 && (
                <TouchableOpacity style={[styles.addImageButton, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handlePickImages}>
                  <Ionicons name="camera" size={32} color="#6366f1" />
                  <Text style={[styles.addImageText, { color: colors.textSecondary }]}>Add Photo</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {/* Category Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Category *</Text>
            
            {/* Tabs */}
            <View style={[styles.tabsContainer, { backgroundColor: colors.card }]}>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'academic' && [styles.tabActive, { backgroundColor: colors.background }]]}
                onPress={() => {
                  setActiveTab('academic');
                  setCategory(null);
                }}
              >
                <Ionicons 
                  name="school" 
                  size={16} 
                  color={activeTab === 'academic' ? '#6366f1' : colors.textSecondary} 
                />
                <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'academic' && styles.tabTextActive]}>
                  Academic
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.tab, activeTab === 'student-life' && [styles.tabActive, { backgroundColor: colors.background }]]}
                onPress={() => {
                  setActiveTab('student-life');
                  setCategory(null);
                }}
              >
                <Ionicons 
                  name="briefcase" 
                  size={16} 
                  color={activeTab === 'student-life' ? '#6366f1' : colors.textSecondary} 
                />
                <Text style={[styles.tabText, { color: colors.textSecondary }, activeTab === 'student-life' && styles.tabTextActive]}>
                  Student Life
                </Text>
              </TouchableOpacity>
            </View>

            {/* Category Grid */}
            <View style={styles.categoryGrid}>
              {currentCategories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryItem, { backgroundColor: colors.card }, category === cat.id && styles.categoryItemActive]}
                  onPress={() => setCategory(cat.id)}
                >
                  <View style={[styles.categoryIcon, category === cat.id && styles.categoryIconActive]}>
                    <Ionicons 
                      name={getCategoryIcon(cat.id)} 
                      size={24} 
                      color={category === cat.id ? '#ffffff' : '#6366f1'} 
                    />
                  </View>
                  <Text style={[styles.categoryName, { color: colors.textSecondary }, category === cat.id && styles.categoryNameActive]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Title Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Title *</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.card, color: colors.text }]}
              placeholder="What are you selling?"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>{title.length}/100</Text>
          </View>

          {/* Description Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.textArea, { backgroundColor: colors.card, color: colors.text }]}
              placeholder="Describe your item (condition, details, etc.)"
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={500}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>{description.length}/500</Text>
          </View>

          {/* Price Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Price</Text>
            <View style={[styles.priceInputContainer, { backgroundColor: colors.card }]}>
              <Text style={styles.currencySymbol}>₦</Text>
              <TextInput
                style={[styles.priceInput, { color: colors.text }]}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={price}
                onChangeText={(value) => setPrice(formatPriceInput(value))}
                keyboardType="numeric"
              />
            </View>
            <Text style={[styles.priceHint, { color: colors.textSecondary }]}>Leave empty for "Free" or "Negotiable"</Text>
          </View>

          {/* Location Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Location</Text>
            <View style={[styles.locationInputContainer, { backgroundColor: colors.card }]}>
              <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.locationInput, { color: colors.text }]}
                placeholder="Where can buyers pick this up?"
                placeholderTextColor={colors.textSecondary}
                value={location}
                onChangeText={setLocation}
              />
            </View>
          </View>

          {/* Spacer for bottom padding */}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  closeButton: {
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
  submitButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  submitButtonDisabled: {
    backgroundColor: '#334155',
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 12,
  },
  imagesScroll: {
    flexDirection: 'row',
  },
  imageContainer: {
    width: 100,
    height: 100,
    borderRadius: 12,
    marginRight: 12,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageButton: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageText: {
    fontSize: 12,
    color: '#6366f1',
    marginTop: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    marginTop: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#0f172a',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#6366f1',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryItem: {
    width: '30%',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryItemActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryIconActive: {
    backgroundColor: '#6366f1',
  },
  categoryName: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  categoryNameActive: {
    color: '#6366f1',
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    marginTop: 8,
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
  },
  charCount: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 4,
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: '600',
    color: '#6366f1',
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: '#ffffff',
    paddingVertical: 16,
  },
  priceHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },
  locationInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 12,
  },
  locationInput: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    paddingVertical: 16,
  },
});
